import { describe, expect, it } from 'vitest';
import { entriesByDay, firstWeekday, isoWeek, monthGrid, moveDue, nextRepeat, weekOf } from '../calendar';
import { Thought } from '../types';

const task = (over: Partial<Thought>): Thought =>
  ({ id: 't', content: 'Aufgabe', priority: 'normal', isCompleted: false, tags: [], ...over }) as Thought;

describe('calendar', () => {
  it('starts the week on Monday in German, on Sunday in the US', () => {
    expect(firstWeekday('de-DE')).toBe(1);
    expect(firstWeekday('en-US')).toBe(7);
    expect(weekOf('2026-11-12', 1)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(weekOf('2026-11-12', 7)[0]).toBe('2026-11-08');
  });

  it('lays out the month in whole weeks', () => {
    const grid = monthGrid('2026-11-20', 1);
    expect(grid[0][0]).toBe('2026-10-26');
    expect(grid[grid.length - 1][6]).toBe('2026-12-06');
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(isoWeek('2026-11-09')).toBe(46);
  });

  it('repeats like the server: months fall back to their last day', () => {
    expect(nextRepeat('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextRepeat('2026-02-28', 'monthly')).toBe('2026-03-28');
    expect(nextRepeat('2026-11-09', 'weekly')).toBe('2026-11-16');
    expect(nextRepeat('2024-02-29', 'yearly')).toBe('2025-02-28');
  });

  it('keeps the time when a task moves to another day', () => {
    expect(moveDue('2026-11-09T14:30', '2026-11-12')).toBe('2026-11-12T14:30');
    expect(moveDue('2026-11-09', '2026-11-12')).toBe('2026-11-12');
    expect(moveDue(undefined, '2026-11-12')).toBe('2026-11-12');
  });

  it('shows coming dates of repeating tasks, all-day entries first', () => {
    const days = entriesByDay(
      [
        task({ id: 'a', dueDate: '2026-11-09T09:00', recurrence: 'weekly' }),
        task({ id: 'b', dueDate: '2026-11-16' }),
        task({ id: 'c', dueDate: '2026-11-10', recurrence: 'daily', isCompleted: true }),
      ],
      '2026-11-09',
      '2026-11-22'
    );
    expect(days.get('2026-11-09')?.map((e) => [e.task.id, e.upcoming])).toEqual([['a', false]]);
    expect(days.get('2026-11-16')?.map((e) => [e.task.id, e.upcoming, e.time])).toEqual([
      ['b', false, ''],
      ['a', true, '09:00'],
    ]);
    // A done task does not repeat any more
    expect(days.get('2026-11-11')).toBeUndefined();
  });
});
