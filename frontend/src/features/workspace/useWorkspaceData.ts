import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DocTodo, Document, JournalDay, SharedFolder, TagSummary, User } from '../../lib/types';
import { api, onWebSocketMessage } from '../../lib/api';
import { isJournalEnabled } from '../../lib/journal';
import { noteClientId, onNoteClosed } from '../../lib/docSync/noteClients';
import { refreshBlocks } from '../../lib/blockLookup';
import { useLatestRef } from '../../lib/useLatestRef';
import { NoteCounts, countHashtags, hasBlocks, mergeDocList, withCounts, withListedNote, withoutBullets } from './workspaceListing';

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

// WORKSPACE_FOLDERS_UPDATED (server: handlers_folders.go). `type` says what changed; an event without one
// (or of a type not known here) fetches everything again.
type FoldersEvent = {
  type?: 'created' | 'deleted' | 'moved' | 'restored' | 'noteMoved' | 'mount' | 'shared';
  path?: string;
  docId?: string;
  deletedDocIds?: string[];
};

const inFolder = (folderPath: string | undefined, path: string) =>
  !!folderPath && (folderPath === path || folderPath.startsWith(`${path}/`));

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
  const docsRef = useLatestRef(docs);

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

  // The folders alone fetched again (folder events, a folder restored from the trash)
  const reloadFolders = useCallback(() => api.getFolders().then(setFolders).catch(() => {}), []);

  // A note closed in its editor: the list drops its bullets, so its counts come from the server's fields
  // (DOC_COUNTS, DOC_UPDATED) and the link dialog fetches its bullets fresh
  useEffect(
    () =>
      onNoteClosed((docId) => {
        setDocs((prev) =>
          prev.some((d) => d.id === docId && hasBlocks(d)) ? prev.map((d) => (d.id === docId ? withoutBullets(d) : d)) : prev
        );
      }),
    []
  );

  // The note list alone fetched again (after restoring from the trash, undoing a merge, or when a folder
  // event changed where or for whom many notes show)
  const reloadDocList = useCallback(
    () =>
      api
        .getDocuments()
        .then((fresh) => {
          setDocs(freshDocList(fresh));
          afterListFetched();
        })
        .catch(() => {}),
    [afterListFetched]
  );

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
        // The note as the list has it (no bullets, with its counts): one note changes, the list is not fetched again
        const updated = msg.payload as Document;
        setDocs((prev) => prev.map((d) => (d.id === updated.id ? withListedNote(d, updated, isNoteOpen(d.id)) : d)));
      } else if (msg.event === 'DOC_COUNTS' && msg.payload) {
        // The counts of a note someone changed (open to-dos, hashtags); a note open here counts its bullets
        const counts = msg.payload as NoteCounts;
        setDocs((prev) =>
          prev.some((d) => d.id === counts.id) ? prev.map((d) => (d.id === counts.id ? withCounts(d, counts) : d)) : prev
        );
      } else if (msg.event === 'DOC_DELETED') {
        const delId = (msg.payload as { id?: string } | undefined)?.id;
        if (!delId) return;
        setDocs((prev) => prev.filter((d) => d.id !== delId));
        setSelectedDocId((prev) => (prev === delId ? null : prev));
        reloadTrash();
      } else if (msg.event === 'WORKSPACE_FOLDERS_UPDATED') {
        const ev = (msg.payload || {}) as FoldersEvent;
        const loadFolders = reloadFolders;
        const loadAll = () => {
          loadFolders();
          api.getSharedFolders().then(setSharedFolders).catch(() => {});
          reloadDocList();
          reloadTrash();
        };
        switch (ev.type) {
          case 'created':
            loadFolders();
            return;
          case 'moved':
            // The notes moved came as DOC_UPDATED just before
            loadFolders();
            return;
          case 'restored':
            // The notes brought back came as DOC_CREATED just before; a folder may be back as well
            loadFolders();
            reloadTrash();
            return;
          case 'noteMoved':
            // DOC_UPDATED (sent just before) brought the note, unless it is new here (moved into a folder
            // shared with me)
            if (ev.docId && docsRef.current.some((d) => d.id === ev.docId)) {
              loadFolders();
              reloadTrash();
              return;
            }
            break;
          case 'deleted': {
            const path = ev.path;
            // A deleted shared folder is no longer shared
            api.getSharedFolders().then(setSharedFolders).catch(() => {});
            const gone = new Set(ev.deletedDocIds || []);
            if (!path) {
              // Somebody else deleted a folder with notes I see (shared with me, of a shared folder): all of
              // them in one event, the folders and the trash fetched once
              if (gone.size === 0) break;
              setDocs((prev) => prev.filter((d) => !gone.has(d.id)));
              setSelectedDocId((prev) => (prev && gone.has(prev) ? null : prev));
              loadFolders();
              reloadTrash();
              return;
            }
            // Other notes there (shared with me and placed there, or of a shared folder given back) moved
            // or disappeared: those only the list knows
            if (docsRef.current.some((d) => !gone.has(d.id) && inFolder(d.folderPath, path))) break;
            if (gone.size > 0) {
              setDocs((prev) => prev.filter((d) => !gone.has(d.id)));
              setSelectedDocId((prev) => (prev && gone.has(prev) ? null : prev));
            }
            loadFolders();
            reloadTrash();
            return;
          }
        }
        // A shared folder created, shared, given back or placed elsewhere: many notes may have another
        // place or audience
        loadAll();
      }
    });
    return unsub;
  }, [currentUser, reloadTrash, setSelectedDocId, reloadDocList, reloadFolders, docsRef]);

  return {
    docs,
    setDocs,
    folders,
    setFolders,
    sharedFolders,
    setSharedFolders,
    tagsSummary,
    loadWorkspaceData,
    reloadDocList,
    reloadFolders,
    rollupTodos,
    setRollupTodos,
  };
}
