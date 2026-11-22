import { describe, expect, it, vi } from 'vitest';
import { buildListsMenu } from '../listsMenu';
import { buildTasksMenu } from '../../triage/tasksMenu';
import { setCapabilities } from '../../../lib/capabilities';
import type { SharedList, TaskList } from '../../../lib/types';

// Sharing off (sharing mode private on a server, or the desktop app): the phone menus offer no "share"
const ids = (groups: { items: { id: string }[] }[]) => groups.flatMap((g) => g.items.map((i) => i.id));

const listsMenu = () =>
  ids(
    buildListsMenu({
      lists: [],
      activeList: { id: 'l1', title: 'Einkauf', items: [] } as unknown as SharedList,
      completedCount: 0,
      focusNewItemInput: vi.fn(),
      setShowNewListModal: vi.fn(),
      openShareModal: vi.fn(),
      handleClearCompleted: vi.fn(),
      handleDeleteList: vi.fn(),
      handleRenameList: vi.fn(),
      setActiveListId: vi.fn(),
    })
  );

const tasksMenu = () => {
  const list = { id: 't1', title: 'Haushalt', permission: 'owner' } as unknown as TaskList;
  return ids(
    buildTasksMenu({
      currentSelectedList: list,
      defaultGroupBy: 'none',
      groupBy: 'none',
      handleDeleteTaskList: vi.fn(),
      handleOpenShareModal: vi.fn(),
      handleRenameList: vi.fn(),
      handleToggleMute: vi.fn(),
      isSelectedListReadOnly: false,
      kanbanCount: 0,
      openCount: 0,
      openTasksCount: 0,
      selectedListId: 't1',
      selectedTags: [],
      setMobileCreateListId: vi.fn(),
      setSelectedListId: vi.fn(),
      setShowFilterModal: vi.fn(),
      setShowManageColumnsModal: vi.fn(),
      setShowMobileCreateModal: vi.fn(),
      setShowNewListModal: vi.fn(),
      setViewMode: vi.fn(),
      sortBy: 'manual',
      safeTaskLists: [list],
      viewMode: 'list',
    }).groups
  );
};

describe('share entries of the phone menus', () => {
  it('are there while sharing is on', () => {
    expect(listsMenu()).toContain('list-share');
    expect(tasksMenu()).toContain('share-task-list');
  });

  it('are gone while sharing is off', () => {
    setCapabilities({ sharing: false });
    expect(listsMenu()).not.toContain('list-share');
    expect(tasksMenu()).not.toContain('share-task-list');
  });
});
