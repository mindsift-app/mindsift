import React, { useEffect, useRef, useState } from 'react';
import { Document } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';
import i18n from '../../i18n';

interface UseDocDragDropOptions {
  docs: Document[];
  setDocs: React.Dispatch<React.SetStateAction<Document[]>>;
  selectedDocId: string | null;
  setSelectedDocId: (id: string | null) => void;
  setMobileShowDetail: (show: boolean) => void;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setMergeDialog: (dialog: { sourceId: string; targetId?: string } | null) => void;
  treeRef: React.RefObject<HTMLDivElement | null>;
  showToast: (text: string, actions?: { label: string; run: () => void }[]) => void;
  loadWorkspaceData: () => Promise<void>;
  reloadTrash: () => void;
  onStatsChange: () => void;
}

// Dragging notes and folders in the sidebar (into folders, onto the trash, onto another note to merge)
// and marking several notes with Ctrl/Cmd+click or Shift+click
export function useDocDragDrop({
  docs,
  setDocs,
  selectedDocId,
  setSelectedDocId,
  setMobileShowDetail,
  setExpandedFolders,
  setMergeDialog,
  treeRef,
  showToast,
  loadWorkspaceData,
  reloadTrash,
  onStatsChange,
}: UseDocDragDropOptions) {
  // Drag and Drop state
  const [draggingDocId, setDraggingDocId] = useState<string | null>(null);
  // Marked notes (Ctrl/Cmd+click, Shift+click) are moved or trashed together by dragging one of them
  const [markedDocIds, setMarkedDocIds] = useState<Set<string>>(() => new Set());
  const [draggingDocIds, setDraggingDocIds] = useState<string[]>([]);
  const [trashDragOver, setTrashDragOver] = useState(false);
  const lastMarkedRef = useRef<string | null>(null);
  // The row last clicked: a pinned note has two rows (pinned and in its folder), the range starts at this one
  const lastMarkedRowRef = useRef<HTMLElement | null>(null);
  const [mergeHoverId, setMergeHoverId] = useState<string | null>(null);
  const [draggingFolderPath, setDraggingFolderPath] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  // A drag that ends without a drop (released elsewhere, Escape) fires only dragend: clear every drag state
  useEffect(() => {
    const clear = () => {
      setDraggingDocId(null);
      setDraggingFolderPath(null);
      setDragOverFolder(null);
      setMergeHoverId(null);
    };
    document.addEventListener('dragend', clear);
    return () => document.removeEventListener('dragend', clear);
  }, []);

  // Ctrl/Cmd+click toggles a note, Shift+click marks the range in the order shown (from the last marked
  // or the open note); a plain click clears the marks and opens the note
  const handleDocRowClick = (e: React.MouseEvent, id: string, open: () => void) => {
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-doc-row]');
    if (e.metaKey || e.ctrlKey) {
      setMarkedDocIds((prev) => {
        const next = new Set(prev);
        if (next.size === 0 && selectedDocId && selectedDocId !== id) next.add(selectedDocId);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastMarkedRef.current = id;
      lastMarkedRowRef.current = row;
      return;
    }
    if (e.shiftKey) {
      // Rows in the order shown; a pinned note appears twice, so positions count, not IDs
      const rows = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-doc-row]') || []);
      const b = row ? rows.indexOf(row) : rows.findIndex((el) => el.dataset.docRow === id);
      const anchorId = lastMarkedRef.current || selectedDocId || id;
      let a = lastMarkedRowRef.current ? rows.indexOf(lastMarkedRowRef.current) : -1;
      if (a < 0 || rows[a].dataset.docRow !== anchorId) {
        // The open note without a click here: its row nearest to the clicked one
        a = -1;
        rows.forEach((el, i) => {
          if (el.dataset.docRow === anchorId && (a < 0 || Math.abs(i - b) < Math.abs(a - b))) a = i;
        });
      }
      const range =
        a < 0 || b < 0
          ? [id]
          : rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((el) => el.dataset.docRow || '').filter(Boolean);
      setMarkedDocIds((prev) => new Set([...prev, ...range]));
      return;
    }
    setMarkedDocIds(new Set());
    lastMarkedRef.current = id;
    lastMarkedRowRef.current = row;
    open();
  };

  useEffect(() => {
    if (markedDocIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMarkedDocIds(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [markedDocIds.size]);

  // HTML5 Drag & Drop handlers for moving documents into folders (a marked note takes the others along)
  const handleDocDragStart = (e: React.DragEvent, docId: string) => {
    e.stopPropagation();
    const ids = markedDocIds.has(docId) && markedDocIds.size > 1 ? Array.from(markedDocIds) : [docId];
    e.dataTransfer.setData('application/mindsift-doc-id', docId);
    e.dataTransfer.setData('application/mindsift-doc-ids', JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', docId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingDocId(docId);
    setDraggingDocIds(ids);
  };

  const draggedDocIds = (e: React.DragEvent): string[] => {
    try {
      const raw = e.dataTransfer.getData('application/mindsift-doc-ids');
      const ids = raw ? (JSON.parse(raw) as string[]) : [];
      if (ids.length > 0) return ids;
    } catch {
      // fall back below
    }
    const single = e.dataTransfer.getData('application/mindsift-doc-id') || draggingDocId;
    return draggingDocIds.length > 0 ? draggingDocIds : single ? [single] : [];
  };

  // Dropping notes on the trash: they can be restored (toast or the trash itself)
  const handleDropOnTrash = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTrashDragOver(false);
    const ids = draggedDocIds(e);
    setDraggingDocId(null);
    setDraggingDocIds([]);
    setMergeHoverId(null);
    if (ids.length === 0) return;
    triggerHaptic(20);
    const trashed: string[] = [];
    for (const id of ids) {
      try {
        await api.deleteDocument(id);
        trashed.push(id);
      } catch {
        // e.g. a note shared with me: only its owner can delete it
      }
    }
    if (trashed.length === 0) {
      showToast(i18n.t('workspace:dnd.ownOnlyDelete'));
      return;
    }
    setDocs((prev) => prev.filter((d) => !trashed.includes(d.id)));
    if (selectedDocId && trashed.includes(selectedDocId)) {
      setSelectedDocId(null);
      setMobileShowDetail(false);
    }
    setMarkedDocIds(new Set());
    onStatsChange();
    reloadTrash();
    showToast(i18n.t('workspace:dnd.trashed', { count: trashed.length }), [
      {
        label: i18n.t('common:sync.undo'),
        run: async () => {
          for (const id of trashed) {
            await api.restoreDocument(id).catch(() => {});
          }
          await loadWorkspaceData();
          reloadTrash();
          onStatsChange();
        },
      },
    ]);
  };

  const requestMerge = (sourceId: string, targetId?: string) => {
    const source = docs.find((d) => d.id === sourceId);
    if (!source?.isOwner) {
      showToast(i18n.t('workspace:dnd.ownOnlyMerge'));
      return;
    }
    setMergeDialog({ sourceId, targetId });
  };

  // Dropping a dragged note onto another note (instead of a folder) offers to merge them
  const docDropProps = (targetId: string): React.HTMLAttributes<HTMLDivElement> => ({
    onDragOver: (e) => {
      if (!draggingDocId || draggingDocId === targetId || draggingDocIds.length > 1) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (mergeHoverId !== targetId) setMergeHoverId(targetId);
    },
    onDragLeave: () => setMergeHoverId((cur) => (cur === targetId ? null : cur)),
    onDrop: (e) => {
      const sourceId = e.dataTransfer.getData('application/mindsift-doc-id') || draggingDocId;
      if (!sourceId || sourceId === targetId || draggedDocIds(e).length > 1) return;
      e.preventDefault();
      e.stopPropagation();
      setDraggingDocId(null);
      setMergeHoverId(null);
      setDragOverFolder(null);
      requestMerge(sourceId, targetId);
    },
  });

  const handleFolderDragStart = (e: React.DragEvent, path: string) => {
    e.stopPropagation();
    e.dataTransfer.setData('application/mindsift-folder-path', path);
    e.dataTransfer.setData('text/plain', path);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingFolderPath(path);
  };

  const handleDropOnFolder = async (targetFolder: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);

    const docIds = draggedDocIds(e);
    const docId = docIds[0];
    const folderPath = e.dataTransfer.getData('application/mindsift-folder-path') || draggingFolderPath;

    setDraggingDocId(null);
    setDraggingDocIds([]);
    setDraggingFolderPath(null);

    if (docId) {
      triggerHaptic(15);
      try {
        for (const id of docIds) {
          const updatedDoc = await api.moveDocument(id, targetFolder).catch(() => null);
          if (updatedDoc) {
            setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, folderPath: updatedDoc.folderPath } : d)));
          }
        }
        if (docIds.length > 1) setMarkedDocIds(new Set());
        if (targetFolder) {
          const parts = targetFolder.split('/');
          let acc = '';
          const expansions: Record<string, boolean> = {};
          for (const part of parts) {
            acc = acc ? `${acc}/${part}` : part;
            expansions[acc] = true;
          }
          setExpandedFolders((prev) => ({ ...prev, ...expansions }));
        }
      } catch {
        // ignore
      }
    } else if (folderPath && folderPath !== targetFolder && !targetFolder.startsWith(`${folderPath}/`)) {
      triggerHaptic(15);
      try {
        await api.moveFolder(folderPath, targetFolder);
        if (targetFolder) {
          const parts = targetFolder.split('/');
          let acc = '';
          const expansions: Record<string, boolean> = {};
          for (const part of parts) {
            acc = acc ? `${acc}/${part}` : part;
            expansions[acc] = true;
          }
          setExpandedFolders((prev) => ({ ...prev, ...expansions }));
        }
        loadWorkspaceData();
      } catch {
        // ignore
      }
    }
  };

  return {
    draggingDocId,
    markedDocIds,
    setMarkedDocIds,
    trashDragOver,
    setTrashDragOver,
    mergeHoverId,
    draggingFolderPath,
    dragOverFolder,
    setDragOverFolder,
    handleDocRowClick,
    handleDocDragStart,
    handleDropOnTrash,
    docDropProps,
    handleFolderDragStart,
    handleDropOnFolder,
  };
}
