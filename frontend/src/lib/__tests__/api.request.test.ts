import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, getToken, setToken, clearToken, buildWebSocketURL, buildSSEURL } from '../api';
import { OfflineError } from '../offline';

// Safety net for splitting lib/api.ts (Doku/plans/frontend-aufteilen.md): the behaviour of request()
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

describe('realtime URLs', () => {
  it('builds WebSocket URLs with the ticket', () => {
    expect(buildWebSocketURL('abc')).toBe(`ws://${window.location.host}/api/v1/ws?ticket=abc`);
    expect(buildWebSocketURL('a b', 'lst 1')).toBe(`ws://${window.location.host}/api/v1/ws/lists/lst%201?ticket=a%20b`);
  });

  it('builds SSE URLs with rooms', () => {
    expect(buildSSEURL('t', undefined, 'doc_1', ['lst_a', 'lst_b'])).toBe('/api/v1/events?ticket=t&docId=doc_1&rooms=lst_a%2Clst_b');
  });
});
