import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Bell, BellOff, CalendarDays, Columns, LayoutList, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { CountBadge } from '../../components/CountBadge';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SharedPill } from '../../components/SharedPill';
import { ConfirmPopover } from '../../components/ConfirmPopover';
import { LivePill } from '../../components/LivePill';
import { TaskList, TaskListMember, Thought, User } from '../../lib/types';
import { ViewMode } from './taskViewTypes';
import { useTaskDrag } from './useTaskDrag';
import { useTabReorder } from '../../lib/useTabReorder';
import { TabDropMarker } from '../../components/TabDropMarker';
import { AvatarPerson } from '../../components/AvatarStack';
import { ActionMenu } from '../../components/ActionMenu';
import { MoreTabsButton } from '../../components/MoreTabsButton';
import { OVERFLOW_HIDDEN_TAB, useOverflowTabs } from '../../lib/useOverflowTabs';

interface TaskListTabsProps {
  // Result of useTaskDrag in TasksView (tasks can be dropped onto a list tab)
  drag: ReturnType<typeof useTaskDrag>;
  currentSelectedList: TaskList | undefined;
  currentUser: User | null | undefined;
  // Deletes without asking; the menu asks first, in a small popover at the mouse
  deleteTaskList: (listId: string) => void;
  handleOpenShareModal: (tl: TaskList) => void;
  onRenameList: (tl: TaskList) => void;
  onToggleMute: (tl: TaskList) => void;
  memberToPerson: (m: TaskListMember) => AvatarPerson;
  openTasksCount: number | undefined;
  safeTaskLists: TaskList[];
  selectedListId: string;
  setSelectedListId: (id: string) => void;
  setShowNewListModal: (show: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  viewMode: ViewMode;
  tasks: Thought[];
  // New order of the task list tabs (drag and drop)
  onReorderLists: (ids: string[]) => void;
}

// A list someone besides the owner sees (only those send list-wide notifications, so only those can be muted)
export const isTaskListShared = (tl: TaskList) => (tl.shares?.length || 0) > 0 || (tl.members?.length || 0) > 1;

// Desktop header of TasksView: "Alle Aufgaben" and one tab per task list (members; a task dragged onto a
// tab moves into that list) in one row, the lists that do not fit behind "⋯ n", "Neue Liste"; on the right
// the status, the menu of the open list (mute, share, rename, delete) and the switch between list and Kanban
// A view in the switch: its icon and name; a flex block, so the icon does not sit on the text's baseline
// and the switch keeps the height of the text-only ones (month/week, hashtag sorting)
const viewLabel = (icon: React.ReactNode, name: string) => (
  <span className="flex items-center gap-1.5">
    {icon}
    {name}
  </span>
);

export function TaskListTabs({
  drag,
  currentSelectedList,
  currentUser,
  deleteTaskList,
  handleOpenShareModal,
  onRenameList,
  onToggleMute,
  memberToPerson,
  openTasksCount,
  safeTaskLists,
  selectedListId,
  setSelectedListId,
  setShowNewListModal,
  setViewMode,
  viewMode,
  tasks,
  onReorderLists,
}: TaskListTabsProps) {
  const { t } = useTranslation('tasks');
  const { dragOverListTab, draggingTaskId, handleDropOnListTab, setDragOverListTab } = drag;
  const [pendingDelete, setPendingDelete] = useState<{ list: TaskList; x: number; y: number } | null>(null);
  const reorder = useTabReorder(safeTaskLists.map((tl) => tl.id), onReorderLists);
  const overflow = useOverflowTabs(
    safeTaskLists.map((tl) => tl.id),
    selectedListId === 'all' ? null : selectedListId
  );
  const draggedTask = draggingTaskId ? tasks.find((t) => t.id === draggingTaskId) : null;
  // A dragged task may drop on this list (its tab or its row in the "more" list)
  const tabDropProps = (tl: TaskList) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!draggedTask || draggedTask.taskListId === tl.id || tl.permission === 'viewer') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverListTab !== tl.id) setDragOverListTab(tl.id);
    },
    onDragLeave: () => {
      if (dragOverListTab === tl.id) setDragOverListTab(null);
    },
    onDrop: (e: React.DragEvent) => handleDropOnListTab(e, tl),
  });

  return (
    <div className="hidden sm:flex items-center gap-2 border-b border-border pb-2 !mt-0">
      {/* Task Lists selector tabs: one row, what does not fit goes behind "⋯ n" */}
      <div ref={overflow.rowRef} className="relative flex-1 min-w-0 flex items-center gap-1">
        <button
          data-tab-fixed
          onClick={() => setSelectedListId('all')}
          className={`shrink-0 whitespace-nowrap h-8 pl-3 pr-2 text-xs font-medium border rounded-btn transition-colors ${
            selectedListId === 'all'
              ? 'bg-panel border-accent text-main'
              : 'bg-canvas border-border text-muted hover:text-main'
          }`}
        >
          {/* Counter on the label, like in the nav bar */}
          <span className="inline-flex items-center">
            {t('allTasks')}
            <CountBadge count={openTasksCount} position="text" />
          </span>
        </button>

        {safeTaskLists.map((tl) => {
          const drop = tabDropProps(tl);
          const hidden = overflow.isHidden(tl.id);
          return (
          <div
            key={tl.id}
            ref={overflow.tabRef(tl.id)}
            aria-hidden={hidden || undefined}
            {...reorder.dragProps(tl.id)}
            onDragOver={(e) => {
              if (reorder.handleDragOver(e, tl.id)) return;
              drop.onDragOver(e);
            }}
            onDragLeave={drop.onDragLeave}
            onDrop={(e) => {
              if (!reorder.handleDrop(e, tl.id)) drop.onDrop(e);
            }}
            className={`group shrink-0 whitespace-nowrap h-8 flex items-center border rounded-btn transition-colors ${
              selectedListId === tl.id ? 'bg-panel border-accent text-main' : 'bg-canvas border-border text-muted hover:text-main'
            } ${dragOverListTab === tl.id ? 'ring-2 ring-accent/60 bg-accent/10 text-main' : ''} ${
              reorder.draggingId === tl.id ? 'opacity-50' : ''
            } ${hidden ? OVERFLOW_HIDDEN_TAB : 'relative'}`}
          >
            <TabDropMarker side={reorder.dropSide(tl.id)} />
            <button
              onClick={() => setSelectedListId(tl.id)}
              tabIndex={hidden ? -1 : undefined}
              className="h-full pl-3 pr-2 text-xs font-medium flex items-center gap-1.5 rounded-btn"
            >
              <span>{tl.icon}</span>
              <span className="inline-flex items-center">
                {tl.title}
                <CountBadge count={tl.tasksCount} position="text" />
              </span>
              {tl.isMuted && (
                <span title={t('common:listMenu.muted')}>
                  <BellOff className="w-3 h-3 text-faint" aria-label={t('common:listMenu.muted')} />
                </span>
              )}

              {/* Shared: the same sign as a shared note in the sidebar; who with is in the tooltip */}
              {isTaskListShared(tl) && (
                <span
                  title={[t('tabs.shared'), ...(tl.members || []).filter((m) => m.userId !== currentUser?.id).map((m) => memberToPerson(m).name)]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <Users className="w-3 h-3 text-status-ok shrink-0" aria-label={t('tabs.shared')} />
                </span>
              )}
            </button>
          </div>
          );
        })}

        <MoreTabsButton
          ref={overflow.moreRef}
          items={safeTaskLists
            .filter((tl) => overflow.isHidden(tl.id))
            .map((tl) => ({ id: tl.id, icon: tl.icon, title: tl.title, count: tl.tasksCount, muted: tl.isMuted }))}
          activeId={selectedListId}
          onSelect={setSelectedListId}
          dragActive={!!draggedTask}
          rowDropProps={(id) => {
            const tl = safeTaskLists.find((l) => l.id === id);
            return tl ? tabDropProps(tl) : {};
          }}
          highlightId={dragOverListTab}
        />

        <button
          data-tab-fixed
          onClick={() => setShowNewListModal(true)}
          className="shrink-0 whitespace-nowrap h-8 px-2.5 bg-canvas hover:bg-panel border border-border border-dashed rounded-btn text-xs text-muted hover:text-main flex items-center gap-1 transition-colors"
          title={t('tabs.newListTitle')}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('tabs.newList')}</span>
        </button>
      </div>

      {/* Right Header Section like the notes: status (live, shared) | actions (share, view switcher) */}
      <div className="shrink-0 flex items-center gap-2">
        <LivePill />
        {currentSelectedList && (() => {
          const listOwnerId = currentSelectedList.ownerId || currentSelectedList.userId;
          const isOwner = currentSelectedList.isOwner !== false && (!listOwnerId || listOwnerId === currentUser?.id);
          const sharesCount = (currentSelectedList.shares?.length || 0) > 0
            ? currentSelectedList.shares.length
            : (currentSelectedList.members?.filter((m) => m.userId !== listOwnerId).length || 0);
          const isShared = sharesCount > 0 || ((currentSelectedList.members?.length || 0) > 1);
          const ownerMember = currentSelectedList.members?.find((m) => m.role === 'owner' || m.userId === listOwnerId);
          const ownerDisplayName = currentSelectedList.ownerName || ownerMember?.displayName || ownerMember?.email || t('tabs.owner');

          return (
            <div className="flex items-center gap-1.5">
              {isShared && (
                <SharedPill
                  isOwner={isOwner}
                  count={sharesCount > 0 ? sharesCount : currentSelectedList.members?.length || 1}
                  ownerName={ownerDisplayName}
                  onClick={() => handleOpenShareModal(currentSelectedList)}
                  title={isOwner ? t('tabs.shareMenu') : t('tabs.shareOpen')}
                />
              )}

              <span className="w-px h-5 bg-border mx-0.5" aria-hidden />
              <ActionMenu
                label={t('common:listMenu.more')}
                items={[
                  {
                    key: 'mute',
                    icon: currentSelectedList.isMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />,
                    label: currentSelectedList.isMuted ? t('common:listMenu.unmute') : t('common:listMenu.mute'),
                    hint: isTaskListShared(currentSelectedList) ? undefined : t('common:listMenu.muteOnlyShared'),
                    tooltip: isTaskListShared(currentSelectedList) ? t('common:listMenu.muteHint') : undefined,
                    disabled: !isTaskListShared(currentSelectedList),
                    onSelect: () => onToggleMute(currentSelectedList),
                  },
                  {
                    key: 'share',
                    icon: <Users className="w-3.5 h-3.5" />,
                    label: t('common:listMenu.share'),
                    onSelect: () => handleOpenShareModal(currentSelectedList),
                  },
                  {
                    key: 'rename',
                    icon: <Pencil className="w-3.5 h-3.5" />,
                    label: t('common:listMenu.rename'),
                    disabled: currentSelectedList.permission === 'viewer',
                    hint: currentSelectedList.permission === 'viewer' ? t('common:listMenu.readOnly') : undefined,
                    onSelect: () => onRenameList(currentSelectedList),
                  },
                  {
                    key: 'delete',
                    icon: <Trash2 className="w-3.5 h-3.5" />,
                    label: t('common:listMenu.delete'),
                    danger: true,
                    disabled: !isOwner,
                    hint: isOwner ? undefined : t('common:listMenu.ownerOnly'),
                    onSelect: (e) => setPendingDelete({ list: currentSelectedList, x: e.clientX, y: e.clientY }),
                  },
                ]}
              />
            </div>
          );
        })()}
        {!currentSelectedList && <span className="w-px h-5 bg-border mx-0.5" aria-hidden />}

        {/* View switch: list, Kanban or calendar (the same switch as the hashtag sorting) */}
        <div data-tour="task-views" className="flex">
          <SegmentedControl
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'list', title: t('tabs.listView'), label: viewLabel(<LayoutList className="w-3.5 h-3.5" />, t('tabs.list')) },
              { value: 'kanban', title: t('tabs.kanbanView'), label: viewLabel(<Columns className="w-3.5 h-3.5" />, t('tabs.kanban')) },
              { value: 'calendar', title: t('tabs.calendarView'), label: viewLabel(<CalendarDays className="w-3.5 h-3.5" />, t('tabs.calendar')) },
            ]}
          />
        </div>
      </div>
      {pendingDelete && (
        <ConfirmPopover
          x={pendingDelete.x}
          y={pendingDelete.y}
          danger
          confirmLabel={t('common:delete')}
          message={
            <Trans t={t} i18nKey="tabs.confirmDelete" values={{ title: pendingDelete.list.title }} components={{ b: <strong /> }} />
          }
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            setPendingDelete(null);
            deleteTaskList(pendingDelete.list.id);
          }}
        />
      )}
    </div>
  );
}
