import i18n from '../../i18n';
import { KanbanColumn, TaskList, Thought } from '../../lib/types';
import { isDueToday, isOverdue, localDay, splitDue } from '../../lib/due';
import { GroupBy, TaskFilter, TaskSort } from './taskViewTypes';

// Which tasks the list view of TasksView shows, in which order and in which groups. Pure functions.

// columnId: the board column of a status group; a task dropped on such a group moves into that column
export type TaskGroup = { key: string; title: string; count: number; tasks: Thought[]; columnId?: string };

// A task opened from outside the shown list (a link, the search) is not in the list's tasks; every
// update of the list (a new array or a function of the old one) is applied to it as well, so its detail
// dialog shows the change. A task the update leaves out stays as it was.
export function followTaskUpdate(extra: Thought | null, update: Thought[] | ((prev: Thought[]) => Thought[])): Thought | null {
  if (!extra) return extra;
  const next = typeof update === 'function' ? update([extra]) : update;
  return next.find((t) => t.id === extra.id) ?? extra;
}

// Whether a task has at least one of the chosen hashtags (any task while none is chosen)
function hasAnyTag(task: Thought, selectedTags: readonly string[]): boolean {
  if (selectedTags.length === 0) return true;
  return Array.isArray(task.tags) && task.tags.some((tag) => selectedTags.includes(tag));
}

// The hashtag filter after a click on a hashtag: on if it was off, off if it was on
export function toggleTag(selectedTags: readonly string[], tag: string): string[] {
  return selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag];
}

// The chosen hashtags in a few characters: "#a", "#a, #b", "#a +2"
export function tagFilterLabel(selectedTags: readonly string[]): string {
  if (selectedTags.length <= 2) return selectedTags.map((tag) => `#${tag}`).join(', ');
  return i18n.t('tasks:tags.selectedMore', { tag: selectedTags[0], count: selectedTags.length - 1 });
}

// Tasks with at least one of the hashtags (all with none); the Kanban board and the calendar show these
export function tasksWithTag(tasks: Thought[], selectedTags: readonly string[]): Thought[] {
  if (selectedTags.length === 0) return tasks;
  return tasks.filter((t) => hasAnyTag(t, selectedTags));
}

// Open, done or all tasks with one of the hashtags, sorted as chosen ("custom": manual order, newest first
// on ties)
export function filterAndSortTasks(tasks: Thought[], filter: TaskFilter, selectedTags: readonly string[], sortBy: TaskSort): Thought[] {
  let result = tasks;
  if (filter === 'open') {
    result = result.filter((t) => !t.isCompleted);
  } else if (filter === 'done') {
    result = result.filter((t) => t.isCompleted);
  }
  if (selectedTags.length > 0) {
    result = result.filter((t) => hasAnyTag(t, selectedTags));
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
  const groups: TaskGroup[] = [];

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
      groups.push({ key: `status:${col.id}`, title: col.name, count: list.length, tasks: list, columnId: col.id });
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
