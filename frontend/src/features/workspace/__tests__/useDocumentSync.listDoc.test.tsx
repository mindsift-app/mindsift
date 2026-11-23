import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api';
import { useDocumentSync } from '../useDocumentSync';
import { makeDoc } from '../../../test/fixtures';

// An engine without a stored copy: it never gets ready here, the note comes from the server
vi.mock('../../../lib/docSync/engine', () => ({
  DocSyncEngine: class {
    clientId = 'c1';
    subscribe() {
      return () => {};
    }
    start() {
      return Promise.resolve();
    }
    stop() {}
    getState() {
      return { ready: false };
    }
    setTaskLinks() {}
  },
}));

vi.mock('../../../lib/api', async (original) =>
  (await import('../../../test/apiMock')).withApi(original, { getDocument: vi.fn() })
);

describe('useDocumentSync with a note of the note list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state until the bullets arrive (the list has none)', async () => {
    const full = makeDoc({ blocks: [{ id: 'b1', type: 'todo', content: 'Kaufen', level: 0, position: 1000 }] });
    vi.mocked(api.getDocument).mockResolvedValue(full);
    const onMeta = vi.fn();
    const { result } = renderHook(() => useDocumentSync('doc_1', makeDoc({ openTodos: 1 }), onMeta));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocks.map((b) => b.content)).toEqual(['Kaufen']);
    expect(onMeta).toHaveBeenCalledWith(full);
  });

  it('shows a note with its bullets at once', () => {
    vi.mocked(api.getDocument).mockReturnValue(new Promise(() => {}));
    const doc = makeDoc({ blocks: [{ id: 'b1', type: 'text', content: 'Da', level: 0, position: 1000 }] });
    const { result } = renderHook(() => useDocumentSync('doc_1', doc, vi.fn()));
    expect(result.current.loading).toBe(false);
    expect(result.current.blocks.map((b) => b.content)).toEqual(['Da']);
  });
});
