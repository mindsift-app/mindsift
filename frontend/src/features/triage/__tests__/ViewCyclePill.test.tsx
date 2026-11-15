import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewCyclePill, nextViewMode } from '../ViewCyclePill';
import { TaskListView } from '../TaskListView';
import { buildTasksMenu } from '../tasksMenu';
import { TaskFilter, ViewMode } from '../taskViewTypes';
import { TrashedTask } from '../../../lib/types';

function Cycling() {
  const [mode, setMode] = useState<ViewMode>('kanban');
  return <ViewCyclePill viewMode={mode} setViewMode={setMode} />;
}

describe('ViewCyclePill', () => {
  it('cycles Kanban → Kalender → Liste → Kanban', () => {
    expect(nextViewMode('kanban')).toBe('calendar');
    expect(nextViewMode('calendar')).toBe('list');
    expect(nextViewMode('list')).toBe('kanban');

    render(<Cycling />);
    const pill = () => screen.getByRole('button', { name: /^Ansicht:/ });
    expect(pill().getAttribute('aria-label')).toBe('Ansicht: Kanban. Tippen wechselt zu Kalender');
    expect(pill().textContent).toBe('Kanban');
    fireEvent.click(pill());
    expect(pill().textContent).toBe('Kalender');
    fireEvent.click(pill());
    expect(pill().textContent).toBe('Liste');
    expect(pill().getAttribute('aria-label')).toBe('Ansicht: Liste. Tippen wechselt zu Kanban');
    fireEvent.click(pill());
    expect(pill().textContent).toBe('Kanban');
  });

  it('keeps a 44 px tap area', () => {
    render(<ViewCyclePill viewMode="list" setViewMode={() => {}} />);
    expect(screen.getByRole('button').className).toContain('h-11');
  });
});

function ListWithSwitch({ trash }: { trash: TrashedTask[] | null }) {
  const [filter, setFilter] = useState<TaskFilter>('open');
  return (
    <TaskListView
      doneTasks={[]}
      filter={filter}
      filteredTasks={[]}
      groupBy="none"
      groupOptions={[]}
      groupedTasks={null}
      handleClearDone={() => {}}
      handleEmptyTaskTrash={() => {}}
      handlePurgeTrashed={() => {}}
      handleRestoreTrashed={() => {}}
      isSelectedListReadOnly={false}
      loading={false}
      openTasks={[]}
      renderTaskRow={() => null}
      safeTaskLists={[]}
      selectedListId="all"
      selectedTag={null}
      setFilter={setFilter}
      setGroupBy={() => {}}
      setSortBy={() => {}}
      sortBy="custom"
      taskTrash={trash}
    />
  );
}

describe('TaskListView switch open / done / trash', () => {
  it('is shown on phones too and switches the list', () => {
    render(<ListWithSwitch trash={null} />);
    const open = screen.getByRole('button', { name: 'Offen (0)' });
    // No longer hidden below sm: phones choose open / done / trash here instead of in the menu
    expect(open.parentElement!.className).not.toContain('hidden');
    expect(open.className).toContain('h-11');
    expect(open.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Erledigt (0)' }));
    expect(screen.getByRole('button', { name: 'Erledigt (0)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Noch keine Aufgaben erledigt.')).toBeTruthy();

    // The trash is not loaded yet: its button has no count, the list waits for it
    fireEvent.click(screen.getByRole('button', { name: 'Papierkorb' }));
    expect(screen.getByRole('button', { name: 'Papierkorb' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Lade Aufgaben…')).toBeTruthy();
  });
});

describe('buildTasksMenu', () => {
  it('offers the three views only, not open / done / trash', () => {
    const setViewMode = vi.fn();
    const noop = () => {};
    const { groups } = buildTasksMenu({
      currentSelectedList: undefined,
      defaultGroupBy: 'none',
      groupBy: 'none',
      handleDeleteTaskList: noop,
      handleOpenShareModal: noop,
      handleRenameList: noop,
      handleToggleMute: noop,
      isSelectedListReadOnly: false,
      kanbanCount: 2,
      openCount: 3,
      openTasksCount: 3,
      selectedListId: 'all',
      selectedTag: null,
      setMobileCreateListId: noop,
      setSelectedListId: noop,
      setShowFilterModal: noop,
      setShowManageColumnsModal: noop,
      setShowMobileCreateModal: noop,
      setShowNewListModal: noop,
      setViewMode,
      sortBy: 'custom',
      safeTaskLists: [],
      viewMode: 'kanban',
    });
    const views = groups.find((g) => g.id === 'tasks-views')!;
    expect(views.title).toBe('Ansicht');
    expect(views.items.map((i) => i.id)).toEqual(['view-list', 'view-kanban', 'view-calendar', 'manage-columns']);
    expect(views.items.find((i) => i.id === 'view-kanban')!.active).toBe(true);
    views.items[0].onClick();
    expect(setViewMode).toHaveBeenCalledWith('list');
  });
});
