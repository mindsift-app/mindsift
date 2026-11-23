import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, getToken, setToken, clearToken, buildWebSocketURL, buildSSEURL, requestRaw } from '../api';
import { OfflineError } from '../offline';

// Safety net for splitting lib/api.ts: the behaviour of request()
// as seen through public calls.

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('request()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    clearToken();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the stored token as bearer header', async () => {
    setToken('tok-1');
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await api.getTaskLists();
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/task-lists');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('takes over a renewed session token from X-Session-Token', async () => {
    setToken('old');
    fetchMock.mockResolvedValue(jsonResponse(200, [], { 'X-Session-Token': 'fresh' }));
    await api.getTaskLists();
    expect(getToken()).toBe('fresh');
  });

  it('ignores X-Session-Token on an error answer', async () => {
    setToken('old');
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'kaputt' }, { 'X-Session-Token': 'fresh' }));
    await expect(api.getTaskLists()).rejects.toThrow('kaputt');
    expect(getToken()).toBe('old');
  });

  it('on 401 forgets the token and tells the app', async () => {
    setToken('stale');
    const seen = vi.fn();
    window.addEventListener('mindsift:unauthorized', seen);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Nicht autorisiert' }));
    await expect(api.getTaskLists()).rejects.toThrow('Nicht autorisiert');
    expect(getToken()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('mindsift:unauthorized', seen);
  });

  it('uses the server error text, else HTTP status', async () => {
    setToken('t');
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'Keine Berechtigung' }));
    await expect(api.getTaskLists()).rejects.toThrow('Keine Berechtigung');
    fetchMock.mockResolvedValueOnce(new Response('nicht json', { status: 502 }));
    await expect(api.getTaskLists()).rejects.toThrow('HTTP 502');
  });

  it('throws OfflineError when no answer arrives at all', async () => {
    setToken('t');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.deleteTaskList('tkl_x')).rejects.toBeInstanceOf(OfflineError);
  });
});

describe('request() timeout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    setToken('t');
    vi.useFakeTimers();
    // A server that never answers: the call only ends when request() gives up
    fetchMock = vi.fn(
      (_path: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // What became of the call: undefined while it is still waiting
  function watch(call: Promise<unknown>) {
    const state: { error?: unknown } = {};
    call.catch((err) => {
      state.error = err;
    });
    return state;
  }

  it('gives up on an ordinary call after 12 seconds', async () => {
    const state = watch(api.deleteTaskList('tkl_x'));
    await vi.advanceTimersByTimeAsync(11_900);
    expect(state.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(state.error).toBeInstanceOf(OfflineError);
  });

  // The server works on these for a while or waits for a mail server or push service
  const slowCalls: [string, () => Promise<unknown>][] = [
    ['restoring a backup', () => api.restoreMyBackup('2026-11-10.zip', 'restore', ['notes'])],
    ['writing the backups', () => api.adminRunBackup()],
    ['deleting all own data', () => api.purgeOwnData('geheim')],
    ['deleting the own account', () => api.deleteOwnAccount('geheim')],
    ['deleting somebody', () => api.adminDeleteUser('usr_1')],
    ['the test mail', () => api.adminTestSMTP('anna@example.com')],
    ['the test alarm', () => api.testAlarmChannel('email')],
    ['the invite mail', () => api.adminSendInvite('inv_1', 'anna@example.com')],
    ['the test push', () => api.testPush()],
  ];
  it.each(slowCalls)('waits five minutes for %s', async (_name, call) => {
    const state = watch(call());
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 100);
    expect(state.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(state.error).toBeInstanceOf(OfflineError);
  });
});

describe('realtime URLs', () => {
  it('builds WebSocket URLs with the ticket', () => {
    expect(buildWebSocketURL('abc')).toBe(`ws://${window.location.host}/api/v1/ws?ticket=abc`);
    expect(buildWebSocketURL('a b', 'lst 1')).toBe(`ws://${window.location.host}/api/v1/ws/lists/lst%201?ticket=a%20b`);
  });

  it('builds SSE URLs with rooms', () => {
    expect(buildSSEURL('t', undefined, 'doc_1', ['lst_a', 'lst_b'])).toBe('/api/v1/events?ticket=t&docId=doc_1&rooms=lst_a%2Clst_b');
  });
});

describe('requestRaw()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    clearToken();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a FormData upload with the login, keeps its own headers and takes a renewed token', async () => {
    setToken('old');
    fetchMock.mockResolvedValue(jsonResponse(200, { text: 'Hallo' }, { 'X-Session-Token': 'fresh' }));
    const form = new FormData();
    const res = await requestRaw('/api/v1/voice/transcribe', { method: 'POST', body: form, headers: { 'X-Chunk-SHA256': 'abc' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(form);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer old', 'X-Chunk-SHA256': 'abc' });
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(await res.json()).toEqual({ text: 'Hallo' });
    expect(getToken()).toBe('fresh');
  });

  it('on 401 forgets the token and tells the app, and hands back the answer', async () => {
    setToken('stale');
    const seen = vi.fn();
    window.addEventListener('mindsift:unauthorized', seen);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'nope' }));
    const res = await requestRaw('/api/v1/link-preview?url=x');
    window.removeEventListener('mindsift:unauthorized', seen);
    expect(res.status).toBe(401);
    expect(getToken()).toBeNull();
    expect(seen).toHaveBeenCalled();
  });
});
