import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DocTodo, Document, JournalDay, SharedFolder, TagSummary, User } from '../../lib/types';
import { api, onWebSocketMessage } from '../../lib/api';
import { isJournalEnabled } from '../../lib/journal';
import { noteClientId } from '../../lib/docSync/noteClients';
import { refreshBlocks } from '../../lib/blockLookup';
import { useLatestRef } from '../../lib/useLatestRef';
import { countHashtags, mergeDocList } from './workspaceListing';

interface UseWorkspaceDataOptions {
  currentUser?: User | null;
  setSelectedDocId: React.Dispatch<React.SetStateAction<string | null>>;
  autoSelectedDocRef: React.RefObject<boolean>;
  reloadTrash: () => void;
  // The to-do collection is shown: its to-dos are fetched (and fetched again when the list is)
  todosShown?: boolean;
}

// A note open in an editor (its sync engine is running): it keeps its bullets when the list is fetched again
const isNoteOpen = (docId: string) => noteClientId(docId) !== undefined;

/** The note list fetched again, over the one in memory (open notes keep their bullets, workspaceListing.ts). */
export function freshDocList(fresh: Document[]): React.SetStateAction<Document[]> {
  return (prev) => mergeDocList(prev, fresh, isNoteOpen);
}

// Notes, folders, shared folders and hashtags of the workspace: loaded once, then kept current by the
// realtime events. The note list has no bullets, only counts per note (to-dos, hashtags); the to-do
// collection fetches its to-dos itself.
export function useWorkspaceData({ currentUser, setSelectedDocId, autoSelectedDocRef, reloadTrash, todosShown = false }: UseWorkspaceDataOptions) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [sharedFolders, setSharedFolders] = useState<SharedFolder[]>([]);
  const [serverTagsSummary, setServerTagsSummary] = useState<TagSummary[]>([]);
  // Every to-do with text of the notes (GET /documents/todos); null until the collection was first shown
  const [rollupTodos, setRollupTodos] = useState<DocTodo[] | null>(null);
  const todosShownRef = useLatestRef(todosShown);

  // Hashtag counts from the notes in memory: the list's counts per note, the open note's from its bullets
  // (per note cached, workspaceListing.ts)
  const tagsSummary = useMemo(
    () => (docs.length === 0 ? serverTagsSummary : countHashtags(docs)),
    [docs, serverTagsSummary]
  );

  const loadRollupTodos = useCallback(() => {
    api
      .getDocumentTodos()
      .then(setRollupTodos)
      // Not reachable (offline, never fetched): the collection shows the to-dos of the notes here, not "loading"
      .catch(() => setRollupTodos((prev) => prev ?? []));
  }, []);

  // Whatever shows the list's bullets elsewhere follows a fetched list: the to-do collection (when shown)
  // and the bullets looked up for links
  const afterListFetched = useCallback(() => {
    if (todosShownRef.current) loadRollupTodos();
    refreshBlocks();
  }, [loadRollupTodos, todosShownRef]);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [docsRes, foldersRes, sharedFoldersRes, tagsRes, journalRes] = await Promise.all([
        api.getDocuments(),
        api.getFolders(),
        api.getSharedFolders().catch(() => []),
        api.getWorkspaceTags().catch(() => []),
        isJournalEnabled() ? api.getJournal().catch(() => [] as JournalDay[]) : Promise.resolve([] as JournalDay[]),
      ]);
      const journalIds = new Set(journalRes.map((d) => d.docId));
      setDocs(freshDocList(docsRes));
      setFolders(foldersRes);
      setSharedFolders(sharedFoldersRes);
      setServerTagsSummary(tagsRes);
      afterListFetched();

      setSelectedDocId((prevId) => {
        if (prevId && docsRes.some((d) => d.id === prevId)) {
          return prevId;
        }
        autoSelectedDocRef.current = true; // chosen by the app, not a step of its own in the history
        // Not a journal day: those open in the journal
        const first = docsRes.find((d) => !(d.isOwner && journalIds.has(d.id)));
        return first ? first.id : null;
      });
    } catch {
      // ignore
    }
  }, [setSelectedDocId, autoSelectedDocRef, afterListFetched]);

  useEffect(() => {
    // Loads the notes and folders when the workspace opens
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  // The to-do collection fetches its to-dos each time it is shown (the last ones show until then)
  useEffect(() => {
    if (todosShown) loadRollupTodos();
  }, [todosShown, loadRollupTodos]);

  // Global WebSocket listener with strict isolation & deduplication
  useEffect(() => {
    const unsub = onWebSocketMessage((msg) => {
      if (msg.event === 'DOC_CREATED' && msg.payload) {
        const created = msg.payload as Document;
        // Strict Privacy Check: Only add if created by or shared with current user
        if (currentUser) {
          const isOwner = created.userId === currentUser.id;
          const isShared =
            created.sharedWith?.some(
              (s) => s.userId === currentUser.id || s.targetId === currentUser.id
            ) || false;
          const isFolderShared = Boolean(created.sharedFolderId || created.isSharedFolder);
          if (!isOwner && !isShared && !isFolderShared) {
            return;
          }
        }
        setDocs((prev) => (prev.some((d) => d.id === created.id) ? prev : [created, ...prev]));
      } else if (msg.event === 'DOC_UPDATED' && msg.payload) {
        // The note as the server has it, bullets included: one note changes, the list is not fetched again
        const updated = msg.payload as Document;
        setDocs((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
      } else if (msg.event === 'DOC_DELETED') {
        const delId = (msg.payload as { id?: string } | undefined)?.id;
        if (!delId) return;
        setDocs((prev) => prev.filter((d) => d.id !== delId));
        setSelectedDocId((prev) => (prev === delId ? null : prev));
        reloadTrash();
      } else if (msg.event === 'WORKSPACE_FOLDERS_UPDATED') {
        // Folders created, moved, deleted or shared: many notes may have another place or audience
        api.getFolders().then(setFolders).catch(() => {});
        api.getSharedFolders().then(setSharedFolders).catch(() => {});
        api
          .getDocuments()
          .then((fresh) => {
            setDocs(freshDocList(fresh));
            afterListFetched();
          })
          .catch(() => {});
        reloadTrash();
      }
    });
    return unsub;
  }, [currentUser, reloadTrash, setSelectedDocId, afterListFetched]);

  return {
    docs,
    setDocs,
    folders,
    setFolders,
    sharedFolders,
    setSharedFolders,
    tagsSummary,
    loadWorkspaceData,
    rollupTodos,
    setRollupTodos,
  };
}
