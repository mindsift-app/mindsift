import { describe, it, expect } from 'vitest';
import { KanbanColumn, TaskList, Thought } from '../../../lib/types';
import { filterAndSortTasks, groupTasks, tasksWithTag } from '../taskListing';

const task = (id: string, t: Partial<Thought> = {}) =>
  ({ id, content: id, isCompleted: false, priority: 'normal', createdAt: '2026-01-01T00:00:00Z', ...t }) as Thought;
const ids = (list: Thought[]) => list.map((t) => t.id);
const COLS: KanbanColumn[] = [
  { id: 'todo', name: 'Zu erledigen' },
  { id: 'done', name: 'Erledigt', isDone: true },
];
const inCol = (t: Thought, c: KanbanColumn) => (t.isCompleted ? c.isDone === true : c.id === (t.kanbanStatus || 'todo'));
const ctx = (lists: TaskList[] = [], now = new Date(2026, 5, 15, 12, 0)) => ({ lists, boardColumns: COLS, inBoardColumn: inCol, now });

describe('task listing', () => {
  it('filters by state and hashtag', () => {
    const tasks = [task('a', { tags: ['x'] }), task('b', { isCompleted: true, tags: ['x'] }), task('c')];
    expect(ids(filterAndSortTasks(tasks, 'open', null, 'custom'))).toEqual(['a', 'c']);
    expect(ids(filterAndSortTasks(tasks, 'done', null, 'custom'))).toEqual(['b']);
    expect(ids(filterAndSortTasks(tasks, 'discarded', 'x', 'custom'))).toEqual(['a', 'b']);
    expect(ids(tasksWithTag(tasks, 'x'))).toEqual(['a', 'b']);
    expect(tasksWithTag(tasks, null)).toBe(tasks);
  });

  it('sorts manually, by due date, priority, title and age', () => {
    const tasks = [
      task('b', { sortOrder: 2, dueDate: '2026-06-20', priority: 'low', createdAt: '2026-01-02T00:00:00Z' }),
      task('a', { sortOrder: 1, priority: 'urgent', createdAt: '2026-01-01T00:00:00Z' }),
      task('c', { sortOrder: 1, dueDate: '2026-06-10', priority: 'high', createdAt: '2026-01-03T00:00:00Z' }),
    ];
    expect(ids(filterAndSortTasks(tasks, 'open', null, 'custom'))).toEqual(['c', 'a', 'b']); // tie: newest first
    expect(ids(filterAndSortTasks(tasks, 'open', null, 'due'))).toEqual(['c', 'b', 'a']); // without date last
    expect(ids(filterAndSortTasks(tasks, 'open', null, 'priority'))).toEqual(['a', 'c', 'b']);
    expect(ids(filterAndSortTasks(tasks, 'open', null, 'alpha'))).toEqual(['a', 'b', 'c']);
    expect(ids(filterAndSortTasks(tasks, 'open', null, 'created'))).toEqual(['c', 'b', 'a']);
  });

  it('groups by list in tab order, tasks without a list first', () => {
    const lists = [{ id: 'l1', title: 'Haus', icon: '🏡' }, { id: 'l2', title: 'Arbeit' }] as TaskList[];
    const tasks = [task('a', { taskListId: 'l2' }), task('b'), task('c', { taskListId: 'l1' }), task('d', { taskListId: 'gone' })];
    const groups = groupTasks(tasks, 'list', ctx(lists))!;
    expect(groups.map((g) => [g.title, ids(g.tasks)])).toEqual([
      ['Ohne Liste', ['b']],
      ['🏡 Haus', ['c']],
      ['Arbeit', ['a']],
      ['Andere Liste', ['d']],
    ]);
  });

  it('groups by hashtag (sorted, a task under each of its tags), by status and priority', () => {
    const tasks = [task('a', { tags: ['zz', 'aa'] }), task('b'), task('c', { isCompleted: true, priority: 'urgent' })];
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
    const tasks = [task('over', { dueDate: '2026-06-10' }), task('today', { dueDate: '2026-06-15' }), task('soon', { dueDate: '2026-06-20' }), task('none')];
    const groups = groupTasks(tasks, 'due', ctx([], new Date(2026, 5, 15, 12, 0)))!;
    expect(groups.map((g) => [g.key, ids(g.tasks)])).toEqual([
      ['due:overdue', ['over']],
      ['due:today', ['today']],
      ['due:upcoming', ['soon']],
      ['due:none', ['none']],
    ]);
  });
});
