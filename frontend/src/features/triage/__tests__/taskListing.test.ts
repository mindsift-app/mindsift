import { describe, it, expect } from 'vitest';
import { KanbanColumn, TaskList, Thought } from '../../../lib/types';
import { filterAndSortTasks, followTaskUpdate, groupTasks, tagFilterLabel, tasksWithTag, toggleTag } from '../taskListing';
import { makeTask } from '../../../test/fixtures';

const ids = (list: Thought[]) => list.map((t) => t.id);
const COLS: KanbanColumn[] = [
  { id: 'todo', name: 'Zu erledigen' },
  { id: 'done', name: 'Erledigt', isDone: true },
];
const inCol = (t: Thought, c: KanbanColumn) => (t.isCompleted ? c.isDone === true : c.id === (t.kanbanStatus || 'todo'));
const ctx = (lists: TaskList[] = [], now = new Date(2026, 5, 15, 12, 0)) => ({ lists, boardColumns: COLS, inBoardColumn: inCol, now });

describe('task listing', () => {
  it('filters by state and hashtag', () => {
    const tasks = [makeTask('a', { tags: ['x'] }), makeTask('b', { isCompleted: true, tags: ['x'] }), makeTask('c')];
    expect(ids(filterAndSortTasks(tasks, 'open', [], 'custom'))).toEqual(['a', 'c']);
    expect(ids(filterAndSortTasks(tasks, 'done', [], 'custom'))).toEqual(['b']);
    expect(ids(filterAndSortTasks(tasks, 'discarded', ['x'], 'custom'))).toEqual(['a', 'b']);
    expect(ids(tasksWithTag(tasks, ['x']))).toEqual(['a', 'b']);
    expect(tasksWithTag(tasks, [])).toBe(tasks);
  });

  it('shows a task with at least one of several hashtags', () => {
    const tasks = [
      makeTask('a', { tags: ['garten'] }),
      makeTask('b', { tags: ['einkauf', 'garten'] }),
      makeTask('c', { tags: ['büro'] }),
      makeTask('d'),
      makeTask('e', { tags: ['einkauf'], isCompleted: true }),
    ];
    expect(ids(tasksWithTag(tasks, ['garten', 'einkauf']))).toEqual(['a', 'b', 'e']);
    expect(ids(filterAndSortTasks(tasks, 'open', ['einkauf', 'büro'], 'alpha'))).toEqual(['b', 'c']);
    expect(ids(tasksWithTag(tasks, ['urlaub']))).toEqual([]);
  });

  it('switches a hashtag of the filter on and off', () => {
    expect(toggleTag([], 'garten')).toEqual(['garten']);
    expect(toggleTag(['garten'], 'einkauf')).toEqual(['garten', 'einkauf']);
    expect(toggleTag(['garten', 'einkauf'], 'garten')).toEqual(['einkauf']);
    expect(toggleTag(['einkauf'], 'einkauf')).toEqual([]);
  });

  it('names the chosen hashtags compactly', () => {
    expect(tagFilterLabel(['garten'])).toBe('#garten');
    expect(tagFilterLabel(['garten', 'einkauf'])).toBe('#garten, #einkauf');
    expect(tagFilterLabel(['garten', 'einkauf', 'büro'])).toBe('#garten +2');
  });

  it('sorts manually, by due date, priority, title and age', () => {
    const tasks = [
      makeTask('b', { sortOrder: 2, dueDate: '2026-06-20', priority: 'low', createdAt: '2026-01-02T00:00:00Z' }),
      makeTask('a', { sortOrder: 1, priority: 'urgent', createdAt: '2026-01-01T00:00:00Z' }),
      makeTask('c', { sortOrder: 1, dueDate: '2026-06-10', priority: 'high', createdAt: '2026-01-03T00:00:00Z' }),
    ];
    expect(ids(filterAndSortTasks(tasks, 'open', [], 'custom'))).toEqual(['c', 'a', 'b']); // tie: newest first
    expect(ids(filterAndSortTasks(tasks, 'open', [], 'due'))).toEqual(['c', 'b', 'a']); // without date last
    expect(ids(filterAndSortTasks(tasks, 'open', [], 'priority'))).toEqual(['a', 'c', 'b']);
    expect(ids(filterAndSortTasks(tasks, 'open', [], 'alpha'))).toEqual(['a', 'b', 'c']);
    expect(ids(filterAndSortTasks(tasks, 'open', [], 'created'))).toEqual(['c', 'b', 'a']);
  });

  it('groups by list in tab order, tasks without a list first', () => {
    const lists = [{ id: 'l1', title: 'Haus', icon: '🏡' }, { id: 'l2', title: 'Arbeit' }] as TaskList[];
    const tasks = [makeTask('a', { taskListId: 'l2' }), makeTask('b'), makeTask('c', { taskListId: 'l1' }), makeTask('d', { taskListId: 'gone' })];
    const groups = groupTasks(tasks, 'list', ctx(lists))!;
    expect(groups.map((g) => [g.title, ids(g.tasks)])).toEqual([
      ['Ohne Liste', ['b']],
      ['🏡 Haus', ['c']],
      ['Arbeit', ['a']],
      ['Andere Liste', ['d']],
    ]);
  });

  it('groups by hashtag (sorted, a task under each of its tags), by status and priority', () => {
    const tasks = [makeTask('a', { tags: ['zz', 'aa'] }), makeTask('b'), makeTask('c', { isCompleted: true, priority: 'urgent' })];
    expect(groupTasks(tasks, 'tag', ctx())!.map((g) => [g.title, ids(g.tasks)])).toEqual([
      ['#aa', ['a']],
      ['#zz', ['a']],
      ['Ohne Hashtag', ['b', 'c']],
    ]);
    expect(groupTasks(tasks, 'status', ctx())!.map((g) => [g.title, ids(g.tasks)])).toEqual([
      ['Zu erledigen', ['a', 'b']],
      ['Erledigt', ['c']],
    ]);
    expect(groupTasks(tasks, 'priority', ctx())!.map((g) => g.key)).toEqual(['p:urgent', 'p:normal']);
    expect(groupTasks(tasks, 'none', ctx())).toBeNull();
  });

  it('groups by due date against the given time', () => {
    const tasks = [makeTask('over', { dueDate: '2026-06-10' }), makeTask('today', { dueDate: '2026-06-15' }), makeTask('soon', { dueDate: '2026-06-20' }), makeTask('none')];
    const groups = groupTasks(tasks, 'due', ctx([], new Date(2026, 5, 15, 12, 0)))!;
    expect(groups.map((g) => [g.key, ids(g.tasks)])).toEqual([
      ['due:overdue', ['over']],
      ['due:today', ['today']],
      ['due:upcoming', ['soon']],
      ['due:none', ['none']],
    ]);
  });
});

describe('task opened from outside the list', () => {
  // The update TasksView's onTaskChange makes (the detail dialog's own changes, e.g. watching)
  const change = (taskId: string, changes: Partial<Thought>) => (prev: Thought[]) =>
    prev.map((t) => (t.id === taskId ? { ...t, ...changes } : t));

  it('gets the changes the dialog makes to it', () => {
    const extra = makeTask('x', { isWatching: false });
    expect(followTaskUpdate(extra, change('x', { isWatching: true }))?.isWatching).toBe(true);
  });

  it('gets a new list that holds it, and stays as it is otherwise', () => {
    const extra = makeTask('x', { priority: 'normal' });
    expect(followTaskUpdate(extra, [makeTask('a'), makeTask('x', { priority: 'high' })])?.priority).toBe('high');
    expect(followTaskUpdate(extra, [makeTask('a')])).toBe(extra);
    expect(followTaskUpdate(extra, change('a', { priority: 'high' }))).toEqual(extra);
    expect(followTaskUpdate(null, change('x', { priority: 'high' }))).toBeNull();
  });
});
