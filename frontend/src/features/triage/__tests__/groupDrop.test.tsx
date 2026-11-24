import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act, renderHook } from '@testing-library/react';
import type { KanbanColumn, PriorityLevel, Thought } from '../../../lib/types';
import type { GroupBy } from '../taskViewTypes';

const reorderTasks = vi.hoisted(() => vi.fn());
const updateThought = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api', async () => (await import('../../../test/apiMock')).stubApi({ reorderTasks, updateThought }));

import { useTaskDrag } from '../useTaskDrag';
import { createMoveTracker } from '../taskMoves';
import { TaskListView } from '../TaskListView';
import type { TaskGroup } from '../taskListing';
import { boardIdOfColumn, ownColumnIn } from '../../../lib/kanbanColumns';

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

const statusGroup = (columnId: string, tasks: Thought[]): TaskGroup => ({
  key: `status:${columnId}`,
  title: columnId,
  count: tasks.length,
  tasks,
  drop: { kind: 'status', columnId },
});

const priorityGroup = (priority: PriorityLevel, tasks: Thought[]): TaskGroup => ({
  key: `p:${priority}`,
  title: priority,
  count: tasks.length,
  tasks,
  drop: { kind: 'priority', priority },
  hideWhenEmpty: true,
});

interface SetupOptions {
  columnsFor?: (t: Thought) => KanbanColumn[];
  boardColumnOf?: (t: Thought) => string | null;
  selectedListId?: string;
  groupBy?: GroupBy;
  viewMode?: string;
  isTaskReadOnly?: (t: Thought) => boolean;
}

function setup(
  initial: Thought[],
  ownColumn: (t: Thought | undefined, col: string) => string | null = (t, col) => (t ? col : null),
  {
    columnsFor = () => columns,
    boardColumnOf = (t) => t.kanbanStatus ?? null,
    selectedListId = 'l1',
    groupBy = 'status',
    viewMode = 'list',
    isTaskReadOnly = () => false,
  }: SetupOptions = {}
) {
  let tasks = initial;
  const setTasks = vi.fn((next: Thought[] | ((prev: Thought[]) => Thought[])) => {
    tasks = typeof next === 'function' ? next(tasks) : next;
  });
  const hook = renderHook(() =>
    useTaskDrag({
      tasks: initial,
      setTasks: setTasks as React.Dispatch<React.SetStateAction<Thought[]>>,
      columnsFor,
      ownColumnIdFor: ownColumn,
      boardColumnOf,
      isTaskReadOnly,
      pushUndo: vi.fn(),
      orderSnapshot: () => [],
      setSortBy: vi.fn(),
      selectedListId,
      loadData: vi.fn(async () => {}),
      globalColumns: columns,
      setTaskLists: vi.fn(),
      onRefreshStats: vi.fn(),
      viewMode,
      groupBy,
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
      await hook.result.current.handleDropOnGroup(dropEvent('a'), statusGroup('doing', []));
    });
    expect(current().find((t) => t.id === 'a')).toMatchObject({ kanbanStatus: 'doing', isCompleted: false });
    expect(reorderTasks).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'a', kanbanStatus: 'doing' })]), 'l1');
  });

  it('completes it when the empty group is the done column', async () => {
    const { hook, current } = setup([task('a', 'review', 0)]);
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), statusGroup('done', []));
    });
    expect(current()[0]).toMatchObject({ kanbanStatus: 'done', isCompleted: true });
  });

  it('puts it after the last task of a group that has some', async () => {
    const tasks = [task('a', 'review', 0), task('b', 'doing', 1), task('c', 'doing', 2), task('d', 'todo', 3)];
    const { hook, current } = setup(tasks);
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), statusGroup('doing', [tasks[1], tasks[2]]));
    });
    expect(current().map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(current().find((t) => t.id === 'a')!.kanbanStatus).toBe('doing');
  });

  it('takes the column of the task’s own list behind the group, and nothing its list lacks', async () => {
    const own = (t: Thought | undefined, col: string) => (t && col === 'doing' ? 'own-doing' : null);
    const { hook, current } = setup([task('a', 'review', 0)], own);
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), statusGroup('todo', []));
    });
    expect(reorderTasks).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), statusGroup('doing', []));
    });
    expect(current()[0].kanbanStatus).toBe('own-doing');
  });
});

describe('dropping a task on a row in "Alle Aufgaben" (lists with their own columns)', () => {
  // Two lists whose columns share names but not IDs; the second has no "In Bearbeitung" and the first no
  // "Zur Prüfung". The board joins them by name, as TasksView does.
  const listColumns: Record<string, KanbanColumn[]> = {
    l1: [
      { id: 'l1-todo', name: 'Zu erledigen' },
      { id: 'l1-doing', name: 'In Bearbeitung' },
      { id: 'l1-done', name: 'Erledigt', isDone: true },
    ],
    l2: [
      { id: 'l2-todo', name: 'Zu erledigen' },
      { id: 'l2-review', name: 'Zur Prüfung' },
      { id: 'l2-done', name: 'Erledigt', isDone: true },
    ],
  } as Record<string, KanbanColumn[]>;
  const columnsOf = (t: Thought) => listColumns[t.taskListId as string];
  const ownColumn = (t: Thought | undefined, boardCol: string) =>
    t ? (columnsOf(t).find((c) => boardIdOfColumn(c, true) === boardCol)?.id ?? null) : null;
  const boardColumnOf = (t: Thought) => {
    const own = ownColumnIn(t, columnsOf(t));
    return own ? boardIdOfColumn(own, true) : null;
  };
  const inList = (id: string, list: string, status: string, sortOrder: number, isCompleted = false): Thought =>
    ({ ...task(id, status, sortOrder), taskListId: list, isCompleted }) as Thought;
  const setupAll = (tasks: Thought[]) => setup(tasks, ownColumn, { columnsFor: columnsOf, boardColumnOf, selectedListId: 'all' });

  beforeEach(() => {
    reorderTasks.mockReset();
    reorderTasks.mockResolvedValue({ items: [] });
  });

  it('takes the column of its own list behind the target’s column, not the target’s column ID', async () => {
    const tasks = [inList('a', 'l1', 'l1-todo', 0), inList('b', 'l2', 'l2-done', 1, true)];
    const { hook, current } = setupAll(tasks);
    await act(async () => {
      await hook.result.current.handleDropOnTask(dropEvent('a'), tasks[1]);
    });
    expect(current().map((t) => t.id)).toEqual(['b', 'a']);
    expect(current().find((t) => t.id === 'a')).toMatchObject({ kanbanStatus: 'l1-done', isCompleted: true });
    expect(reorderTasks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'a', kanbanStatus: 'l1-done' })]),
      undefined
    );
  });

  it('keeps its status and only changes its place when its list has no such column', async () => {
    const tasks = [inList('a', 'l1', 'l1-doing', 0), inList('b', 'l2', 'l2-review', 1)];
    const { hook, current } = setupAll(tasks);
    await act(async () => {
      await hook.result.current.handleDropOnTask(dropEvent('a'), tasks[1]);
    });
    expect(current().map((t) => t.id)).toEqual(['b', 'a']);
    expect(current().find((t) => t.id === 'a')).toMatchObject({ kanbanStatus: 'l1-doing', isCompleted: false });
    expect(reorderTasks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'a', kanbanStatus: 'l1-doing' })]),
      undefined
    );
  });

  it('takes the target’s column within the same list', async () => {
    const tasks = [inList('a', 'l1', 'l1-todo', 0), inList('b', 'l1', 'l1-doing', 1)];
    const { hook, current } = setupAll(tasks);
    await act(async () => {
      await hook.result.current.handleDropOnTask(dropEvent('a'), tasks[1]);
    });
    expect(current().find((t) => t.id === 'a')).toMatchObject({ kanbanStatus: 'l1-doing', isCompleted: false });
  });
});

describe('dropping a task on a row without grouping by status', () => {
  beforeEach(() => {
    reorderTasks.mockReset();
    reorderTasks.mockResolvedValue({ items: [] });
    updateThought.mockReset();
  });

  it.each(['none', 'list', 'due', 'tag'] as GroupBy[])('only changes its place when grouped by "%s"', async (groupBy) => {
    const tasks = [task('a', 'todo', 0), { ...task('b', 'done', 1), isCompleted: true, priority: 'high' } as Thought];
    const { hook, current } = setup(tasks, undefined, { groupBy });
    await act(async () => {
      await hook.result.current.handleDropOnTask(dropEvent('a'), tasks[1]);
    });
    expect(current().map((t) => t.id)).toEqual(['b', 'a']);
    expect(current().find((t) => t.id === 'a')).toMatchObject({ kanbanStatus: 'todo', isCompleted: false, priority: 'normal' });
    expect(reorderTasks).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'a', kanbanStatus: 'todo' })]), 'l1');
    expect(updateThought).not.toHaveBeenCalled();
  });

  it('only changes its place in the calendar, whatever the list grouping', async () => {
    const tasks = [task('a', 'todo', 0), task('b', 'doing', 1)];
    const { hook, current } = setup(tasks, undefined, { groupBy: 'status', viewMode: 'calendar' });
    await act(async () => {
      await hook.result.current.handleDropOnTask(dropEvent('a'), tasks[1]);
    });
    expect(current().find((t) => t.id === 'a')!.kanbanStatus).toBe('todo');
  });
});

describe('dragging a task between priority groups', () => {
  const prio = (id: string, priority: PriorityLevel, sortOrder: number, taskListId = 'l1'): Thought =>
    ({ ...task(id, 'todo', sortOrder), priority, taskListId }) as Thought;

  beforeEach(() => {
    reorderTasks.mockReset();
    reorderTasks.mockResolvedValue({ items: [] });
    updateThought.mockReset();
    updateThought.mockResolvedValue({});
  });

  it('gives it the priority of an empty group it is dropped on', async () => {
    const tasks = [prio('a', 'normal', 0), prio('b', 'normal', 1)];
    const { hook, current } = setup(tasks, undefined, { groupBy: 'priority' });
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), priorityGroup('urgent', []));
    });
    expect(current().find((t) => t.id === 'a')).toMatchObject({ priority: 'urgent', kanbanStatus: 'todo' });
    expect(updateThought).toHaveBeenCalledWith('a', { priority: 'urgent' });
  });

  it('puts it after the group’s last task when dropped on the header', async () => {
    const tasks = [prio('a', 'normal', 0), prio('b', 'high', 1), prio('c', 'normal', 2)];
    const { hook, current } = setup(tasks, undefined, { groupBy: 'priority' });
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('a'), priorityGroup('high', [tasks[1]]));
    });
    expect(current().map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(current().find((t) => t.id === 'a')!.priority).toBe('high');
  });

  it('takes the priority of a row in another group and lands next to it', async () => {
    const tasks = [prio('a', 'normal', 0), prio('b', 'urgent', 1), prio('c', 'urgent', 2)];
    const { hook, current } = setup(tasks, undefined, { groupBy: 'priority' });
    await act(async () => {
      await hook.result.current.handleDropOnTask(dropEvent('a'), tasks[1]);
    });
    expect(current().map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(current().find((t) => t.id === 'a')).toMatchObject({ priority: 'urgent', kanbanStatus: 'todo', isCompleted: false });
    expect(updateThought).toHaveBeenCalledWith('a', { priority: 'urgent' });
  });

  it('keeps a low priority when moved within "Normal"', async () => {
    const tasks = [prio('a', 'low', 0), prio('b', 'normal', 1)];
    const { hook, current } = setup(tasks, undefined, { groupBy: 'priority' });
    await act(async () => {
      await hook.result.current.handleDropOnTask(dropEvent('a'), tasks[1]);
    });
    expect(current().map((t) => t.id)).toEqual(['b', 'a']);
    expect(current().find((t) => t.id === 'a')!.priority).toBe('low');
    expect(updateThought).not.toHaveBeenCalled();
  });

  it('takes the priority of a read-only task’s group, but gives none to a task the person may not change', async () => {
    const tasks = [prio('a', 'normal', 0), prio('b', 'urgent', 1, 'shared'), prio('c', 'high', 2, 'shared')];
    const { hook, current } = setup(tasks, undefined, { groupBy: 'priority', isTaskReadOnly: (t) => t.taskListId === 'shared' });
    // Dropped on a read-only row: its row stands for the group like the header
    await act(async () => {
      await hook.result.current.handleDropOnTask(dropEvent('a'), tasks[1]);
    });
    expect(current().find((t) => t.id === 'a')!.priority).toBe('urgent');
    updateThought.mockClear();
    // A read-only task has no priority group to go into
    await act(async () => {
      await hook.result.current.handleDropOnGroup(dropEvent('c'), priorityGroup('urgent', []));
    });
    expect(current().find((t) => t.id === 'c')!.priority).toBe('high');
    expect(updateThought).not.toHaveBeenCalled();
  });
});

describe('TaskListView groups as drop targets', () => {
  const statusGroups: TaskGroup[] = [
    { ...statusGroup('todo', [task('a', 'todo', 0)]), title: 'Zu erledigen' },
    { ...statusGroup('doing', []), title: 'In Bearbeitung' },
  ];
  const priorityGroups: TaskGroup[] = [
    { ...priorityGroup('urgent', []), title: 'Dringend' },
    { ...priorityGroup('high', []), title: 'Wichtig' },
    { ...priorityGroup('normal', [task('a', 'todo', 0)]), title: 'Normal' },
  ];

  const renderView = (
    drag: Partial<React.ComponentProps<typeof TaskListView>['drag']>,
    groups: TaskGroup[] = statusGroups,
    groupBy: GroupBy = 'status'
  ) => {
    const full = {
      draggingTaskId: null,
      dragOverGroup: null,
      canDropInGroup: () => false,
      handleGroupDragOver: vi.fn(),
      handleGroupDragLeave: vi.fn(),
      handleDropOnGroup: vi.fn(async () => {}),
      ...drag,
    };
    const shown = groups.flatMap((g) => g.tasks);
    const view = render(
      <TaskListView
        drag={full}
        doneTasks={[]}
        filter="open"
        filteredTasks={shown}
        groupBy={groupBy}
        groupOptions={[]}
        groupedTasks={groups}
        handleClearDone={vi.fn()}
        handleEmptyTaskTrash={vi.fn()}
        handlePurgeTrashed={vi.fn()}
        handleRestoreTrashed={vi.fn()}
        isSelectedListReadOnly={false}
        loading={false}
        openTasks={shown}
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
    const target = view.container.querySelector('[data-group-drop="status:doing"]')!;
    expect(target.children).toHaveLength(1);
  });

  it('lets a dragged task drop on the header and the strip of an empty group', () => {
    const { view, drag } = renderView({ draggingTaskId: 'a', canDropInGroup: () => true, dragOverGroup: 'status:doing' });
    const target = view.container.querySelector('[data-group-drop="status:doing"]')!;
    // Header plus the strip below it
    expect(target.children).toHaveLength(2);
    fireEvent.dragOver(target.children[1]);
    expect(drag.handleGroupDragOver).toHaveBeenCalledWith(expect.anything(), statusGroups[1]);
    fireEvent.drop(target.children[0]);
    expect(drag.handleDropOnGroup).toHaveBeenCalledWith(expect.anything(), statusGroups[1]);
    // The hovered group lights up like the other drop targets
    expect(target.parentElement!.className).toContain('ring-accent/60');
  });

  it('greys out a group the dragged task’s list has no column for', () => {
    const { view } = renderView({
      draggingTaskId: 'a',
      canDropInGroup: (d) => d.kind === 'status' && d.columnId === 'todo',
    });
    const target = view.container.querySelector('[data-group-drop="status:doing"]')!;
    expect(target.children).toHaveLength(1);
    expect(target.parentElement!.className).toContain('opacity-40');
    // Its rows take no drop either
    expect((target.nextElementSibling as HTMLElement).className).toContain('pointer-events-none');
  });

  it('hides empty priority groups until a task is dragged, then offers them with a strip', () => {
    const idle = renderView({}, priorityGroups, 'priority');
    expect(idle.view.queryByText('Dringend')).toBeNull();
    expect(idle.view.queryByText('Wichtig')).toBeNull();
    expect(idle.view.getByText('Normal')).toBeTruthy();
    idle.view.unmount();

    const { view, drag } = renderView(
      { draggingTaskId: 'a', canDropInGroup: () => true, dragOverGroup: 'p:urgent' },
      priorityGroups,
      'priority'
    );
    expect(view.getByText('Wichtig')).toBeTruthy();
    const target = view.container.querySelector('[data-group-drop="p:urgent"]')!;
    expect(target.textContent).toContain('Dringend');
    expect(target.children).toHaveLength(2);
    expect(target.parentElement!.className).toContain('ring-accent/60');
    fireEvent.drop(target.children[1]);
    expect(drag.handleDropOnGroup).toHaveBeenCalledWith(expect.anything(), priorityGroups[0]);
  });
});
