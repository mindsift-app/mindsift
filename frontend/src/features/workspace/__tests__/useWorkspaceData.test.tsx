import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api, onWebSocketMessage } from '../../../lib/api';
import { Document } from '../../../lib/types';
import { useWorkspaceData } from '../useWorkspaceData';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocuments: vi.fn(),
      getDocumentTodos: vi.fn(),
      getFolders: vi.fn(),
      getSharedFolders: vi.fn(),
      getWorkspaceTags: vi.fn(),
      getJournal: vi.fn(),
    },
    onWebSocketMessage: vi.fn(() => () => {}),
  };
});

const listed = (id: string, d: Partial<Document> = {}) =>
  ({ id, title: id, blocks: [], tags: [], content: '', folderPath: '', ...d }) as unknown as Document;

type Handler = (msg: { event: string; payload?: unknown }) => void;
const lastHandler = (): Handler => {
  const calls = vi.mocked(onWebSocketMessage).mock.calls;
  return calls[calls.length - 1][0] as unknown as Handler;
};

describe('useWorkspaceData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDocuments).mockResolvedValue([listed('a', { openTodos: 1 }), listed('b')]);
    vi.mocked(api.getDocumentTodos).mockResolvedValue([{ docId: 'a', blockId: 'a1', content: 'x', checked: false }]);
    vi.mocked(api.getFolders).mockResolvedValue([]);
    vi.mocked(api.getSharedFolders).mockResolvedValue([]);
    vi.mocked(api.getWorkspaceTags).mockResolvedValue([]);
    vi.mocked(api.getJournal).mockResolvedValue([]);
  });

  const setup = (todosShown: boolean) => {
    // Stable like the workspace's own (new ones would load the workspace again on every render)
    const fixed = { setSelectedDocId: vi.fn(), autoSelectedDocRef: { current: false }, reloadTrash: vi.fn() };
    return renderHook(({ shown }) => useWorkspaceData({ ...fixed, todosShown: shown }), { initialProps: { shown: todosShown } });
  };

  it('fetches the to-dos only while the collection is shown, and again with the list', async () => {
    const { result, rerender } = setup(false);
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    expect(api.getDocumentTodos).not.toHaveBeenCalled();
    expect(result.current.rollupTodos).toBeNull();

    rerender({ shown: true });
    await waitFor(() => expect(result.current.rollupTodos).toHaveLength(1));
    expect(api.getDocumentTodos).toHaveBeenCalledTimes(1);

    act(() => lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { path: 'Neu' } }));
    await waitFor(() => expect(api.getDocumentTodos).toHaveBeenCalledTimes(2));
    expect(api.getDocuments).toHaveBeenCalledTimes(2);
  });

  it('does not fetch the whole list again when one known note moved to another folder', async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    act(() => {
      lastHandler()({ event: 'DOC_UPDATED', payload: listed('a', { folderPath: 'Privat' }) });
      lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { docId: 'a' } });
    });
    await waitFor(() => expect(api.getFolders).toHaveBeenCalledTimes(2));
    expect(api.getDocuments).toHaveBeenCalledTimes(1);
    expect(result.current.docs.find((d) => d.id === 'a')?.folderPath).toBe('Privat');

    // A note new here (moved into a folder shared with me): the list is fetched
    act(() => lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { docId: 'c' } }));
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalledTimes(2));
  });
});
