import React from 'react';
import i18n from '../../i18n';
import { api, triggerHaptic } from '../../lib/api';
import { KanbanColumn, Recurrence, SubTask, TaskList, Thought, TrashedTask } from '../../lib/types';
import { UndoEntry } from './useTaskUndo';
import { askConfirm } from '../../components/askConfirm';

interface TaskActionsOptions {
  columnsFor: (task: Thought) => KanbanColumn[];
  currentSelectedList: TaskList | undefined;
  doneTasks: Thought[];
  isTaskReadOnly: (task: Thought) => boolean;
  loadData: () => Promise<void>;
  onOpenDocument: (docId: string, blockId?: string) => void;
  onRefreshStats: () => void;
  pushUndo: (entry: UndoEntry) => void;
  selectedListId: string;
  setTasks: React.Dispatch<React.SetStateAction<Thought[]>>;
  showToast: (text: string, undo?: boolean) => void;
}

// What can be done with tasks in TasksView: tick off, column, priority, title, due date, list, notes,
// repetition, assignees, hashtags, subtasks, deepen into a note, delete, and the task trash. Each changes
// the list right away and saves in the background.
export function useTaskActions({
  columnsFor,
  currentSelectedList,
  doneTasks,
  isTaskReadOnly,
  loadData,
  onOpenDocument,
  onRefreshStats,
  pushUndo,
  selectedListId,
  setTasks,
  showToast,
}: TaskActionsOptions) {
  const handleToggleDone = async (task: Thought) => {
    triggerHaptic(15);
    pushUndo({ kind: 'status', id: task.id, isCompleted: !!task.isCompleted, kanbanStatus: task.kanbanStatus });
    const nextState = !task.isCompleted;
    const cols = columnsFor(task);
    const doneCol = cols.find((c) => c.isDone) || cols[cols.length - 1];
    const todoCol = cols.find((c) => !c.isDone) || cols[0];
    const nextKanban = nextState ? (doneCol ? doneCol.id : 'done') : (todoCol ? todoCol.id : 'todo');

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, isCompleted: nextState, kanbanStatus: nextKanban } : t
      )
    );
    await api.updateThought(task.id, { isCompleted: nextState, kanbanStatus: nextKanban });
    onRefreshStats();
  };

  const handleSetKanbanStatus = async (task: Thought, nextStatus: string) => {
    triggerHaptic(15);
    pushUndo({ kind: 'status', id: task.id, isCompleted: !!task.isCompleted, kanbanStatus: task.kanbanStatus });
    const targetCol = columnsFor(task).find((c) => c.id === nextStatus);
    const isCompleted = targetCol ? !!targetCol.isDone : nextStatus === 'done';

    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, kanbanStatus: nextStatus, isCompleted } : t))
    );
    await api.updateThought(task.id, { kanbanStatus: nextStatus, isCompleted });
    onRefreshStats();
  };

  const handleSetPriority = async (task: Thought, nextPriority: string) => {
    triggerHaptic(10);
    const normalized = nextPriority === 'none' || nextPriority === '' ? 'normal' : nextPriority;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, priority: normalized as any } : t))
    );
    await api.updateThought(task.id, { priority: normalized });
    onRefreshStats();
  };

  const handleCyclePriority = async (task: Thought) => {
    triggerHaptic(10);
    const nextPriority =
      task.priority === 'urgent'
        ? 'normal'
        : task.priority === 'high'
        ? 'urgent'
        : 'high';
    await handleSetPriority(task, nextPriority);
  };

  const handleUpdateTaskTitle = async (task: Thought, newTitle: string) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, content: newTitle } : t)));
    await api.updateThought(task.id, { content: newTitle });
    onRefreshStats();
  };

  const handleUpdateTaskDueDate = async (task: Thought, newDate: string) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, dueDate: newDate } : t)));
    await api.updateThought(task.id, { dueDate: newDate });
  };

  const handleUpdateTaskTaskList = async (task: Thought, newListId: string) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, taskListId: newListId } : t)));
    await api.updateThought(task.id, { taskListId: newListId });
    if (selectedListId !== 'all' && selectedListId !== newListId) {
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    }
    onRefreshStats();
  };

  // A task dragged onto a list tab lands in that list like a new task: it keeps its Kanban status
  // if the list has that column, otherwise it starts in the list's first column
  const handleUpdateTaskNotes = async (task: Thought, newNotes: string) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, notes: newNotes } : t)));
    await api.updateThought(task.id, { notes: newNotes });
  };

  const handleUpdateTaskRecurrence = async (task: Thought, recurrence: Recurrence) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, recurrence } : t)));
    try {
      await api.updateThought(task.id, { recurrence });
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, recurrence: task.recurrence } : t)));
    }
  };

  const handleUpdateTaskAssignees = async (task: Thought, assignees: string[]) => {
    triggerHaptic(10);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, assignees } : t)));
    try {
      const updated = await api.updateThought(task.id, { assignees });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, assignees: updated.assignees || [] } : t)));
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, assignees: task.assignees } : t)));
    }
  };

  const handleUpdateTaskTags = async (task: Thought, newTags: string[]) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, tags: newTags } : t)));
    await api.updateThought(task.id, { tags: newTags });
    onRefreshStats();
  };

  const handleToggleSubtask = async (task: Thought, subtaskId: string) => {
    triggerHaptic(10);
    const updatedSubtasks = (task.subtasks || []).map((s) =>
      s.id === subtaskId ? { ...s, isCompleted: !s.isCompleted } : s
    );
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, subtasks: updatedSubtasks } : t))
    );
    await api.updateThought(task.id, { subtasks: updatedSubtasks });
  };

  const handleAddSubtask = async (task: Thought, title: string) => {
    triggerHaptic(10);
    const newSub: SubTask = {
      id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim(),
      isCompleted: false,
      createdAt: new Date().toISOString(),
    };
    const updatedSubtasks = [...(task.subtasks || []), newSub];
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, subtasks: updatedSubtasks } : t))
    );
    await api.updateThought(task.id, { subtasks: updatedSubtasks });
  };

  const handleDeleteSubtask = async (task: Thought, subtaskId: string) => {
    triggerHaptic(10);
    const updatedSubtasks = (task.subtasks || []).filter((s) => s.id !== subtaskId);
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, subtasks: updatedSubtasks } : t))
    );
    await api.updateThought(task.id, { subtasks: updatedSubtasks });
  };

  // New order of the subtasks (ids in the wanted order); the server keeps their note links by id
  const handleReorderSubtasks = async (task: Thought, orderedIds: string[]) => {
    const byId = new Map((task.subtasks || []).map((st) => [st.id, st]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter((st): st is SubTask => !!st);
    if (reordered.length !== byId.size) return;
    triggerHaptic(10);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, subtasks: reordered } : t)));
    await api.updateThought(task.id, { subtasks: reordered });
  };

  const handleConvertToDoc = async (task: Thought) => {
    triggerHaptic(20);
    // Already linked to a note: open it instead of creating another one
    if (task.docId) {
      onOpenDocument(task.docId, task.blockId);
      return;
    }
    const updated = await api.triageAction(task.id, 'keep', { convertTo: 'document' });
    onRefreshStats();
    // The task stays in its list, linked to the note's first checkbox (docId); open that note
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    const docId = updated.docId || (updated.convertedType === 'document' ? updated.convertedRefId : '');
    if (docId) {
      onOpenDocument(docId);
    } else {
      loadData();
    }
  };

  // Deleting a task puts it into the task trash (task_trash.go)
  const handleDeletePermanent = async (id: string) => {
    triggerHaptic(20);
    await api.deleteThought(id);
    pushUndo({ kind: 'delete', ids: [id] });
    showToast(i18n.t('tasks:actions.trashed', { count: 1 }), true);
    await loadData();
    onRefreshStats();
  };

  const handleRestoreTrashed = async (item: TrashedTask) => {
    triggerHaptic(15);
    await api.restoreTrashedTask(item.id);
    await loadData();
    onRefreshStats();
  };

  const handlePurgeTrashed = async (item: TrashedTask) => {
    triggerHaptic(20);
    await api.purgeTrashedTask(item.id);
    await loadData();
  };

  const handleClearDone = async () => {
    triggerHaptic(20);
    // The ones that will go (completed and editable here), for undo
    const ids = doneTasks.filter((t) => !isTaskReadOnly(t)).map((t) => t.id);
    await api.clearDoneTasks(selectedListId === 'all' ? '' : selectedListId);
    if (ids.length > 0) {
      pushUndo({ kind: 'delete', ids });
      showToast(i18n.t('tasks:actions.trashed', { count: ids.length }), true);
    }
    await loadData();
    onRefreshStats();
  };

  const handleEmptyTaskTrash = async () => {
    const message =
      selectedListId === 'all'
        ? i18n.t('tasks:actions.confirmEmptyAll')
        : i18n.t('tasks:actions.confirmEmptyList', { title: currentSelectedList?.title || i18n.t('tasks:actions.thisList') });
    if (!(await askConfirm({ message, confirmLabel: i18n.t('tasks:view.emptyTrash'), danger: true }))) return;
    triggerHaptic(20);
    await api.emptyTaskTrash(selectedListId === 'all' ? '' : selectedListId);
    await loadData();
  };

  return {
    handleToggleDone,
    handleSetKanbanStatus,
    handleSetPriority,
    handleCyclePriority,
    handleUpdateTaskTitle,
    handleUpdateTaskDueDate,
    handleUpdateTaskTaskList,
    handleUpdateTaskNotes,
    handleUpdateTaskRecurrence,
    handleUpdateTaskAssignees,
    handleUpdateTaskTags,
    handleToggleSubtask,
    handleAddSubtask,
    handleDeleteSubtask,
    handleReorderSubtasks,
    handleConvertToDoc,
    handleDeletePermanent,
    handleRestoreTrashed,
    handlePurgeTrashed,
    handleClearDone,
    handleEmptyTaskTrash,
  };
}
