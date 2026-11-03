import React from 'react';
import { Columns, LayoutList, Plus, Users, X } from 'lucide-react';
import { AvatarStack } from '../../components/AvatarStack';
import { CountBadge } from '../../components/CountBadge';
import { LivePill } from '../../components/LivePill';
import { TaskList, TaskListMember, Thought, User } from '../../lib/types';
import { ViewMode } from './taskViewTypes';
import { useTaskDrag } from './useTaskDrag';
import { AvatarPerson } from '../../components/AvatarStack';

interface TaskListTabsProps {
  // Result of useTaskDrag in TasksView (tasks can be dropped onto a list tab)
  drag: ReturnType<typeof useTaskDrag>;
  currentSelectedList: TaskList | undefined;
  currentUser: User | null | undefined;
  handleDeleteTaskList: (listId: string) => void;
  handleOpenShareModal: (tl: TaskList) => void;
  memberToPerson: (m: TaskListMember) => AvatarPerson;
  openTasksCount: number | undefined;
  safeTaskLists: TaskList[];
  selectedListId: string;
  setSelectedListId: (id: string) => void;
  setShowNewListModal: (show: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  viewMode: ViewMode;
  tasks: Thought[];
}

// Desktop header of TasksView: "Alle Aufgaben" and one tab per task list (members, share, delete; a task
// dragged onto a tab moves into that list), "Neue Liste" and the switch between list and Kanban
export function TaskListTabs({
  drag,
  currentSelectedList,
  currentUser,
  handleDeleteTaskList,
  handleOpenShareModal,
  memberToPerson,
  openTasksCount,
  safeTaskLists,
  selectedListId,
  setSelectedListId,
  setShowNewListModal,
  setViewMode,
  viewMode,
  tasks,
}: TaskListTabsProps) {
  const { dragOverListTab, draggingTaskId, handleDropOnListTab, setDragOverListTab } = drag;

  return (
    <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 !mt-0">
      {/* Task Lists selector tabs */}
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => setSelectedListId('all')}
          className={`h-8 px-3 text-xs font-medium border rounded-btn transition-colors ${
            selectedListId === 'all'
              ? 'bg-panel border-accent text-main'
              : 'bg-canvas border-border text-muted hover:text-main'
          }`}
        >
          {/* Counter on the label, like in the nav bar */}
          <span className="inline-flex items-center">
            Alle Aufgaben
            <CountBadge count={openTasksCount} position="text" />
          </span>
        </button>

        {safeTaskLists.map((tl) => (
          <div
            key={tl.id}
            onDragOver={(e) => {
              const task = draggingTaskId ? tasks.find((t) => t.id === draggingTaskId) : null;
              if (!task || task.taskListId === tl.id || tl.permission === 'viewer') return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverListTab !== tl.id) setDragOverListTab(tl.id);
            }}
            onDragLeave={() => {
              if (dragOverListTab === tl.id) setDragOverListTab(null);
            }}
            onDrop={(e) => handleDropOnListTab(e, tl)}
            className={`relative group h-8 flex items-center border rounded-btn transition-colors ${
              selectedListId === tl.id ? 'bg-panel border-accent text-main pr-1' : 'bg-canvas border-border text-muted hover:text-main'
            } ${dragOverListTab === tl.id ? 'ring-2 ring-accent/60 bg-accent/10 text-main' : ''}`}
          >
            <button
              onClick={() => setSelectedListId(tl.id)}
              className="h-full px-3 text-xs font-medium flex items-center gap-1.5 rounded-btn"
            >
              <span>{tl.icon}</span>
              <span className="inline-flex items-center">
                {tl.title}
                <CountBadge count={tl.tasksCount} position="text" />
              </span>

              {(() => {
                const isShared = (tl.shares && tl.shares.length > 0) || (tl.members && tl.members.length > 1);
                if (!isShared) return null;
                const otherMembers = (tl.members || []).filter((m) => m.userId !== currentUser?.id);
                if (otherMembers.length > 0) {
                  return (
                    <AvatarStack
                      people={otherMembers.map(memberToPerson)}
                      size="xxs"
                      ringClass={selectedListId === tl.id ? 'ring-[var(--bg-panel)]' : 'ring-[var(--bg-app)]'}
                      className="ml-0.5"
                    />
                  );
                }
                return (
                  <span title="Geteilt mit Team oder Benutzern">
                    <Users className="w-2.5 h-2.5 text-accent ml-0.5" />
                  </span>
                );
              })()}
            </button>
            {selectedListId === tl.id && (
              <button
                onClick={() => handleDeleteTaskList(tl.id)}
                title="Liste löschen"
                className="h-6 w-6 text-faint hover:text-status-err hover:bg-status-err/10 rounded-btn flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        <button
          onClick={() => setShowNewListModal(true)}
          className="h-8 px-2.5 bg-canvas hover:bg-panel border border-border border-dashed rounded-btn text-xs text-muted hover:text-main flex items-center gap-1 transition-colors"
          title="Neue Aufgabenliste anlegen"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Neue Liste</span>
        </button>
      </div>

      {/* Right Header Section like the notes: status (live, shared) | actions (share, view switcher) */}
      <div className="flex items-center gap-2">
        <LivePill />
        {currentSelectedList && (() => {
          const listOwnerId = currentSelectedList.ownerId || currentSelectedList.userId;
          const isOwner = currentSelectedList.isOwner !== false && (!listOwnerId || listOwnerId === currentUser?.id);
          const sharesCount = (currentSelectedList.shares?.length || 0) > 0
            ? currentSelectedList.shares.length
            : (currentSelectedList.members?.filter((m) => m.userId !== listOwnerId).length || 0);
          const isShared = sharesCount > 0 || ((currentSelectedList.members?.length || 0) > 1);
          const ownerMember = currentSelectedList.members?.find((m) => m.role === 'owner' || m.userId === listOwnerId);
          const ownerDisplayName = currentSelectedList.ownerName || ownerMember?.displayName || ownerMember?.email || 'Eigentümer';

          return (
            <div className="flex items-center gap-1.5">
              {isShared && (
                isOwner ? (
                  <button
                    type="button"
                    onClick={() => handleOpenShareModal(currentSelectedList)}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent border border-accent/30 flex items-center gap-1 hover:bg-accent/25 hover:border-accent/50 transition-colors cursor-pointer"
                    title="Teilen-Menü öffnen: Geteilt mit Nutzern/Gruppen anzeigen & verwalten"
                  >
                    <Users className="w-2.5 h-2.5" />
                    <span>Geteilt ({sharesCount > 0 ? sharesCount : currentSelectedList.members?.length || 1})</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleOpenShareModal(currentSelectedList)}
                    className="px-2 py-0.5 rounded text-[10px] font-medium border border-border text-muted flex items-center gap-1 bg-surface-subtle hover:bg-panel-elevated hover:text-main transition-colors cursor-pointer"
                    title="Teilen & Berechtigungen öffnen"
                  >
                    <Users className="w-2.5 h-2.5" />
                    <span>Geteilt von {ownerDisplayName}</span>
                  </button>
                )
              )}

              <span className="w-px h-5 bg-border mx-0.5" aria-hidden />
              <button
                type="button"
                onClick={() => handleOpenShareModal(currentSelectedList)}
                className="btn-icon"
                title="Aufgabenliste teilen und Berechtigungen"
              >
                <Users className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })()}
        {!currentSelectedList && <span className="w-px h-5 bg-border mx-0.5" aria-hidden />}

        {/* View Switcher: List vs Kanban */}
        <div className="flex border border-border rounded-btn bg-canvas overflow-hidden">
          <button
            onClick={() => setViewMode('list')}
            className={`h-8 px-2.5 flex items-center gap-1.5 text-xs transition-colors border-r border-border ${
              viewMode === 'list' ? 'bg-panel text-main font-medium' : 'text-muted hover:text-main'
            }`}
            title="Listenansicht"
          >
            <LayoutList className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Liste</span>
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`h-8 px-2.5 flex items-center gap-1.5 text-xs transition-colors ${
              viewMode === 'kanban'
                ? 'bg-panel text-main font-medium'
                : 'text-muted hover:text-main'
            }`}
            title="Kanban-Board"
          >
            <Columns className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kanban</span>
          </button>
        </div>
      </div>
    </div>
  );
}
