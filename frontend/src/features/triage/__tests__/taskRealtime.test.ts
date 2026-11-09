import { describe, it, expect } from 'vitest';
import { Thought } from '../../../lib/types';
import { isTaskThought, tasksAfterCreate, tasksAfterDelete, tasksAfterUpdate } from '../useTaskRealtime';

const task = (id: string, t: Partial<Thought> = {}) => ({ id, content: id, status: 'kept', taskListId: 'l1', ...t }) as Thought;
const ids = (list: Thought[]) => list.map((t) => t.id);

describe('task realtime updates', () => {
  it('counts kept and converted-to-task thoughts as tasks, not fresh Quick Dumps', () => {
    expect(isTaskThought(task('a'))).toBe(true);
    expect(isTaskThought(task('b', { status: 'converted', convertedType: 'task' }))).toBe(true);
    expect(isTaskThought(task('c', { status: 'inbox' }))).toBe(false);
  });

  it('adds a created task once, only to its own list or "all"', () => {
    const prev = [task('a')];
    expect(ids(tasksAfterCreate(prev, task('n'), 'l1'))).toEqual(['n', 'a']);
    expect(tasksAfterCreate(prev, task('a'), 'l1')).toBe(prev);
    expect(tasksAfterCreate(prev, task('n', { taskListId: 'l2' }), 'l1')).toBe(prev);
    expect(ids(tasksAfterCreate(prev, task('n', { taskListId: 'l2' }), 'all'))).toEqual(['n', 'a']);
  });

  it('updates, adds or removes a changed task depending on list and status', () => {
    const prev = [task('a'), task('b')];
    expect(tasksAfterUpdate(prev, task('a', { content: 'neu' }), 'l1')[0].content).toBe('neu');
    expect(ids(tasksAfterUpdate(prev, task('a', { taskListId: 'l2' }), 'l1'))).toEqual(['b']); // moved away
    expect(ids(tasksAfterUpdate(prev, task('a', { status: 'inbox' }), 'all'))).toEqual(['b']); // back to the Quick Dump
    expect(ids(tasksAfterUpdate(prev, task('c'), 'l1'))).toEqual(['c', 'a', 'b']); // moved in
    expect(tasksAfterUpdate(prev, task('c', { taskListId: 'l2' }), 'l1')).toBe(prev);
    // A change by anyone does not end watching (the broadcast carries no isWatching)
    const watched = [task('a', { isWatching: true })];
    expect(tasksAfterUpdate(watched, task('a', { priority: 'high' }), 'l1')[0].isWatching).toBe(true);
  });

  it('removes a deleted task', () => {
    expect(ids(tasksAfterDelete([task('a'), task('b')], 'a'))).toEqual(['b']);
  });
});
