import React, { useCallback } from 'react';
import { Document, TrashedDocument } from '../../lib/types';
import { api } from '../../lib/api';

interface UseTrashActionsOptions {
  selectedDocId: string | null;
  setSelectedDocId: React.Dispatch<React.SetStateAction<string | null>>;
  trash: TrashedDocument[];
  setDocs: React.Dispatch<React.SetStateAction<Document[]>>;
  setFolders: React.Dispatch<React.SetStateAction<string[]>>;
  setEditorNonce: React.Dispatch<React.SetStateAction<number>>;
  reloadTrash: () => void;
  onStatsChange: () => void;
}

// The workspace trash: bring notes and deleted folders back, delete them for good, empty the trash
export function useTrashActions({
  selectedDocId,
  setSelectedDocId,
  trash,
  setDocs,
  setFolders,
  setEditorNonce,
  reloadTrash,
  onStatsChange,
}: UseTrashActionsOptions) {
  const handleRestoreDocument = useCallback(
    async (docId: string) => {
      await api.restoreDocument(docId);
      const [freshDocs, freshFolders] = await Promise.all([api.getDocuments(), api.getFolders()]);
      setDocs(freshDocs);
      setFolders(freshFolders);
      setEditorNonce((n) => n + 1);
      reloadTrash();
      onStatsChange();
    },
    [reloadTrash, onStatsChange, setDocs, setFolders, setEditorNonce]
  );

  const handlePurgeDocument = async (docId: string) => {
    await api.purgeDocument(docId);
    if (selectedDocId === docId) setSelectedDocId(null);
    reloadTrash();
  };

  // Trash entries: a note, or a deleted folder that comes back (or goes) with all of its notes
  const handleRestoreTrashItem = async (item: TrashedDocument) => {
    if (item.kind !== 'folder') return handleRestoreDocument(item.id);
    await api.restoreFolder(item.id);
    const [freshDocs, freshFolders] = await Promise.all([api.getDocuments(), api.getFolders()]);
    setDocs(freshDocs);
    setFolders(freshFolders);
    reloadTrash();
    onStatsChange();
  };
  const handlePurgeTrashItem = async (item: TrashedDocument) => {
    if (item.kind !== 'folder') return handlePurgeDocument(item.id);
    await api.purgeFolder(item.id);
    reloadTrash();
  };

  const handleEmptyTrash = async () => {
    await api.emptyTrash();
    if (selectedDocId && trash.some((t) => t.id === selectedDocId)) setSelectedDocId(null);
    reloadTrash();
  };

  return { handleRestoreDocument, handleRestoreTrashItem, handlePurgeTrashItem, handleEmptyTrash };
}
