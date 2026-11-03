import React, { useEffect } from 'react';
import { api } from '../../lib/api';
import { TaskList, Thought } from '../../lib/types';

// Same rule as the server's task query: a fresh Quick Dump note (status inbox) is no task yet
export const isTaskThought = (t: Thought) =>
  t.status === 'kept' || (t.status === 'converted' && t.convertedType === 'task');

// How a realtime event changes the task list of the open view (listId 'all' = every list)

export function tasksAfterCreate(prev: Thought[], created: Thought, listId: string): Thought[] {
  if (prev.some((t) => t.id === created.id)) return prev;
  if (listId !== 'all' && created.taskListId !== listId) return prev;
  return [created, ...prev];
}

export function tasksAfterUpdate(prev: Thought[], updated: Thought, listId: string): Thought[] {
  const exists = prev.some((t) => t.id === updated.id);
  if (!exists) {
    if (
      isTaskThought(updated) &&
      (listId === 'all' || updated.taskListId === listId)
    ) {
      return [updated, ...prev];
    }
    return prev;
  }
  // Undone back into the Quick Dump, discarded, or moved to another list
  if (
    !isTaskThought(updated) ||
    (listId !== 'all' && updated.taskListId !== listId)
  ) {
    return prev.filter((t) => t.id !== updated.id);
  }
  return prev.map((t) => (t.id === updated.id ? updated : t));
}

export function tasksAfterDelete(prev: Thought[], deletedId: string): Thought[] {
  return prev.filter((t) => t.id !== deletedId);
}

interface TaskRealtimeOptions {
  setTasks: React.Dispatch<React.SetStateAction<Thought[]>>;
  setTaskLists: React.Dispatch<React.SetStateAction<TaskList[]>>;
  // Refs, because the handler is registered once and must see the current list and callbacks
  listIdRef: React.MutableRefObject<string>;
  onRefreshStatsRef: React.MutableRefObject<() => void>;
  loadDataRef: React.MutableRefObject<() => Promise<void>>;
}

// Realtime updates of TasksView: created, changed, deleted and reordered tasks and changed task lists
export function useTaskRealtime({ setTasks, setTaskLists, listIdRef, onRefreshStatsRef, loadDataRef }: TaskRealtimeOptions) {
  // Live-Sync WebSocket listener for tasks (registered once on mount; all dependencies are stable)
  useEffect(() => {
    const handleWs = (e: any) => {
      const msg = e.detail;
      if (!msg || !msg.event) return;

      if (msg.event === 'TASK_CREATED') {
        const created = msg.payload as Thought;
        if (created && isTaskThought(created)) {
          setTasks((prev) => tasksAfterCreate(prev, created, listIdRef.current));
          onRefreshStatsRef.current();
        }
      } else if (msg.event === 'TASK_UPDATED') {
        const updated = msg.payload as Thought;
        if (updated && updated.id) {
          setTasks((prev) => tasksAfterUpdate(prev, updated, listIdRef.current));
          onRefreshStatsRef.current();
        }
      } else if (msg.event === 'TASK_DELETED') {
        const deletedId = typeof msg.payload === 'string' ? msg.payload : msg.payload?.id;
        if (deletedId) {
          setTasks((prev) => tasksAfterDelete(prev, deletedId));
          onRefreshStatsRef.current();
        }
      } else if (msg.event === 'TASK_REORDERED') {
        loadDataRef.current();
      } else if (msg.event === 'TASK_LIST_CREATED' || msg.event === 'TASK_LIST_UPDATED' || msg.event === 'TASK_LIST_DELETED') {
        // Payload only carries the list ID; reload so permissions reflect this user's view
        api.getTaskLists().then((lists) => setTaskLists(Array.isArray(lists) ? lists : [])).catch(() => {});
      }
    };

    window.addEventListener('mindsift:ws', handleWs);
    return () => window.removeEventListener('mindsift:ws', handleWs);
  }, [setTasks, setTaskLists, listIdRef, onRefreshStatsRef, loadDataRef]);
}
