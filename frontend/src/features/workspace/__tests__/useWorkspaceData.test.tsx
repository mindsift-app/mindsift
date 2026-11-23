import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api';
import { emitRealtimeMessage } from '../../../lib/realtimeBus';
import { Document, DocumentBlock } from '../../../lib/types';
import { registerNoteClient } from '../../../lib/docSync/noteClients';
import { useWorkspaceData } from '../useWorkspaceData';
import { reconnect } from '../../../test/realtime';

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
  };
});

const listed = (id: string, d: Partial<Document> = {}) =>
  ({ id, title: id, blocks: [], tags: [], content: '', folderPath: '', ...d }) as unknown as Document;

// The workspace's realtime listener (call inside act)
const lastHandler = () => (msg: { event: string; payload?: unknown }) => emitRealtimeMessage({ payload: undefined, timestamp: '', ...msg });

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

    act(() => lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'shared', folderId: 'f1' } }));
    await waitFor(() => expect(api.getDocumentTodos).toHaveBeenCalledTimes(2));
    expect(api.getDocuments).toHaveBeenCalledTimes(2);
  });

  it('fetches notes, folders and trash again after the connection dropped (the events of the gap are lost)', async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    // Meanwhile, on another device: b deleted, c made in a new folder
    vi.mocked(api.getDocuments).mockResolvedValue([listed('a'), listed('c', { folderPath: 'Neu' })]);
    vi.mocked(api.getFolders).mockResolvedValue(['Neu']);
    reconnect();
    await waitFor(() => expect(result.current.docs.map((d) => d.id)).toEqual(['a', 'c']));
    await waitFor(() => expect(result.current.folders).toEqual(['Neu']));
    expect(api.getSharedFolders).toHaveBeenCalledTimes(2);
  });

  it('does not fetch the whole list again when one known note moved to another folder', async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    act(() => {
      lastHandler()({ event: 'DOC_UPDATED', payload: listed('a', { folderPath: 'Privat' }) });
      lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'noteMoved', docId: 'a' } });
    });
    await waitFor(() => expect(api.getFolders).toHaveBeenCalledTimes(2));
    expect(api.getDocuments).toHaveBeenCalledTimes(1);
    expect(result.current.docs.find((d) => d.id === 'a')?.folderPath).toBe('Privat');

    // A note new here (moved into a folder shared with me): the list is fetched
    act(() => lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'noteMoved', docId: 'c' } }));
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalledTimes(2));
  });

  it('fetches only the folders when a folder was created, moved or a note restored', async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    act(() => {
      lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'created', path: 'Neu' } });
      lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'moved', sourcePath: 'Neu', newPath: 'Alt/Neu' } });
      // A note back from the trash comes as DOC_CREATED first
      lastHandler()({ event: 'DOC_CREATED', payload: listed('c') });
      lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'restored', restored: 'c' } });
    });
    await waitFor(() => expect(api.getFolders).toHaveBeenCalledTimes(4));
    expect(api.getDocuments).toHaveBeenCalledTimes(1);
    expect(api.getSharedFolders).toHaveBeenCalledTimes(1);
    expect(result.current.docs.map((d) => d.id)).toEqual(['c', 'a', 'b']);
  });

  it('takes a note shared with a group of this person, and drops one that names nobody here', async () => {
    const fixed = { setSelectedDocId: vi.fn(), autoSelectedDocRef: { current: false }, reloadTrash: vi.fn() };
    const me = { id: 'usr_me' } as unknown as NonNullable<Parameters<typeof useWorkspaceData>[0]['currentUser']>;
    const { result } = renderHook(() => useWorkspaceData({ ...fixed, currentUser: me }));
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    const viaGroup = listed('g', {
      userId: 'usr_anna',
      permission: 'read',
      sharedWith: [{ targetType: 'team', targetId: 'team_1' }],
    } as unknown as Partial<Document>);
    act(() => lastHandler()({ event: 'DOC_CREATED', payload: viaGroup }));
    await waitFor(() => expect(result.current.docs.map((d) => d.id)).toContain('g'));

    act(() => lastHandler()({ event: 'DOC_CREATED', payload: listed('x', { userId: 'usr_anna' }) }));
    expect(result.current.docs.map((d) => d.id)).not.toContain('x');
  });

  it('fetches the folders when a note was made in a folder new here, not for a known one', async () => {
    vi.mocked(api.getFolders).mockResolvedValue(['Projekte']);
    const { result } = setup(false);
    await waitFor(() => expect(result.current.folders).toEqual(['Projekte']));
    act(() => lastHandler()({ event: 'DOC_CREATED', payload: listed('c', { folderPath: 'Projekte' }) }));
    await waitFor(() => expect(result.current.docs).toHaveLength(3));
    expect(api.getFolders).toHaveBeenCalledTimes(1);

    act(() => lastHandler()({ event: 'DOC_CREATED', payload: listed('d', { folderPath: 'Neu von Agent' }) }));
    await waitFor(() => expect(api.getFolders).toHaveBeenCalledTimes(2));
    expect(api.getDocuments).toHaveBeenCalledTimes(1);
  });

  it('removes the notes of a deleted folder, and fetches the list only when other notes were there', async () => {
    vi.mocked(api.getDocuments).mockResolvedValue([
      listed('a', { folderPath: 'Alt' }),
      listed('b', { folderPath: 'Alt/Unter' }),
      listed('c', { folderPath: 'Andere' }),
    ]);
    const { result } = setup(false);
    await waitFor(() => expect(result.current.docs).toHaveLength(3));
    act(() =>
      lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'deleted', path: 'Alt', deletedDocIds: ['a', 'b'] } })
    );
    await waitFor(() => expect(result.current.docs.map((d) => d.id)).toEqual(['c']));
    expect(api.getDocuments).toHaveBeenCalledTimes(1);

    // A note shared with me stayed there (it goes back to the top level): only the list knows
    act(() => lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'deleted', path: 'Andere', deletedDocIds: [] } }));
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalledTimes(2));
  });

  it('removes the notes of a folder somebody else deleted at once, with one look at the trash', async () => {
    const reloadTrash = vi.fn();
    const fixed = { setSelectedDocId: vi.fn(), autoSelectedDocRef: { current: false }, reloadTrash };
    const { result } = renderHook(() => useWorkspaceData(fixed));
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    act(() => lastHandler()({ event: 'WORKSPACE_FOLDERS_UPDATED', payload: { type: 'deleted', deletedDocIds: ['a', 'b'] } }));
    await waitFor(() => expect(result.current.docs).toHaveLength(0));
    expect(reloadTrash).toHaveBeenCalledTimes(1);
    expect(api.getDocuments).toHaveBeenCalledTimes(1);
    expect(api.getFolders).toHaveBeenCalledTimes(2);
  });

  it('takes the counts of DOC_COUNTS for the note in the list', async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    act(() =>
      lastHandler()({
        event: 'DOC_COUNTS',
        payload: { id: 'b', openTodos: 2, tagCounts: { einkauf: 3 }, tagOpenTodos: { einkauf: 2 } },
      })
    );
    await waitFor(() => expect(result.current.docs.find((d) => d.id === 'b')?.openTodos).toBe(2));
    expect(result.current.tagsSummary).toEqual([{ tag: 'einkauf', count: 3, docIds: ['b'] }]);
    // Unknown notes change nothing
    const before = result.current.docs;
    act(() => lastHandler()({ event: 'DOC_COUNTS', payload: { id: 'x', openTodos: 1 } }));
    expect(result.current.docs).toBe(before);
  });

  it('drops the bullets of a note once it closes, keeping their counts', async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.docs).toHaveLength(2));
    const unregister = registerNoteClient('a', 'client-1');
    act(() =>
      result.current.setDocs((prev) =>
        prev.map((d) =>
          d.id === 'a'
            ? { ...d, blocks: [{ id: 'a1', type: 'todo', content: 'Milch #einkauf', checked: false } as DocumentBlock] }
            : d
        )
      )
    );
    act(() => unregister());
    const a = result.current.docs.find((d) => d.id === 'a');
    expect(a?.blocks).toEqual([]);
    expect(a?.openTodos).toBe(1);
    expect(a?.tagCounts).toEqual({ einkauf: 1 });
  });
});
