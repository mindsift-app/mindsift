import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, triggerHaptic } from '../../lib/api';
import { KanbanColumn, PriorityLevel, TaskList, Thought } from '../../lib/types';
import { useKanbanTouchDrag } from './useKanbanTouchDrag';
import { tasksAfterReorder } from './useTaskRealtime';
import { MoveTracker, ReorderItem, applyMoveAnswer, changedOrder } from './taskMoves';
import { startElementDragGhost } from '../../lib/dragGhost';
import { useLatestRef } from '../../lib/useLatestRef';
import { GroupDrop, TaskGroup, priorityGroupOf } from './taskListing';
import { GroupBy } from './taskViewTypes';

// Drag & drop needs a mouse or pen; on touch-only devices a draggable row can swallow a slightly
// longer tap, so the row would not open
export const canDragTasks =
  typeof window !== 'undefined' && !!window.matchMedia?.('(any-pointer: fine)').matches;

type OrderSnapshot = { id: string; sortOrder: number; kanbanStatus?: string; isCompleted: boolean }[];

interface TaskDragOptions {
  tasks: Thought[];
  setTasks: React.Dispatch<React.SetStateAction<Thought[]>>;
  columnsFor: (task: Thought) => KanbanColumn[];
  // The task's own column behind a board column, or null if its list has no column of that name
  ownColumnIdFor: (task: Thought | undefined, boardColId: string) => string | null;
  // The board column a task stands in (that of its own column), or null
  boardColumnOf: (task: Thought) => string | null;
  isTaskReadOnly: (task: Thought) => boolean;
  pushUndo: (entry: { kind: 'order'; snapshot: OrderSnapshot; priority?: { id: string; priority: PriorityLevel } }) => void;
  orderSnapshot: () => OrderSnapshot;
  setSortBy: (sort: 'custom') => void;
  selectedListId: string;
  loadData: () => Promise<void>;
  globalColumns: KanbanColumn[];
  setTaskLists: React.Dispatch<React.SetStateAction<TaskList[]>>;
  onRefreshStats: () => void;
  viewMode: string;
  // Grouping of the list view: a row drop takes over what the target's group stands for (status, priority)
  groupBy: GroupBy;
  kanbanBoardRef: React.RefObject<HTMLDivElement | null>;
  kanbanPhoneSnap: boolean;
  kanbanPhoneTop: number;
  moveTracker: MoveTracker;
}

// Moving tasks in TasksView by dragging: HTML5 drag & drop with mouse or pen (list rows, Kanban cards and
// columns, list tabs) and the finger drag on the Kanban board (useKanbanTouchDrag), both ending in the
// same moves and one reorder call.
export function useTaskDrag({
  tasks,
  setTasks,
  columnsFor,
  ownColumnIdFor,
  boardColumnOf,
  isTaskReadOnly,
  pushUndo,
  orderSnapshot,
  setSortBy,
  selectedListId,
  loadData,
  globalColumns,
  setTaskLists,
  onRefreshStats,
  viewMode,
  groupBy,
  kanbanBoardRef,
  kanbanPhoneSnap,
  kanbanPhoneTop,
  moveTracker,
}: TaskDragOptions) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverTaskTarget, setDragOverTaskTarget] = useState<{ taskId: string; position: 'before' | 'after' } | null>(null);
  const [dragOverKanbanCol, setDragOverKanbanCol] = useState<string | null>(null);
  // Kanban drag: the column works out the slot from the pointer; a gap of the card's height opens there
  // (no per-card enter/leave flicker), the dragged card leaves its old place, and lights up where it lands
  const [kanbanSlot, setKanbanSlot] = useState<{ col: string; index: number } | null>(null);
  const [kanbanHiddenId, setKanbanHiddenId] = useState<string | null>(null);
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null);
  const dragHeightRef = useRef(64);
  // List tab a dragged task hovers over (dropping moves it into that list)
  const [dragOverListTab, setDragOverListTab] = useState<string | null>(null);
  // List view grouped by status or priority: the key of the group whose header or drop strip a dragged
  // task hovers over (dropping moves it into that column or gives it that priority)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  const handleDropOnListTab = async (e: React.DragEvent, list: TaskList) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('application/mindsift-task-id') || draggingTaskId;
    setDraggingTaskId(null);
    setDragOverTaskTarget(null);
    setDragOverKanbanCol(null);
    setDragOverListTab(null);
    const task = tasks.find((t) => t.id === sourceId);
    if (!task || task.taskListId === list.id || list.permission === 'viewer') return;
    triggerHaptic(15);
    const columns = Array.isArray(list.columns) && list.columns.length > 0 ? list.columns : globalColumns;
    const keepStatus = !task.kanbanStatus || columns.some((c) => c.id === task.kanbanStatus);
    const kanbanStatus = keepStatus ? task.kanbanStatus : (columns.find((c) => !c.isDone) || columns[0])?.id;
    setTasks((prev) =>
      selectedListId !== 'all'
        ? prev.filter((t) => t.id !== task.id)
        : prev.map((t) => (t.id === task.id ? { ...t, taskListId: list.id, kanbanStatus } : t))
    );
    try {
      await api.updateThought(task.id, { taskListId: list.id, ...(keepStatus ? {} : { kanbanStatus }) });
    } catch {
      loadData();
    }
    api.getTaskLists().then((lists) => setTaskLists(Array.isArray(lists) ? lists : [])).catch(() => {});
    onRefreshStats();
  };

  const handleTaskDragStart = (e: React.DragEvent, task: Thought) => {
    e.stopPropagation();
    if (isTaskReadOnly(task)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/mindsift-task-id', task.id);
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    // Half transparent, so the list tab or column under the pointer stays visible
    startElementDragGhost(e, e.currentTarget as HTMLElement);
    setDraggingTaskId(task.id);
  };

  const handleTaskDragOver = (e: React.DragEvent, targetTaskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingTaskId || draggingTaskId === targetTaskId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';

    if (
      !dragOverTaskTarget ||
      dragOverTaskTarget.taskId !== targetTaskId ||
      dragOverTaskTarget.position !== position
    ) {
      setDragOverTaskTarget({ taskId: targetTaskId, position });
    }
  };

  const handleTaskDragLeave = (e: React.DragEvent, targetTaskId: string) => {
    e.stopPropagation();
    if (dragOverTaskTarget?.taskId === targetTaskId) {
      setDragOverTaskTarget(null);
    }
  };

  const handleDropOnTask = async (e: React.DragEvent, targetTask: Thought, newKanbanCol?: string) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceId =
      e.dataTransfer.getData('application/mindsift-task-id') ||
      e.dataTransfer.getData('text/plain') ||
      draggingTaskId;

    const position = dragOverTaskTarget?.position || 'after';
    setDraggingTaskId(null);
    setDragOverTaskTarget(null);
    setDragOverKanbanCol(null);
    // Dropped on a row of a grouped list, the task takes over what the target's group stands for, like a
    // drop on that group's header: by status the target's board column (as the column of its own list; if
    // its list has none, it only changes its place), by priority the target's priority. Otherwise (flat
    // list, other groupings, calendar) it only changes its place.
    let priority: PriorityLevel | undefined;
    if (!newKanbanCol && sourceId) {
      const change = groupChange(sourceId, rowGroupDrop(targetTask));
      newKanbanCol = change?.column;
      priority = change?.priority;
    }
    await moveTaskNextTo(sourceId, targetTask, position, newKanbanCol, priority);
  };

  // The group a row stands in, as a drop target: only in the list view grouped by status or priority (a row
  // stands for its group like the header, whoever may change the task in it)
  const rowGroupDrop = (target: Thought): GroupDrop | null => {
    if (viewMode !== 'list') return null;
    if (groupBy === 'status') {
      const columnId = boardColumnOf(target);
      return columnId ? { kind: 'status', columnId } : null;
    }
    if (groupBy === 'priority') return { kind: 'priority', priority: priorityGroupOf(target) };
    return null;
  };

  // What a drop on a group changes for the dragged task: the column of its own list behind a status group
  // (null if its list has none: no drop), or the priority of a priority group (nothing if it already
  // stands there, so a low one stays low within "Normal"; null for a task the person may not change)
  const groupChange = (sourceId: string | null, drop: GroupDrop | null): { column?: string; priority?: PriorityLevel } | null => {
    const source = tasks.find((t) => t.id === sourceId);
    if (!source || !drop) return null;
    if (drop.kind === 'status') {
      const column = ownColumnIdFor(source, drop.columnId);
      return column ? { column } : null;
    }
    if (isTaskReadOnly(source)) return null;
    return priorityGroupOf(source) === drop.priority ? {} : { priority: drop.priority };
  };

  // Saves a move and takes the places from the server's answer: tasks deleted meanwhile drop out, the done
  // state follows the list's done column. Only the tasks whose place or column changed are sent. An answer
  // overtaken by a newer move is not applied (the newer one brings the places); a failed call or a new
  // successor of a repeating task loads everything once no move is on its way.
  // The answer may come after another list was opened: load the one shown then
  const loadDataRef = useLatestRef(loadData);
  const saveOrder = async (before: Thought[], order: ReorderItem[]) => {
    const payload = changedOrder(before, order);
    if (payload.length === 0) return;
    const seq = moveTracker.begin(payload);
    const res = await api.reorderTasks(payload, selectedListId !== 'all' ? selectedListId : undefined).catch(() => null);
    applyMoveAnswer(
      moveTracker,
      seq,
      res,
      (items, skipped) => setTasks((prev) => tasksAfterReorder(prev, items, skipped)),
      () => void loadDataRef.current()
    );
  };

  // Shared by mouse drag & drop and the touch drag on the Kanban board; without a column (newKanbanCol, one
  // of the task's own list) the task keeps its status and only changes its place, without a priority (a
  // drop in a priority group of the list view) it keeps its priority
  const moveTaskNextTo = async (
    sourceId: string | null,
    targetTask: Thought,
    position: 'before' | 'after',
    newKanbanCol?: string,
    priority?: PriorityLevel
  ) => {
    if (!sourceId || sourceId === targetTask.id) return;
    triggerHaptic(15);

    const sourceTask = tasks.find((t) => t.id === sourceId);
    if (!sourceTask) return;

    const remainingTasks = tasks.filter((t) => t.id !== sourceId);
    const targetIdx = remainingTasks.findIndex((t) => t.id === targetTask.id);
    if (targetIdx === -1) return;

    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
    const updatedSourceTask: Thought = {
      ...sourceTask,
      kanbanStatus: newKanbanCol || sourceTask.kanbanStatus,
      isCompleted: newKanbanCol
        ? !!columnsFor(sourceTask).find((c) => c.id === newKanbanCol)?.isDone || newKanbanCol === 'done'
        : sourceTask.isCompleted,
      priority: priority ?? sourceTask.priority,
    };

    const newTasks = [...remainingTasks];
    newTasks.splice(insertIdx, 0, updatedSourceTask);
    await applyMove(sourceTask, newTasks, priority);
  };

  // Shows a move at once and saves it: places and columns in one reorder call, a new priority with the
  // task. Undo puts both back.
  const applyMove = async (sourceTask: Thought, newTasks: Thought[], priority?: PriorityLevel) => {
    const updatedWithSort = newTasks.map((t, idx) => ({
      ...t,
      sortOrder: idx,
    }));

    pushUndo({
      kind: 'order',
      snapshot: orderSnapshot(),
      ...(priority ? { priority: { id: sourceTask.id, priority: sourceTask.priority } } : {}),
    });
    setTasks(updatedWithSort);
    setSortBy('custom');

    const reorderPayload = updatedWithSort.map((t) => ({
      id: t.id,
      sortOrder: t.sortOrder ?? 0,
      kanbanStatus: t.kanbanStatus,
    }));

    await Promise.all([
      saveOrder(tasks, reorderPayload),
      priority &&
        api
          .updateThought(sourceTask.id, { priority })
          .then(() => onRefreshStats())
          .catch(() => void loadDataRef.current()),
    ]);
  };

  const resetKanbanDrag = () => {
    setDraggingTaskId(null);
    setDragOverTaskTarget(null);
    setDragOverKanbanCol(null);
    setDragOverListTab(null);
    setKanbanSlot(null);
    setKanbanHiddenId(null);
  };

  // The gap where the dragged card would land: one per column list, invisible until a mouse drag needs it.
  // useKanbanSlotShift moves it to the insert position at the card's height (fading in, gliding along within
  // a column) and moves the cards below it down by a transform, so the layout of the column stays as it is.
  const renderDropSlot = () =>
    canDragTasks ? (
      <div
        data-kanban-slot=""
        className="absolute left-2 right-2 top-0 opacity-0 rounded-card border-2 border-dashed border-accent/50 bg-accent/5 pointer-events-none"
        aria-hidden="true"
      />
    ) : null;

  const handleKanbanColDragOver = (e: React.DragEvent<HTMLDivElement>, colId: string) => {
    if (!draggingTaskId) return;
    // A column the card's list does not have takes nothing (no preventDefault = no drop allowed)
    if (!ownColumnIdFor(tasks.find((t) => t.id === draggingTaskId), colId)) return;
    e.preventDefault();
    if (dragOverKanbanCol !== colId) setDragOverKanbanCol(colId);
    // Slot = number of cards (without the dragged one) whose middle lies above the pointer
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-kanban-task]')).filter(
      (el) => el.dataset.kanbanTask !== draggingTaskId
    );
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    if (!kanbanSlot || kanbanSlot.col !== colId || kanbanSlot.index !== index) setKanbanSlot({ col: colId, index });
  };

  const handleKanbanColDragLeave = (e: React.DragEvent<HTMLDivElement>, colId: string) => {
    // Moving onto a child of the column is no leaving
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverKanbanCol === colId) setDragOverKanbanCol(null);
    setKanbanSlot((cur) => (cur?.col === colId ? null : cur));
  };

  const handleKanbanDrop = async (e: React.DragEvent, colId: string, colTasks: Thought[]) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId =
      e.dataTransfer.getData('application/mindsift-task-id') || e.dataTransfer.getData('text/plain') || draggingTaskId;
    const slot = kanbanSlot;
    resetKanbanDrag();
    if (!sourceId) return;
    const ownColId = ownColumnIdFor(tasks.find((t) => t.id === sourceId), colId);
    if (!ownColId) return;
    // Set with the move in one render: the card shows up marked in its new place, not a moment later
    setJustDroppedId(sourceId);
    window.setTimeout(() => setJustDroppedId((cur) => (cur === sourceId ? null : cur)), 900);
    const others = colTasks.filter((t) => t.id !== sourceId);
    if (others.length === 0 || !slot || slot.col !== colId) {
      await moveTaskToColumn(sourceId, ownColId);
    } else if (slot.index < others.length) {
      await moveTaskNextTo(sourceId, others[slot.index], 'before', ownColId);
    } else {
      await moveTaskNextTo(sourceId, others[others.length - 1], 'after', ownColId);
    }
  };

  // Whether the dragged task can go into a group of the list view: a status group if its list has a
  // column of that name (in "Alle Aufgaben" the groups are the columns of all lists joined by name), a
  // priority group if the person may change the task
  const canDropInGroup = (drop: GroupDrop) => !!draggingTaskId && !!groupChange(draggingTaskId, drop);

  const handleGroupDragOver = (e: React.DragEvent, group: TaskGroup) => {
    if (!group.drop || !canDropInGroup(group.drop)) return;
    e.preventDefault();
    if (dragOverGroup !== group.key) setDragOverGroup(group.key);
  };

  const handleGroupDragLeave = (e: React.DragEvent, group: TaskGroup) => {
    // Moving onto a child of the target is no leaving
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverGroup((cur) => (cur === group.key ? null : cur));
  };

  // A task dropped on a group's header (or the strip below it) moves into that column or takes that
  // priority, after the group's last task; into an empty group it simply goes
  const handleDropOnGroup = async (e: React.DragEvent, group: TaskGroup) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId =
      e.dataTransfer.getData('application/mindsift-task-id') || e.dataTransfer.getData('text/plain') || draggingTaskId;
    setDraggingTaskId(null);
    setDragOverTaskTarget(null);
    setDragOverGroup(null);
    const change = groupChange(sourceId, group.drop ?? null);
    if (!sourceId || !change) return;
    const others = group.tasks.filter((t) => t.id !== sourceId);
    if (others.length === 0) await moveTaskToColumn(sourceId, change.column, change.priority);
    else await moveTaskNextTo(sourceId, others[others.length - 1], 'after', change.column, change.priority);
  };

  // A drag that ends outside any column (Escape, dropped elsewhere) leaves nothing behind
  useEffect(() => {
    if (!draggingTaskId) return;
    const end = () => {
      setKanbanSlot(null);
      setKanbanHiddenId(null);
      setDragOverGroup(null);
    };
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, [draggingTaskId]);

  // Puts the task first, into the column colId (one of its own list) and with the priority where given: an
  // empty Kanban column or an empty group of the list view
  const moveTaskToColumn = async (sourceId: string | null, colId?: string, priority?: PriorityLevel) => {
    if (!sourceId) return;
    triggerHaptic(15);

    const sourceTask = tasks.find((t) => t.id === sourceId);
    if (!sourceTask) return;

    const targetCol = colId ? columnsFor(sourceTask).find((c) => c.id === colId) : undefined;
    const isDone = targetCol ? !!targetCol.isDone : colId === 'done';
    const updatedSourceTask: Thought = {
      ...sourceTask,
      ...(colId ? { kanbanStatus: colId, isCompleted: isDone } : {}),
      priority: priority ?? sourceTask.priority,
    };

    const remainingTasks = tasks.filter((t) => t.id !== sourceId);
    await applyMove(sourceTask, [updatedSourceTask, ...remainingTasks], priority);
  };

  // Kanban with a finger: hold a card, drag it, let go (mouse and pen use HTML5 drag & drop)
  const clearDragState = () => {
    setDraggingTaskId(null);
    setDragOverTaskTarget(null);
    setDragOverKanbanCol(null);
  };
  // Page positions of the phone board's snap points: the page top (bar and first column) and the start of
  // every further column
  const phoneSnapPoints = useCallback(() => {
    const points = new Set<number>([0]); // page top: bar and first column
    kanbanBoardRef.current?.querySelectorAll<HTMLElement>('[data-kanban-col]').forEach((c, i) => {
      if (i > 0) points.add(Math.max(0, Math.round(c.getBoundingClientRect().top + window.scrollY - kanbanPhoneTop)));
    });
    return Array.from(points).sort((a, b) => a - b);
  }, [kanbanBoardRef, kanbanPhoneTop]);
  const kanbanTouch = useKanbanTouchDrag({
    enabled: !canDragTasks && viewMode === 'kanban',
    onStart: (taskId) => setDraggingTaskId(taskId),
    onHover: (colId, target) => {
      const allowed = !!colId && !!ownColumnIdFor(tasks.find((t) => t.id === draggingTaskId), colId);
      setDragOverKanbanCol(allowed ? colId : null);
      setDragOverTaskTarget(allowed ? target : null);
    },
    onDrop: (taskId, colId, target) => {
      clearDragState();
      const ownColId = colId ? ownColumnIdFor(tasks.find((t) => t.id === taskId), colId) : null;
      if (!ownColId) return;
      const targetTask = target ? tasks.find((t) => t.id === target.taskId) : undefined;
      if (targetTask && target) void moveTaskNextTo(taskId, targetTask, target.position, ownColId);
      else void moveTaskToColumn(taskId, ownColId);
    },
    onCancel: clearDragState,
    snapPoints: kanbanPhoneSnap ? phoneSnapPoints : undefined,
  });

  // Phones: the page snaps to its top and to each column; while a card is dragged it does not (the drag
  // moves the page from column to column itself, see useKanbanTouchDrag)
  useEffect(() => {
    if (!kanbanPhoneSnap) return;
    const root = document.documentElement;
    root.style.scrollPaddingTop = `${kanbanPhoneTop}px`;
    root.style.scrollSnapType = kanbanTouch.dragging ? 'none' : 'y mandatory';
    return () => {
      root.style.scrollSnapType = '';
      root.style.scrollPaddingTop = '';
    };
  }, [kanbanPhoneSnap, kanbanPhoneTop, kanbanTouch.dragging]);

  return {
    draggingTaskId,
    setDraggingTaskId,
    dragOverTaskTarget,
    setDragOverTaskTarget,
    dragOverKanbanCol,
    setDragOverKanbanCol,
    kanbanSlot,
    kanbanHiddenId,
    setKanbanHiddenId,
    justDroppedId,
    setJustDroppedId,
    dragHeightRef,
    dragOverListTab,
    setDragOverListTab,
    handleDropOnListTab,
    handleTaskDragStart,
    handleTaskDragOver,
    handleTaskDragLeave,
    handleDropOnTask,
    resetKanbanDrag,
    renderDropSlot,
    handleKanbanColDragOver,
    handleKanbanColDragLeave,
    handleKanbanDrop,
    dragOverGroup,
    canDropInGroup,
    handleGroupDragOver,
    handleGroupDragLeave,
    handleDropOnGroup,
    kanbanTouch,
  };
}
