import React, { useEffect, useRef } from 'react';
import { useToast } from '../../components/Toast';
import i18n from '../../i18n';
import { api, triggerHaptic } from '../../lib/api';
import { PriorityLevel, Thought } from '../../lib/types';
import { useLatestRef } from '../../lib/useLatestRef';
import { tasksAfterReorder } from './useTaskRealtime';
import { MoveTracker, applyMoveAnswer, changedOrder } from './taskMoves';

export type UndoEntry =
  | { kind: 'delete'; ids: string[] }
  // priority: the dragged task's priority before it was dropped in a priority group of the list view
  | {
      kind: 'order';
      snapshot: { id: string; sortOrder: number; kanbanStatus?: string; isCompleted: boolean }[];
      priority?: { id: string; priority: PriorityLevel };
    }
  | { kind: 'status'; id: string; isCompleted: boolean; kanbanStatus?: string }
  | { kind: 'due'; id: string; dueDate: string };

interface TaskUndoOptions {
  tasks: Thought[];
  setTasks: React.Dispatch<React.SetStateAction<Thought[]>>;
  selectedListId: string;
  loadData: () => Promise<void>;
  onRefreshStats: () => void;
  // The board's moves on their way: undoing a move is one of them (taskMoves.ts)
  moveTracker: MoveTracker;
}

// Undo in TasksView: a stack of the last steps, Ctrl/Cmd+Z outside text fields, and the short notice
// (with "Undo" after deleting)
export function useTaskUndo({ tasks, setTasks, selectedListId, loadData, onRefreshStats, moveTracker }: TaskUndoOptions) {
  const loadDataRef = useLatestRef(loadData);
  // --- UNDO (Strg+Z / Cmd+Z): deleting, moving and ticking off, newest first; deleted tasks come back
  // from the task trash. Deleting also shows "Undo" for phones.
  const undoStackRef = useRef<UndoEntry[]>([]);
  const { toast, showToast: showNotice, hideToast } = useToast();
  const pushUndo = (entry: UndoEntry) => {
    undoStackRef.current = [...undoStackRef.current, entry].slice(-20);
    hideToast(); // its "Undo" would now undo this newer step
  };
  const orderSnapshot = () =>
    tasks.map((t) => ({ id: t.id, sortOrder: t.sortOrder ?? 0, kanbanStatus: t.kanbanStatus, isCompleted: !!t.isCompleted }));
  const showToast = (text: string, undo = false) =>
    showNotice(
      text,
      undo ? [{ label: i18n.t('triage:undo'), title: i18n.t('tasks:view.undoTitle'), run: () => void undoLast() }] : []
    );

  const undoLast = async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    hideToast();
    triggerHaptic(10);
    // Undoing a move takes the places from the server's answer like the move did; the other steps load
    // the tasks again afterwards
    let reload = true;
    try {
      if (entry.kind === 'delete') {
        for (const id of entry.ids) await api.restoreTrashedTask(id).catch(() => {});
        showToast(i18n.t('tasks:undo.restored', { count: entry.ids.length }));
      } else if (entry.kind === 'order') {
        reload = false;
        const byId = new Map(entry.snapshot.map((x) => [x.id, x]));
        // Only the tasks the move changed go back (the server leaves the others as they are)
        const payload = changedOrder(
          tasks,
          entry.snapshot.map((x) => ({ id: x.id, sortOrder: x.sortOrder, kanbanStatus: x.kanbanStatus }))
        ).filter((x) => tasks.some((t) => t.id === x.id));
        const oldPriority = entry.priority;
        setTasks((prev) =>
          prev.map((t) => {
            const old = byId.get(t.id);
            const moved = old ? { ...t, sortOrder: old.sortOrder, kanbanStatus: old.kanbanStatus, isCompleted: old.isCompleted } : t;
            return oldPriority?.id === t.id ? { ...moved, priority: oldPriority.priority } : moved;
          })
        );
        if (oldPriority) {
          await api.updateThought(oldPriority.id, { priority: oldPriority.priority }).catch(() => void loadDataRef.current());
        }
        if (payload.length > 0) {
          const seq = moveTracker.begin(payload);
          const res = await api.reorderTasks(payload, selectedListId !== 'all' ? selectedListId : undefined).catch(() => null);
          applyMoveAnswer(
            moveTracker,
            seq,
            res,
            (items, skipped) => setTasks((prev) => tasksAfterReorder(prev, items, skipped)),
            () => void loadDataRef.current()
          );
        }
        showToast(i18n.t('tasks:undo.moveUndone'));
      } else if (entry.kind === 'due') {
        setTasks((prev) => prev.map((t) => (t.id === entry.id ? { ...t, dueDate: entry.dueDate } : t)));
        await api.updateThought(entry.id, { dueDate: entry.dueDate });
        showToast(i18n.t('tasks:undo.undone'));
      } else {
        setTasks((prev) =>
          prev.map((t) => (t.id === entry.id ? { ...t, isCompleted: entry.isCompleted, kanbanStatus: entry.kanbanStatus } : t))
        );
        await api.updateThought(entry.id, { isCompleted: entry.isCompleted, kanbanStatus: entry.kanbanStatus });
        showToast(i18n.t('tasks:undo.undone'));
      }
    } finally {
      if (reload) await loadDataRef.current();
      onRefreshStats();
    }
  };
  const undoLastRef = useLatestRef(undoLast);
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
  }, [undoLastRef]);

  return { toast, hideToast, pushUndo, orderSnapshot, showToast, undoLast };
}
