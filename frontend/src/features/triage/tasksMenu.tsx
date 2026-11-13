import { Bell, BellOff, CalendarDays, Check, Columns2, Funnel, Folder, Layers, LayoutList, Pencil, Plus, Settings, Trash, Users } from 'lucide-react';
import { isTaskListShared } from './TaskListTabs';
import i18n from '../../i18n';
import { TaskList } from '../../lib/types';
import { MobileMenuGroup } from '../../context/MobileActionContext';
import { ViewMode } from './taskViewTypes';

type TaskFilter = 'open' | 'done' | 'discarded';

interface TasksMenuInput {
  currentSelectedList: TaskList | undefined;
  defaultGroupBy: string;
  doneCount: number;
  filter: TaskFilter;
  groupBy: string;
  handleDeleteTaskList: (listId: string) => void;
  handleOpenShareModal: (tl: TaskList) => void;
  handleRenameList: (tl: TaskList) => void;
  handleToggleMute: (tl: TaskList) => void;
  isSelectedListReadOnly: boolean;
  kanbanCount: number;
  openCount: number;
  openTasksCount: number | undefined;
  selectedListId: string;
  selectedTag: string | null;
  setFilter: (filter: TaskFilter) => void;
  setMobileCreateListId: (id: string) => void;
  setSelectedListId: (id: string) => void;
  setShowFilterModal: (show: boolean) => void;
  setShowManageColumnsModal: (show: boolean) => void;
  setShowMobileCreateModal: (show: boolean) => void;
  setShowNewListModal: (show: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  sortBy: string;
  trashCount: number;
  safeTaskLists: TaskList[];
  viewMode: ViewMode;
}

// The phone menu of TasksView (header menu): new task, filter and sorting, list management, views and the
// switch between task lists. TasksView puts it into the menu context whenever one of the values changes.
export function buildTasksMenu({
  currentSelectedList,
  defaultGroupBy,
  doneCount,
  filter,
  groupBy,
  handleDeleteTaskList,
  handleOpenShareModal,
  handleRenameList,
  handleToggleMute,
  isSelectedListReadOnly,
  kanbanCount,
  openCount,
  openTasksCount,
  selectedListId,
  selectedTag,
  setFilter,
  setMobileCreateListId,
  setSelectedListId,
  setShowFilterModal,
  setShowManageColumnsModal,
  setShowMobileCreateModal,
  setShowNewListModal,
  setViewMode,
  sortBy,
  trashCount,
  safeTaskLists,
  viewMode,
}: TasksMenuInput): { primaryAction: () => void; groups: MobileMenuGroup[] } {
  const primaryAction = () => {
    setMobileCreateListId(selectedListId === 'all' || isSelectedListReadOnly ? '' : selectedListId);
    setShowMobileCreateModal(true);
  };

  const primaryItems: any[] = [
    {
      id: 'new-task',
      label: i18n.t('tasks:menu.newTask'),
      icon: <Plus className="w-4 h-4" />,
      variant: 'accent',
      onClick: () => {
        setMobileCreateListId(selectedListId === 'all' || isSelectedListReadOnly ? '' : selectedListId);
        setShowMobileCreateModal(true);
      },
    },
  ];

  const filterSortActiveCount =
    (selectedTag ? 1 : 0) + (groupBy !== defaultGroupBy ? 1 : 0) + (sortBy !== 'custom' ? 1 : 0);

  const filterItems: any[] = [
    {
      id: 'tasks-filter-modal',
      label: i18n.t('tasks:menu.filter'),
      icon: <Funnel className="w-4 h-4 text-accent" />,
      badge: filterSortActiveCount > 0 ? `${filterSortActiveCount} aktiv` : undefined,
      active: filterSortActiveCount > 0,
      onClick: () => setShowFilterModal(true),
    },
  ];

  const listManagementItems: any[] = [
    {
      id: 'new-task-list',
      label: i18n.t('tasks:tabs.newListTitle'),
      icon: <Folder className="w-4 h-4" />,
      onClick: () => setShowNewListModal(true),
    },
  ];

  if (currentSelectedList) {
    listManagementItems.push({
      id: 'share-task-list',
      label: i18n.t('tasks:menu.shareList', { title: currentSelectedList.title }),
      icon: <Users className="w-4 h-4" />,
      onClick: () => handleOpenShareModal(currentSelectedList),
    });
    if (currentSelectedList.permission !== 'viewer') {
      listManagementItems.push({
        id: 'rename-task-list',
        label: i18n.t('common:listMenu.rename'),
        icon: <Pencil className="w-4 h-4" />,
        onClick: () => handleRenameList(currentSelectedList),
      });
    }
    if (isTaskListShared(currentSelectedList)) {
      listManagementItems.push({
        id: 'mute-task-list',
        label: currentSelectedList.isMuted ? i18n.t('common:listMenu.unmute') : i18n.t('common:listMenu.mute'),
        icon: currentSelectedList.isMuted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />,
        onClick: () => handleToggleMute(currentSelectedList),
      });
    }
    listManagementItems.push({
      id: 'delete-task-list',
      label: i18n.t('tasks:menu.deleteList', { title: currentSelectedList.title }),
      icon: <Trash className="w-4 h-4" />,
      variant: 'danger',
      onClick: () => handleDeleteTaskList(currentSelectedList.id),
    });
  }

  const viewItems: any[] = [
    {
      id: 'filter-open',
      label: i18n.t('tasks:menu.openList'),
      icon: <LayoutList className="w-4 h-4" />,
      badge: openCount,
      active: viewMode === 'list' && filter === 'open',
      onClick: () => {
        setViewMode('list');
        setFilter('open');
      },
    },
    {
      id: 'filter-done',
      label: i18n.t('tasks:menu.done'),
      icon: <Check className="w-4 h-4" />,
      badge: doneCount,
      active: viewMode === 'list' && filter === 'done',
      onClick: () => {
        setViewMode('list');
        setFilter('done');
      },
    },
    {
      id: 'filter-discarded',
      label: i18n.t('common:trash'),
      icon: <Trash className="w-4 h-4" />,
      badge: trashCount,
      active: viewMode === 'list' && filter === 'discarded',
      onClick: () => {
        setViewMode('list');
        setFilter('discarded');
      },
    },
    {
      id: 'view-kanban',
      label: i18n.t('tasks:menu.kanban'),
      icon: <Columns2 className="w-4 h-4" />,
      badge: kanbanCount,
      active: viewMode === 'kanban',
      onClick: () => setViewMode('kanban'),
    },
    {
      id: 'view-calendar',
      label: i18n.t('tasks:menu.calendar'),
      icon: <CalendarDays className="w-4 h-4" />,
      active: viewMode === 'calendar',
      onClick: () => setViewMode('calendar'),
    },
  ];

  if (viewMode === 'kanban' && !isSelectedListReadOnly) {
    viewItems.push({
      id: 'manage-columns',
      label: i18n.t('tasks:menu.columns'),
      icon: <Settings className="w-4 h-4" />,
      onClick: () => setShowManageColumnsModal(true),
    });
  }

  const listItems: any[] = [
    {
      id: 'list-all',
      label: i18n.t('tasks:allTasks'),
      icon: <Layers className="w-4 h-4" />,
      badge: openTasksCount || undefined,
      active: selectedListId === 'all',
      onClick: () => setSelectedListId('all'),
    },
    ...safeTaskLists.map((tl) => ({
      id: `list-${tl.id}`,
      label: tl.icon ? `${tl.icon} ${tl.title}` : tl.title,
      badge: tl.tasksCount || undefined,
      active: selectedListId === tl.id,
      onClick: () => setSelectedListId(tl.id),
    })),
  ];

  const groups: MobileMenuGroup[] = [
    {
      id: 'tasks-primary',
      items: primaryItems,
    },
    {
      id: 'tasks-filters',
      title: i18n.t('tasks:filter.title'),
      items: filterItems,
    },
    {
      id: 'tasks-list-management',
      title: i18n.t('tasks:menu.listManagement'),
      items: listManagementItems,
    },
    {
      id: 'tasks-views',
      title: i18n.t('tasks:menu.viewStatus'),
      items: viewItems,
    },
    {
      id: 'tasks-lists',
      title: i18n.t('tasks:menu.switchList'),
      items: listItems,
    },
  ];
  return { primaryAction, groups };
}
