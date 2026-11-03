import React, { useEffect, useRef, useState } from 'react';
import i18n from '../../i18n';
import { api, triggerHaptic } from '../../lib/api';
import { Thought } from '../../lib/types';

export type UndoEntry =
  | { kind: 'delete'; ids: string[] }
  | { kind: 'order'; snapshot: { id: string; sortOrder: number; kanbanStatus?: string; isCompleted: boolean }[] }
  | { kind: 'status'; id: string; isCompleted: boolean; kanbanStatus?: string };

interface TaskUndoOptions {
  tasks: Thought[];
  setTasks: React.Dispatch<React.SetStateAction<Thought[]>>;
  selectedListId: string;
  loadData: () => Promise<void>;
  onRefreshStats: () => void;
}

// Undo in TasksView: a stack of the last steps, Ctrl/Cmd+Z outside text fields, and the short notice
// (with "Undo" after deleting)
export function useTaskUndo({ tasks, setTasks, selectedListId, loadData, onRefreshStats }: TaskUndoOptions) {
  // --- UNDO (Strg+Z / Cmd+Z): deleting, moving and ticking off, newest first; deleted tasks come back
  // from the task trash. Deleting also shows "Undo" for phones.
  const undoStackRef = useRef<UndoEntry[]>([]);
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null);
  const pushUndo = (entry: UndoEntry) => {
    undoStackRef.current = [...undoStackRef.current, entry].slice(-20);
    setToast(null); // its "Undo" would now undo this newer step
  };
  const orderSnapshot = () =>
    tasks.map((t) => ({ id: t.id, sortOrder: t.sortOrder ?? 0, kanbanStatus: t.kanbanStatus, isCompleted: !!t.isCompleted }));
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (text: string, undo = false) => {
    setToast({ text, undo });
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), undo ? 8000 : 3000);
  };
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const undoLast = async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    setToast(null);
    triggerHaptic(10);
    try {
      if (entry.kind === 'delete') {
        for (const id of entry.ids) await api.restoreTrashedTask(id).catch(() => {});
        showToast(i18n.t('tasks:undo.restored', { count: entry.ids.length }));
      } else if (entry.kind === 'order') {
        const byId = new Map(entry.snapshot.map((x) => [x.id, x]));
        setTasks((prev) =>
          prev.map((t) => {
            const old = byId.get(t.id);
            return old ? { ...t, sortOrder: old.sortOrder, kanbanStatus: old.kanbanStatus, isCompleted: old.isCompleted } : t;
          })
        );
        await api.reorderTasks(
          entry.snapshot.map((x) => ({ id: x.id, sortOrder: x.sortOrder, kanbanStatus: x.kanbanStatus })),
          selectedListId !== 'all' ? selectedListId : undefined
        );
        showToast(i18n.t('tasks:undo.moveUndone'));
      } else {
        setTasks((prev) =>
          prev.map((t) => (t.id === entry.id ? { ...t, isCompleted: entry.isCompleted, kanbanStatus: entry.kanbanStatus } : t))
        );
        await api.updateThought(entry.id, { isCompleted: entry.isCompleted, kanbanStatus: entry.kanbanStatus });
        showToast(i18n.t('tasks:undo.undone'));
      }
    } finally {
      await loadData();
      onRefreshStats();
    }
  };
  const undoLastRef = useRef(undoLast);
  undoLastRef.current = undoLast;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      // Text fields keep their own undo
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (undoStackRef.current.length === 0) return;
      e.preventDefault();
      void undoLastRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { toast, pushUndo, orderSnapshot, showToast, undoLast };
}
