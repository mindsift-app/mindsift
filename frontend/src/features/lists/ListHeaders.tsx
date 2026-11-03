import React from 'react';
import { Plus, Users, X } from 'lucide-react';
import { ListItem, SharedList, User } from '../../lib/types';
import { AvatarPerson, AvatarStack } from '../../components/AvatarStack';
import { CountBadge } from '../../components/CountBadge';
import { ListSwitcher } from '../../components/ListSwitcher';
import { LivePill } from '../../components/LivePill';
import { canWriteList, deduplicateItems } from './listItems';
import { useListDrag } from './useListDrag';

// Desktop: the list tabs (an entry dropped on a tab moves into that list), "Neue Liste" and on the right
// the status (live, shared) and the actions of the open list
export function ListTabsHeader({
  lists,
  activeList,
  setActiveListId,
  currentUser,
  otherMembers,
  drag,
  handleDeleteList,
  openShareModal,
  setShowNewListModal,
}: {
  lists: SharedList[];
  activeList: SharedList | null;
  setActiveListId: (id: string) => void;
  currentUser?: User | null;
  otherMembers: (lst: SharedList) => AvatarPerson[];
  drag: ReturnType<typeof useListDrag>;
  handleDeleteList: (listId: string) => void;
  openShareModal: () => void;
  setShowNewListModal: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { draggingItemId, dragOverListTab, setDragOverListTab, handleDropOnListTab } = drag;
  return (
    <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 !mt-0">
      {/* List Tabs */}
      <div className="flex flex-wrap items-center gap-1">
        {lists.map((lst) => {
          const openCount = deduplicateItems(lst.items || []).filter((i) => !i.isCompleted).length;
          const isSelected = activeList?.id === lst.id;
          return (
            <div
              key={lst.id}
              onDragOver={(e) => {
                if (!draggingItemId || isSelected || !canWriteList(lst)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverListTab !== lst.id) setDragOverListTab(lst.id);
              }}
              onDragLeave={() => {
                if (dragOverListTab === lst.id) setDragOverListTab(null);
              }}
              onDrop={(e) => handleDropOnListTab(e, lst)}
              className={`relative group h-8 flex items-center border rounded-btn transition-colors ${
                isSelected ? 'bg-panel border-accent text-main' : 'bg-canvas border-border text-muted hover:text-main'
              } ${isSelected && lists.length > 1 ? 'pr-1' : ''} ${
                dragOverListTab === lst.id ? 'ring-2 ring-accent/60 bg-accent/10 text-main' : ''
              }`}
            >
              <button
                onClick={() => setActiveListId(lst.id)}
                className="h-full px-3 text-xs font-medium flex items-center gap-1.5 rounded-btn"
              >
                <span>{lst.icon}</span>
                {/* Counter on the label, like in the nav bar */}
                <span className="inline-flex items-center">
                  {lst.title}
                  <CountBadge count={openCount} position="text" />
                </span>
                <AvatarStack
                  people={otherMembers(lst)}
                  size="xxs"
                  ringClass={isSelected ? 'ring-[var(--bg-panel)]' : 'ring-[var(--bg-app)]'}
                  className="ml-0.5"
                />
              </button>
              {isSelected && lists.length > 1 && (
                <button
                  onClick={() => handleDeleteList(lst.id)}
                  title="Liste löschen"
                  className="h-6 w-6 text-faint hover:text-status-err hover:bg-status-err/10 rounded-btn flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={() => setShowNewListModal((prev) => !prev)}
          className="h-8 px-2.5 bg-canvas hover:bg-panel border border-border border-dashed rounded-btn text-xs text-muted hover:text-main flex items-center gap-1 transition-colors"
          title="Neue Liste anlegen"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Neue Liste</span>
        </button>
      </div>

      {/* Right Header Section like the notes: status (live, shared) | actions */}
      <div className="flex items-center gap-2">
        <LivePill />
        {activeList && (() => {
          const isOwner = activeList.isOwner !== false && (activeList.userId === currentUser?.id || !activeList.userId || currentUser?.role === 'admin');
          const sharesCount = activeList.shares?.length || 0;
          const isShared = sharesCount > 0;
          const ownerDisplayName = activeList.ownerName || 'Eigentümer';

          return (
            <div className="flex items-center gap-1.5">
              {isShared && (
                isOwner ? (
                  <button
                    type="button"
                    onClick={openShareModal}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent border border-accent/30 flex items-center gap-1 hover:bg-accent/25 hover:border-accent/50 transition-colors cursor-pointer"
                    title="Teilen-Menü öffnen: Geteilt mit Nutzern/Gruppen anzeigen & verwalten"
                  >
                    <Users className="w-2.5 h-2.5" />
                    <span>Geteilt ({sharesCount})</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openShareModal}
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
                onClick={openShareModal}
                className="btn-icon"
                title="Liste teilen und Berechtigungen"
              >
                <Users className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Phones: compact bar with the open list (switching and actions live in the menu behind the logo); same
// height with or without the 36 px share button (Tasks, Shopping lists)
export function MobileListHeader({
  lists,
  activeList,
  setActiveListId,
  openItems,
  openShareModal,
}: {
  lists: SharedList[];
  activeList: SharedList | null;
  setActiveListId: (id: string) => void;
  openItems: ListItem[];
  openShareModal: () => void;
}) {
  return (
    <div className="flex sm:hidden items-center justify-between gap-2 px-3 py-2 min-h-[54px] rounded-btn bg-panel border border-border !mt-0">
      <div className="flex items-center gap-2 min-w-0">
        {activeList ? (
          <ListSwitcher
            label={[activeList.icon, activeList.title].filter(Boolean).join(' ')}
            items={lists.map((lst) => ({
              id: lst.id,
              title: lst.title,
              icon: lst.icon,
              count: deduplicateItems(lst.items || []).filter((i) => !i.isCompleted).length,
            }))}
            activeId={activeList.id}
            onSelect={setActiveListId}
          />
        ) : (
          <span className="text-sm font-semibold text-main truncate">🛒 Einkaufsliste</span>
        )}
        {openItems.length > 0 && (
          <span className="badge-neutral text-[11px] flex-shrink-0">
            {openItems.length} offen
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <LivePill />
        {activeList && (
          <>
            <span className="w-px h-5 bg-border" aria-hidden />
            <button
              type="button"
              onClick={openShareModal}
              className="btn-icon min-h-[36px] min-w-[36px] flex items-center justify-center"
              title="Liste teilen"
            >
              <Users className="w-4 h-4 text-accent" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
