import i18n from '../../i18n';
import { KanbanColumn, TaskList, Thought } from '../../lib/types';
import { isDueToday, isOverdue, localDay, splitDue } from '../../lib/due';
import { GroupBy, TaskFilter, TaskSort } from './taskViewTypes';

// Which tasks the list view of TasksView shows, in which order and in which groups. Pure functions.

export type TaskGroup = { key: string; title: string; count: number; tasks: Thought[] };

// A task opened from outside the shown list (a link, the search) is not in the list's tasks; every
// update of the list (a new array or a function of the old one) is applied to it as well, so its detail
// dialog shows the change. A task the update leaves out stays as it was.
export function followTaskUpdate(extra: Thought | null, update: Thought[] | ((prev: Thought[]) => Thought[])): Thought | null {
  if (!extra) return extra;
  const next = typeof update === 'function' ? update([extra]) : update;
  return next.find((t) => t.id === extra.id) ?? extra;
}

// Tasks with the hashtag (all with none); the Kanban board shows these
export function tasksWithTag(tasks: Thought[], selectedTag: string | null): Thought[] {
  let result = tasks;
  if (selectedTag) {
    result = result.filter((t) => Array.isArray(t.tags) && t.tags.includes(selectedTag));
  }
  return result;
}

// Open, done or all tasks with the hashtag, sorted as chosen ("custom": manual order, newest first on ties)
export function filterAndSortTasks(tasks: Thought[], filter: TaskFilter, selectedTag: string | null, sortBy: TaskSort): Thought[] {
  let result = tasks;
  if (filter === 'open') {
    result = result.filter((t) => !t.isCompleted);
  } else if (filter === 'done') {
    result = result.filter((t) => t.isCompleted);
  }
  if (selectedTag) {
    result = result.filter((t) => Array.isArray(t.tags) && t.tags.includes(selectedTag));
  }
  if (sortBy === 'custom') {
    return [...result].sort((a, b) => {
      const orderA = a.sortOrder ?? 0;
      const orderB = b.sortOrder ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
  return [...result].sort((a, b) => {
    if (sortBy === 'due') {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (sortBy === 'priority') {
      const pScore: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };
      const scoreA = pScore[a.priority] || 1;
      const scoreB = pScore[b.priority] || 1;
      return scoreB - scoreA;
    }
    if (sortBy === 'alpha') {
      return a.content.localeCompare(b.content);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

interface GroupContext {
  // Task lists in the order of the tabs
  lists: TaskList[];
  // Columns of the board and whether a task stands in one (grouping by status)
  boardColumns: KanbanColumn[];
  inBoardColumn: (task: Thought, col: KanbanColumn) => boolean;
  // Reference time for overdue / today / upcoming
  now: Date;
}

// Groups of the list view; null for "none"
export function groupTasks(tasks: Thought[], groupBy: GroupBy, { lists, boardColumns, inBoardColumn, now }: GroupContext): TaskGroup[] | null {
  if (groupBy === 'none') return null;
  const groups: { key: string; title: string; count: number; tasks: Thought[] }[] = [];

  if (groupBy === 'list') {
    // Tasks without a list first, then the lists in the order of the tabs
    const byList = new Map<string, Thought[]>();
    for (const t of tasks) {
      const key = t.taskListId || '';
      if (!byList.has(key)) byList.set(key, []);
      byList.get(key)!.push(t);
    }
    const without = byList.get('') || [];
    if (without.length > 0) groups.push({ key: 'list:none', title: i18n.t('tasks:listing.noList'), count: without.length, tasks: without });
    for (const tl of lists) {
      const list = byList.get(tl.id);
      if (!list || list.length === 0) continue;
      groups.push({ key: `list:${tl.id}`, title: [tl.icon, tl.title].filter(Boolean).join(' '), count: list.length, tasks: list });
      byList.delete(tl.id);
    }
    byList.delete('');
    byList.forEach((list, id) => groups.push({ key: `list:${id}`, title: i18n.t('tasks:listing.otherList'), count: list.length, tasks: list }));
  } else if (groupBy === 'tag') {
    const map = new Map<string, Thought[]>();
    const withoutTag: Thought[] = [];
    for (const t of tasks) {
      if (!t.tags || t.tags.length === 0) {
        withoutTag.push(t);
      } else {
        for (const tg of t.tags) {
          if (!map.has(tg)) map.set(tg, []);
          map.get(tg)!.push(t);
        }
      }
    }
    Array.from(map.keys()).sort().forEach((tg) => {
      const list = map.get(tg)!;
      groups.push({ key: `tag:${tg}`, title: `#${tg}`, count: list.length, tasks: list });
    });
    if (withoutTag.length > 0) {
      groups.push({ key: 'tag:none', title: i18n.t('tasks:listing.noTag'), count: withoutTag.length, tasks: withoutTag });
    }
  } else if (groupBy === 'status') {
    boardColumns.forEach((col) => {
      const list = tasks.filter((t) => inBoardColumn(t, col));
      groups.push({ key: `status:${col.id}`, title: col.name, count: list.length, tasks: list });
    });
  } else if (groupBy === 'priority') {
    const urgent = tasks.filter((t) => t.priority === 'urgent');
    const high = tasks.filter((t) => t.priority === 'high');
    const normal = tasks.filter((t) => t.priority !== 'urgent' && t.priority !== 'high');
    if (urgent.length > 0) groups.push({ key: 'p:urgent', title: i18n.t('tasks:listing.urgent'), count: urgent.length, tasks: urgent });
    if (high.length > 0) groups.push({ key: 'p:high', title: i18n.t('tasks:listing.high'), count: high.length, tasks: high });
    if (normal.length > 0) groups.push({ key: 'p:normal', title: i18n.t('common:priority.normal'), count: normal.length, tasks: normal });
  } else if (groupBy === 'due') {
      const today = localDay(now);
    const overdue = tasks.filter((t) => isOverdue(t.dueDate, now));
    const dueToday = tasks.filter((t) => isDueToday(t.dueDate, now) && !isOverdue(t.dueDate, now));
    const upcoming = tasks.filter((t) => t.dueDate && splitDue(t.dueDate).date > today);
    const noDue = tasks.filter((t) => !t.dueDate);
    if (overdue.length > 0) groups.push({ key: 'due:overdue', title: i18n.t('tasks:listing.overdue'), count: overdue.length, tasks: overdue });
    if (dueToday.length > 0) groups.push({ key: 'due:today', title: i18n.t('tasks:listing.today'), count: dueToday.length, tasks: dueToday });
    if (upcoming.length > 0) groups.push({ key: 'due:upcoming', title: i18n.t('tasks:listing.upcoming'), count: upcoming.length, tasks: upcoming });
    if (noDue.length > 0) groups.push({ key: 'due:none', title: i18n.t('tasks:listing.noDue'), count: noDue.length, tasks: noDue });
  }
  return groups;
}
