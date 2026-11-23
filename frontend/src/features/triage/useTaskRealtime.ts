import React from 'react';
import { api, getCurrentUserId } from '../../lib/api';
import { TaskList, TaskOrder, TaskReorderResult, Thought } from '../../lib/types';
import { useRealtimeReload } from '../../lib/realtimeReload';
import { useRealtimeEvents } from '../../lib/useRealtimeEvents';
import { MoveTracker } from './taskMoves';

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
  return prev.map((t) => (t.id === updated.id ? mergeUpdated(t, updated) : t));
}

// The task as an event tells it, with what the event does not carry kept from the one shown: watching is
// per person and not part of what everyone gets (TASK_UPDATED leaves it out), and an event without
// assignees (null, from an older server or a path that did not load them) does not clear them. An empty
// list is a change and is taken.
function mergeUpdated(shown: Thought, updated: Thought): Thought {
  const keepWatching = updated.isWatching === undefined && shown.isWatching !== undefined;
  const keepAssignees = updated.assignees == null && shown.assignees != null;
  if (!keepWatching && !keepAssignees) return updated;
  return {
    ...updated,
    ...(keepWatching ? { isWatching: shown.isWatching } : {}),
    ...(keepAssignees ? { assignees: shown.assignees } : {}),
  };
}

export function tasksAfterDelete(prev: Thought[], deletedId: string): Thought[] {
  return prev.filter((t) => t.id !== deletedId);
}

// A move as the server stored it: place, column and done state of the tasks it names (the view sorts by
// sortOrder). skipped (only from the answer to one's own move): tasks deleted or no longer in the list.
// Unchanged tasks keep their object, and nothing changed keeps the array.
export function tasksAfterReorder(prev: Thought[], items: TaskOrder[] | undefined, skipped?: string[]): Thought[] {
  const byId = new Map((items ?? []).map((it) => [it.id, it]));
  const gone = new Set(skipped ?? []);
  let changed = false;
  const next: Thought[] = [];
  for (const t of prev) {
    if (gone.has(t.id)) {
      changed = true;
      continue;
    }
    const it = byId.get(t.id);
    if (
      !it ||
      ((t.sortOrder ?? 0) === it.sortOrder &&
        (it.kanbanStatus === undefined || it.kanbanStatus === t.kanbanStatus) &&
        (it.isCompleted === undefined || it.isCompleted === t.isCompleted))
    ) {
      next.push(t);
      continue;
    }
    changed = true;
    next.push({
      ...t,
      sortOrder: it.sortOrder,
      ...(it.kanbanStatus !== undefined ? { kanbanStatus: it.kanbanStatus } : {}),
      ...(it.isCompleted !== undefined ? { isCompleted: it.isCompleted } : {}),
    });
  }
  return changed ? next : prev;
}

interface TaskRealtimeOptions {
  setTasks: React.Dispatch<React.SetStateAction<Thought[]>>;
  setTaskLists: React.Dispatch<React.SetStateAction<TaskList[]>>;
  // Refs, because the handler is registered once and must see the current list and callbacks
  listIdRef: React.RefObject<string>;
  loadDataRef: React.RefObject<() => Promise<void>>;
  // The board's moves on their way (taskMoves.ts): their echoes and events overtaken by them are not applied
  moveTracker: MoveTracker;
}

// Realtime updates of TasksView: created, changed, deleted and reordered tasks and changed task lists.
// What an event carries is applied; what it cannot carry is loaded once per burst (lib/realtimeReload.ts):
// the task lists after TASK_LIST_* (the payload is only the id, the permission is per person), everything
// after a move that made a new task and once after a reconnect (events of the gap are lost). A hidden tab
// loads when it is visible again.
export function useTaskRealtime({ setTasks, setTaskLists, listIdRef, loadDataRef, moveTracker }: TaskRealtimeOptions) {
  const tasksReloader = useRealtimeReload(() => void loadDataRef.current());
  // A reconnect reloads everything above, the lists included
  const listsReloader = useRealtimeReload(
    () => {
      api.getTaskLists().then((lists) => setTaskLists(Array.isArray(lists) ? lists : [])).catch(() => {});
    },
    { reconnect: false }
  );

  // Live-Sync WebSocket listener for tasks (registered once on mount; all dependencies are stable). The
  // counters in the navigation follow these events in app/useSessionBootstrap.ts already.
  useRealtimeEvents((msg) => {
    if (!msg.event) return;

    if (msg.event === 'TASK_CREATED') {
      const created = msg.payload as Thought;
      if (created && isTaskThought(created)) {
        setTasks((prev) => tasksAfterCreate(prev, created, listIdRef.current));
      }
    } else if (msg.event === 'TASK_UPDATED') {
      const updated = msg.payload as Thought;
      if (updated && updated.id) {
        setTasks((prev) => tasksAfterUpdate(prev, updated, listIdRef.current));
      }
    } else if (msg.event === 'TASK_DELETED') {
      const deletedId = typeof msg.payload === 'string' ? msg.payload : (msg.payload as { id?: string } | undefined)?.id;
      if (deletedId) {
        setTasks((prev) => tasksAfterDelete(prev, deletedId));
      }
    } else if (msg.event === 'TASK_REORDERED') {
      // The places come with the event; only a completed repeating task (its successor is new) or an
      // older server without them needs the tasks loaded again. The echo of this board's own move is
      // left to the move's answer, and while own moves are on their way an event waits for them.
      const moved = msg.payload as (TaskReorderResult & { userId?: string }) | undefined;
      if (moveTracker.classify(moved, getCurrentUserId()) !== 'apply') return;
      if (!moved || moved.reload || !Array.isArray(moved.items)) {
        tasksReloader.request();
      } else {
        const items = moved.items;
        setTasks((prev) => tasksAfterReorder(prev, items));
      }
    } else if (msg.event === 'TASK_LIST_CREATED' || msg.event === 'TASK_LIST_UPDATED' || msg.event === 'TASK_LIST_DELETED') {
      // Payload only carries the list ID; reload so permissions reflect this user's view
      listsReloader.request();
    }
  });
}
