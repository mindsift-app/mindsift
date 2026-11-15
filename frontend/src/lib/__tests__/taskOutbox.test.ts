import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { tasksApi } from '../api/tasks';
import { enqueue, getOutbox, pendingTaskChanges, withPendingTaskChanges } from '../offline';
import { useTaskActions } from '../../features/triage/useTaskActions';
import { KanbanColumn, Thought } from '../types';

// Tasks ticked offline: the outbox sends the wanted state with when it was changed, and a task ticked and
// un-ticked again before it was sent leaves nothing to send, also from a column like "In Arbeit".
const columns: KanbanColumn[] = [
  { id: 'todo', name: 'Zu erledigen' },
  { id: 'in_progress', name: 'In Arbeit' },
  { id: 'done', name: 'Erledigt', isDone: true },
];

describe('tasks changed offline', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('a tick goes out with the time of the tap', async () => {
    const before = Date.now();
    await tasksApi.updateThought('t1', { isCompleted: true, kanbanStatus: 'done' }, { isCompleted: false, kanbanStatus: 'in_progress' });
    const box = getOutbox();
    expect(box).toHaveLength(1);
    expect(box[0].body.isCompleted).toBe(true);
    expect(box[0].body.kanbanStatus).toBe('done');
    expect(box[0].body.changedAt).toBeGreaterThanOrEqual(before);
  });

  it('ticked and un-ticked from its column in the task view: back in the column, nothing to send', async () => {
    let tasks: Thought[] = [{ id: 't1', content: 'Fenster putzen', isCompleted: false, kanbanStatus: 'in_progress' } as Thought];
    const setTasks = vi.fn((next: Thought[] | ((prev: Thought[]) => Thought[])) => {
      tasks = typeof next === 'function' ? next(tasks) : next;
    });
    const { result } = renderHook(() =>
      useTaskActions({
        columnsFor: () => columns,
        currentSelectedList: undefined,
        doneTasks: [],
        isTaskReadOnly: () => false,
        loadData: async () => {},
        onOpenDocument: () => {},
        onRefreshStats: () => {},
        pushUndo: () => {},
        selectedListId: '',
        setTasks: setTasks as never,
        showToast: () => {},
      })
    );

    await act(() => result.current.handleToggleDone(tasks[0]));
    expect(tasks[0]).toMatchObject({ isCompleted: true, kanbanStatus: 'done' });
    expect(getOutbox()).toHaveLength(1);

    await act(() => result.current.handleToggleDone(tasks[0]));
    expect(tasks[0]).toMatchObject({ isCompleted: false, kanbanStatus: 'in_progress' });
    expect(getOutbox()).toHaveLength(0);

    // Without a tick waiting, un-ticking goes to the first open column as before
    tasks = [{ id: 't2', content: 'Müll', isCompleted: true, kanbanStatus: 'done' } as Thought];
    await act(() => result.current.handleToggleDone(tasks[0]));
    expect(tasks[0]).toMatchObject({ isCompleted: false, kanbanStatus: 'todo' });
    expect(getOutbox().map((e) => [e.body.isCompleted, e.body.kanbanStatus])).toEqual([[false, 'todo']]);
  });

  it('ticked in the task view, un-ticked in the command palette: nothing to send', async () => {
    await tasksApi.updateThought('t1', { isCompleted: true, kanbanStatus: 'done' }, { isCompleted: false, kanbanStatus: 'in_progress' });
    const back = await tasksApi.updateThought('t1', { isCompleted: false }, { isCompleted: true });
    expect(back.kanbanStatus).toBe('in_progress');
    expect(getOutbox()).toHaveLength(0);
  });

  it('moved to another column and back: nothing to send; moved and ticked: the final state goes out', async () => {
    await tasksApi.updateThought('t1', { kanbanStatus: 'in_progress', isCompleted: false }, { isCompleted: false, kanbanStatus: 'todo' });
    await tasksApi.updateThought('t1', { kanbanStatus: 'todo', isCompleted: false }, { isCompleted: false, kanbanStatus: 'in_progress' });
    expect(getOutbox()).toHaveLength(0);
    await tasksApi.updateThought('t1', { kanbanStatus: 'in_progress', isCompleted: false }, { isCompleted: false, kanbanStatus: 'todo' });
    await tasksApi.updateThought('t1', { kanbanStatus: 'done', isCompleted: true }, { isCompleted: false, kanbanStatus: 'in_progress' });
    const box = getOutbox();
    expect(box).toHaveLength(1);
    expect(box[0].body).toMatchObject({ kanbanStatus: 'done', isCompleted: true });
    expect(box[0].base).toEqual({ isCompleted: false, kanbanStatus: 'todo' });
  });
});

// After a reload without connection the tasks come from the cached answer, which is older than the ticks
// still waiting in the outbox: they are shown on top, so list, Kanban board and counts show the pending state.
describe('ticks waiting in the outbox', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  beforeEach(() => localStorage.clear());

  it('collects the latest tick and column per task, nothing else', () => {
    enqueue('PATCH', '/api/v1/thoughts/t1', { isCompleted: true, kanbanStatus: 'done' }, { isCompleted: false, kanbanStatus: 'todo' });
    enqueue('PATCH', '/api/v1/thoughts/t2', { isCompleted: false, kanbanStatus: 'in_progress' }, { isCompleted: true, kanbanStatus: 'done' });
    enqueue('PATCH', '/api/v1/thoughts/t3', { isCompleted: true });
    enqueue('PATCH', '/api/v1/lists/l1/items/t4', { isCompleted: true });
    enqueue('POST', '/api/v1/inbox', { content: 'Neu' });
    expect(Object.fromEntries(pendingTaskChanges())).toEqual({
      t1: { isCompleted: true, kanbanStatus: 'done' },
      t2: { isCompleted: false, kanbanStatus: 'in_progress' },
      t3: { isCompleted: true },
    });
    const shown = withPendingTaskChanges([
      { id: 't1', isCompleted: false, kanbanStatus: 'todo' },
      { id: 't3', isCompleted: false, kanbanStatus: 'waiting' },
      { id: 't9', isCompleted: true, kanbanStatus: 'done' },
    ] as Thought[]);
    expect(shown.map((t) => [t.id, t.isCompleted, t.kanbanStatus])).toEqual([
      ['t1', true, 'done'],
      ['t3', true, 'waiting'],
      ['t9', true, 'done'],
    ]);
  });

  it('getTasks shows a tick that waits on top of the answer', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ id: 't1', content: 'Abwasch', isCompleted: false, kanbanStatus: 'todo' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    expect((await tasksApi.getTasks())[0]).toMatchObject({ isCompleted: false, kanbanStatus: 'todo' });
    enqueue('PATCH', '/api/v1/thoughts/t1', { isCompleted: true, kanbanStatus: 'done' }, { isCompleted: false, kanbanStatus: 'todo' });
    expect((await tasksApi.getTasks())[0]).toMatchObject({ isCompleted: true, kanbanStatus: 'done' });
  });
});
