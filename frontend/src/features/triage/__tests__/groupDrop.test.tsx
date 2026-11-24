import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act, renderHook } from '@testing-library/react';
import type { KanbanColumn, Thought } from '../../../lib/types';

const reorderTasks = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api', async () => (await import('../../../test/apiMock')).stubApi({ reorderTasks }));

import { useTaskDrag } from '../useTaskDrag';
import { createMoveTracker } from '../taskMoves';
import { TaskListView } from '../TaskListView';
import type { TaskGroup } from '../taskListing';

const columns: KanbanColumn[] = [
  { id: 'todo', name: 'Zu erledigen' },
  { id: 'doing', name: 'In Bearbeitung' },
  { id: 'review', name: 'Zur Prüfung' },
  { id: 'done', name: 'Erledigt', isDone: true },
] as KanbanColumn[];

const task = (id: string, kanbanStatus: string, sortOrder: number): Thought =>
  ({ id, content: id, kanbanStatus, sortOrder, isCompleted: false, createdAt: '2026-11-20T08:00:00Z', priority: 'normal' }) as Thought;

// A drop event as the browser hands it over: the dragged task's id in the data transfer
const dropEvent = (taskId: string) =>
  ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { getData: (k: string) => (k === 'application/mindsift-task-id' ? taskId : '') },
  }) as unknown as React.DragEvent;

function setup(initial: Thought[], ownColumn: (t: Thought | undefined, col: string) => string | null = (t, col) => (t ? col : null)) {
  let tasks = initial;
  const setTasks = vi.fn((next: Thought[] | ((prev: Thought[]) => Thought[])) => {
    tasks = typeof next === 'function' ? next(tasks) : next;
  });
  const hook = renderHook(() =>
    useTaskDrag({
      tasks: initial,
      setTasks: setTasks as React.Dispatch<React.SetStateAction<Thought[]>>,
      columnsFor: () => columns,
      ownColumnIdFor: ownColumn,
      isTaskReadOnly: () => false,
      pushUndo: vi.fn(),
      orderSnapshot: () => [],
      setSortBy: vi.fn(),
      selectedListId: 'l1',
      loadData: vi.fn(async () => {}),
      globalColumns: columns,
      setTaskLists: vi.fn(),
      onRefreshStats: vi.fn(),
      viewMode: 'list',
      kanbanBoardRef: { current: null },
      kanbanPhoneSnap: false,
      kanbanPhoneTop: 0,
      moveTracker: createMoveTracker(),
    })
  );
  return { hook, current: () => tasks };
}

describe('dropping a task on a status group of the list view', () => {
  beforeEach(() => {
    reorderTasks.mockReset();
    reorderTasks.mockResolvedValue({ items: [] });
  });

  it('moves it into an empty group (there was no drop target before)', async () => {
    const { hook, current } = setup([task('a', 'review', 0), task('b', 'todo', 1)]);
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), 'doing', []);
    });
    expect(current().find((t) => t.id === 'a')).toMatchObject({ kanbanStatus: 'doing', isCompleted: false });
    expect(reorderTasks).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'a', kanbanStatus: 'doing' })]), 'l1');
  });

  it('completes it when the empty group is the done column', async () => {
    const { hook, current } = setup([task('a', 'review', 0)]);
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), 'done', []);
    });
    expect(current()[0]).toMatchObject({ kanbanStatus: 'done', isCompleted: true });
  });

  it('puts it after the last task of a group that has some', async () => {
    const tasks = [task('a', 'review', 0), task('b', 'doing', 1), task('c', 'doing', 2), task('d', 'todo', 3)];
    const { hook, current } = setup(tasks);
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), 'doing', [tasks[1], tasks[2]]);
    });
    expect(current().map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(current().find((t) => t.id === 'a')!.kanbanStatus).toBe('doing');
  });

  it('takes the column of the task’s own list behind the group, and nothing its list lacks', async () => {
    const own = (t: Thought | undefined, col: string) => (t && col === 'doing' ? 'own-doing' : null);
    const { hook, current } = setup([task('a', 'review', 0)], own);
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), 'todo', []);
    });
    expect(reorderTasks).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), 'doing', []);
    });
    expect(current()[0].kanbanStatus).toBe('own-doing');
  });
});

describe('TaskListView status groups as drop targets', () => {
  const groups: TaskGroup[] = [
    { key: 'status:todo', title: 'Zu erledigen', count: 1, tasks: [task('a', 'todo', 0)], columnId: 'todo' },
    { key: 'status:doing', title: 'In Bearbeitung', count: 0, tasks: [], columnId: 'doing' },
  ];

  const renderView = (drag: Partial<React.ComponentProps<typeof TaskListView>['drag']>) => {
    const full = {
      draggingTaskId: null,
      dragOverGroup: null,
      canDropInGroup: () => false,
      handleGroupDragOver: vi.fn(),
      handleGroupDragLeave: vi.fn(),
      handleDropOnGroup: vi.fn(async () => {}),
      ...drag,
    };
    const view = render(
      <TaskListView
        drag={full}
        doneTasks={[]}
        filter="open"
        filteredTasks={groups[0].tasks}
        groupBy="status"
        groupOptions={[]}
        groupedTasks={groups}
        handleClearDone={vi.fn()}
        handleEmptyTaskTrash={vi.fn()}
        handlePurgeTrashed={vi.fn()}
        handleRestoreTrashed={vi.fn()}
        isSelectedListReadOnly={false}
        loading={false}
        openTasks={groups[0].tasks}
        renderTaskRow={(t) => <div key={t.id}>{t.content}</div>}
        safeTaskLists={[]}
        selectedListId="l1"
        selectedTags={[]}
        setFilter={vi.fn()}
        setGroupBy={vi.fn()}
        setSortBy={vi.fn()}
        sortBy="custom"
        taskTrash={null}
      />
    );
    return { view, drag: full };
  };

  it('shows no drop strip in an empty group while nothing is dragged', () => {
    const { view } = renderView({});
    const target = view.container.querySelector('[data-group-drop="doing"]')!;
    expect(target.children).toHaveLength(1);
  });

  it('lets a dragged task drop on the header and the strip of an empty group', () => {
    const { view, drag } = renderView({ draggingTaskId: 'a', canDropInGroup: () => true, dragOverGroup: 'doing' });
    const target = view.container.querySelector('[data-group-drop="doing"]')!;
    // Header plus the strip below it
    expect(target.children).toHaveLength(2);
    fireEvent.dragOver(target.children[1]);
    expect(drag.handleGroupDragOver).toHaveBeenCalledWith(expect.anything(), 'doing');
    fireEvent.drop(target.children[0]);
    expect(drag.handleDropOnGroup).toHaveBeenCalledWith(expect.anything(), 'doing', []);
    // The hovered group lights up like the other drop targets
    expect(target.parentElement!.className).toContain('ring-accent/60');
  });

  it('greys out a group the dragged task’s list has no column for', () => {
    const { view } = renderView({ draggingTaskId: 'a', canDropInGroup: (c) => c === 'todo' });
    const target = view.container.querySelector('[data-group-drop="doing"]')!;
    expect(target.children).toHaveLength(1);
    expect(target.parentElement!.className).toContain('opacity-40');
  });
});
