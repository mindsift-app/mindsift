import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Document, JournalDay, SharedFolder, TagSummary, User } from '../../lib/types';
import { api, onWebSocketMessage } from '../../lib/api';
import { isJournalEnabled } from '../../lib/journal';
import { countHashtags } from './workspaceListing';

interface UseWorkspaceDataOptions {
  currentUser?: User | null;
  setSelectedDocId: React.Dispatch<React.SetStateAction<string | null>>;
  autoSelectedDocRef: React.RefObject<boolean>;
  reloadTrash: () => void;
}

// Notes, folders, shared folders and hashtags of the workspace: loaded once, then kept current by the
// realtime events
export function useWorkspaceData({ currentUser, setSelectedDocId, autoSelectedDocRef, reloadTrash }: UseWorkspaceDataOptions) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [sharedFolders, setSharedFolders] = useState<SharedFolder[]>([]);
  const [serverTagsSummary, setServerTagsSummary] = useState<TagSummary[]>([]);

  // Dynamically compute hashtag counts directly from in-memory documents (per note cached, workspaceListing.ts)
  const tagsSummary = useMemo(
    () => (docs.length === 0 ? serverTagsSummary : countHashtags(docs)),
    [docs, serverTagsSummary]
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
      setDocs(docsRes);
      setFolders(foldersRes);
      setSharedFolders(sharedFoldersRes);
      setServerTagsSummary(tagsRes);

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
  }, [setSelectedDocId, autoSelectedDocRef]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

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
        const updated = msg.payload as Document;
        setDocs((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
      } else if (msg.event === 'DOC_DELETED') {
        const delId = (msg.payload as { id?: string } | undefined)?.id;
        if (!delId) return;
        setDocs((prev) => prev.filter((d) => d.id !== delId));
        setSelectedDocId((prev) => (prev === delId ? null : prev));
        reloadTrash();
      } else if (msg.event === 'WORKSPACE_FOLDERS_UPDATED') {
        api.getFolders().then(setFolders).catch(() => {});
        api.getSharedFolders().then(setSharedFolders).catch(() => {});
        api.getDocuments().then(setDocs).catch(() => {});
        reloadTrash();
      }
    });
    return unsub;
  }, [currentUser, reloadTrash, setSelectedDocId]);

  return { docs, setDocs, folders, setFolders, sharedFolders, setSharedFolders, tagsSummary, loadWorkspaceData };
}
