import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal stand-ins: tests decide when connections open and which messages arrive.
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { wasClean: boolean; code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  open() {
    this.onopen?.();
  }
  emit(event: string, payload: unknown = {}) {
    this.onmessage?.({ data: JSON.stringify({ event, payload }) });
  }
  close() {
    this.closed = true;
  }
}

async function loadApi() {
  vi.resetModules(); // fresh module state (transport flags) for every test
  return import('../api');
}

describe('realtime fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    FakeEventSource.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('EventSource', FakeEventSource);
    sessionStorage.clear();
    localStorage.setItem('mindsift_jwt_token', 'test-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ticket":"t1"}', { status: 200 })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a WebSocket that stays silent is replaced by SSE', async () => {
    const api = await loadApi();
    const states: string[] = [];
    api.onRealtimeStatus((connected, transport) => states.push(`${connected}:${transport}`));
    await api.connectWebSocket();
    FakeWebSocket.instances[0].open();
    expect(api.getRealtimeTransport()).toBe('ws');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(FakeWebSocket.instances[0].sent).toContain(JSON.stringify({ event: 'PING' }));
    await vi.advanceTimersByTimeAsync(40_000); // no message at all, not even PONG
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].open();
    FakeEventSource.instances[0].emit('SSE_CONNECTED', { sseId: 'sse_1' });
    expect(api.getRealtimeTransport()).toBe('sse');
    api.disconnectWebSocket();
  });

  it('connects with a one-time ticket, never with the session token in the URL', async () => {
    const api = await loadApi();
    await api.connectWebSocket();
    expect(FakeWebSocket.instances[0].url).toContain('ticket=t1');
    expect(FakeWebSocket.instances[0].url).not.toContain('test-token');
    api.disconnectWebSocket();
  });

  it('a WebSocket answering PONG stays in use', async () => {
    const api = await loadApi();
    await api.connectWebSocket();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      ws.onmessage?.({ data: JSON.stringify({ event: 'PONG' }) });
    }
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(api.getRealtimeTransport()).toBe('ws');
    api.disconnectWebSocket();
  });

  it('SSE only counts as connected once the first event arrives', async () => {
    sessionStorage.setItem('mindsift_ws_blocked', 'true');
    const api = await loadApi();
    await api.connectWebSocket();
    const es = FakeEventSource.instances[0];
    es.open();
    expect(api.isRealtimeConnected()).toBe(false);
    es.emit('SSE_CONNECTED', { sseId: 'sse_1' });
    expect(api.isRealtimeConnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.isRealtimeConnected()).toBe(true);
    api.disconnectWebSocket();
  });

  it('a buffering proxy (stream opens, no events) switches SSE off for this tab', async () => {
    sessionStorage.setItem('mindsift_ws_blocked', 'true');
    const api = await loadApi();
    await api.connectWebSocket();
    const es = FakeEventSource.instances[0];
    es.open();
    await vi.advanceTimersByTimeAsync(5_500);
    expect(es.closed).toBe(true);
    expect(api.isRealtimeConnected()).toBe(false);
    expect(sessionStorage.getItem('mindsift_sse_buffered')).toBe('true');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1); // no reconnect loop: note sync uses long polling
    api.disconnectWebSocket();
  });

  it('behind such a proxy, events come by long polling', async () => {
    sessionStorage.setItem('mindsift_ws_blocked', 'true');
    sessionStorage.setItem('mindsift_sse_buffered', 'true');
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/v1/events/poll') return new Response('{"pollId":"poll_1"}', { status: 200 });
        if (url.startsWith('/api/v1/events/poll/poll_1')) {
          polls++;
          if (polls === 1) return new Response('{"events":[{"event":"TASK_UPDATED","payload":{"id":"t1"}}]}', { status: 200 });
          // Later polls wait like the server does, until the client gives up on them
          return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
        }
        return new Response('{}', { status: 200 });
      })
    );
    const api = await loadApi();
    const seen: string[] = [];
    api.onWebSocketMessage((m) => seen.push(m.event));
    await api.connectWebSocket();
    await vi.advanceTimersByTimeAsync(100);

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(api.isRealtimeConnected()).toBe(true);
    expect(api.getRealtimeTransport()).toBe('poll');
    expect(seen).toEqual(['TASK_UPDATED']);
    expect(polls).toBe(2); // the next poll is waiting
    api.disconnectWebSocket();
    expect(api.isRealtimeConnected()).toBe(false);
  });
});
