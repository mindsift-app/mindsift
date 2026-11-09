import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { ActionMenu } from '../../components/ActionMenu';
import { MoreTabsButton } from '../../components/MoreTabsButton';
import { OVERFLOW_HIDDEN_TAB, useOverflowTabs } from '../../lib/useOverflowTabs';
import { ListItem, SharedList, User } from '../../lib/types';
import { AvatarPerson, AvatarStack } from '../../components/AvatarStack';
import { CountBadge } from '../../components/CountBadge';
import { SharedPill } from '../../components/SharedPill';
import { ListSwitcher } from '../../components/ListSwitcher';
import { LivePill } from '../../components/LivePill';
import { canWriteList, deduplicateItems } from './listItems';
import { useListDrag } from './useListDrag';
import { useTabReorder } from '../../lib/useTabReorder';
import { TabDropMarker } from '../../components/TabDropMarker';

// Desktop: the list tabs in one row (an entry dropped on a tab moves into that list; what does not fit goes
// behind "⋯ n"), "Neue Liste" and on the right the status (live, shared) and the menu of the open list
// (share, rename, delete)
export function ListTabsHeader({
  lists,
  activeList,
  setActiveListId,
  currentUser,
  otherMembers,
  drag,
  handleDeleteList,
  openShareModal,
  onRenameList,
  setShowNewListModal,
  onReorderLists,
}: {
  lists: SharedList[];
  activeList: SharedList | null;
  setActiveListId: (id: string) => void;
  currentUser?: User | null;
  otherMembers: (lst: SharedList) => AvatarPerson[];
  drag: ReturnType<typeof useListDrag>;
  handleDeleteList: (listId: string) => void;
  openShareModal: () => void;
  onRenameList: (lst: SharedList) => void;
  setShowNewListModal: React.Dispatch<React.SetStateAction<boolean>>;
  // New order of the list tabs (drag and drop)
  onReorderLists: (ids: string[]) => void;
}) {
  const { t } = useTranslation('lists');
  const { draggingItemId, dragOverListTab, setDragOverListTab, handleDropOnListTab } = drag;
  const reorder = useTabReorder(lists.map((l) => l.id), onReorderLists);
  const overflow = useOverflowTabs(
    lists.map((l) => l.id),
    activeList?.id || null
  );
  const openCountOf = (lst: SharedList) => deduplicateItems(lst.items || []).filter((i) => !i.isCompleted).length;
  // A dragged entry may drop on this list (its tab or its row in the "more" list)
  const tabDropProps = (lst: SharedList) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!draggingItemId || activeList?.id === lst.id || !canWriteList(lst)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverListTab !== lst.id) setDragOverListTab(lst.id);
    },
    onDragLeave: () => {
      if (dragOverListTab === lst.id) setDragOverListTab(null);
    },
    onDrop: (e: React.DragEvent) => handleDropOnListTab(e, lst),
  });
  return (
    <div className="hidden sm:flex items-center gap-2 border-b border-border pb-2 !mt-0">
      {/* List Tabs: one row, what does not fit goes behind "⋯ n" */}
      <div ref={overflow.rowRef} className="relative flex-1 min-w-0 flex items-center gap-1">
        {lists.map((lst) => {
          const openCount = openCountOf(lst);
          const isSelected = activeList?.id === lst.id;
          const drop = tabDropProps(lst);
          const hidden = overflow.isHidden(lst.id);
          return (
            <div
              key={lst.id}
              ref={overflow.tabRef(lst.id)}
              aria-hidden={hidden || undefined}
              {...reorder.dragProps(lst.id)}
              onDragOver={(e) => {
                if (reorder.handleDragOver(e, lst.id)) return;
                drop.onDragOver(e);
              }}
              onDragLeave={drop.onDragLeave}
              onDrop={(e) => {
                if (!reorder.handleDrop(e, lst.id)) drop.onDrop(e);
              }}
              className={`group shrink-0 whitespace-nowrap h-8 flex items-center border rounded-btn transition-colors ${
                isSelected ? 'bg-panel border-accent text-main' : 'bg-canvas border-border text-muted hover:text-main'
              } ${dragOverListTab === lst.id ? 'ring-2 ring-accent/60 bg-accent/10 text-main' : ''} ${
                reorder.draggingId === lst.id ? 'opacity-50' : ''
              } ${hidden ? OVERFLOW_HIDDEN_TAB : 'relative'}`}
            >
              <TabDropMarker side={reorder.dropSide(lst.id)} />
              <button
                onClick={() => setActiveListId(lst.id)}
                tabIndex={hidden ? -1 : undefined}
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
            </div>
          );
        })}

        <MoreTabsButton
          ref={overflow.moreRef}
          items={lists
            .filter((lst) => overflow.isHidden(lst.id))
            .map((lst) => ({ id: lst.id, icon: lst.icon, title: lst.title, count: openCountOf(lst) }))}
          activeId={activeList?.id || null}
          onSelect={setActiveListId}
          dragActive={!!draggingItemId}
          rowDropProps={(id) => {
            const lst = lists.find((l) => l.id === id);
            return lst ? tabDropProps(lst) : {};
          }}
          highlightId={dragOverListTab}
        />

        <button
          data-tab-fixed
          onClick={() => setShowNewListModal((prev) => !prev)}
          className="shrink-0 whitespace-nowrap h-8 px-2.5 bg-canvas hover:bg-panel border border-border border-dashed rounded-btn text-xs text-muted hover:text-main flex items-center gap-1 transition-colors"
          title={t('newListTitle')}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('newList')}</span>
        </button>
      </div>

      {/* Right Header Section like the notes: status (live, shared) | actions */}
      <div className="shrink-0 flex items-center gap-2">
        <LivePill />
        {activeList && (() => {
          const isOwner = activeList.isOwner !== false && (activeList.userId === currentUser?.id || !activeList.userId || currentUser?.role === 'admin');
          const sharesCount = activeList.shares?.length || 0;
          const isShared = sharesCount > 0;
          const ownerDisplayName = activeList.ownerName || t('tasks:tabs.owner');

          return (
            <div className="flex items-center gap-1.5">
              {isShared && (
                <SharedPill
                  isOwner={isOwner}
                  count={sharesCount}
                  ownerName={ownerDisplayName}
                  onClick={openShareModal}
                  title={isOwner ? t('shareMenu') : t('shareOpen')}
                />
              )}

              <span className="w-px h-5 bg-border mx-0.5" aria-hidden />
              <ActionMenu
                label={t('common:listMenu.more')}
                items={[
                  {
                    key: 'share',
                    icon: <Users className="w-3.5 h-3.5" />,
                    label: t('common:listMenu.share'),
                    onSelect: openShareModal,
                  },
                  {
                    key: 'rename',
                    icon: <Pencil className="w-3.5 h-3.5" />,
                    label: t('common:listMenu.rename'),
                    disabled: !canWriteList(activeList),
                    hint: canWriteList(activeList) ? undefined : t('common:listMenu.readOnly'),
                    onSelect: () => onRenameList(activeList),
                  },
                  // The last list stays (as before)
                  ...(lists.length > 1
                    ? [
                        {
                          key: 'delete',
                          icon: <Trash2 className="w-3.5 h-3.5" />,
                          label: t('common:listMenu.delete'),
                          danger: true,
                          disabled: activeList.userId !== currentUser?.id,
                          hint: activeList.userId !== currentUser?.id ? t('common:listMenu.ownerOnly') : undefined,
                          onSelect: () => handleDeleteList(activeList.id),
                        },
                      ]
                    : []),
                ]}
              />
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
  const { t } = useTranslation('lists');
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
          <span className="text-sm font-semibold text-main truncate">{t('shoppingList')}</span>
        )}
        {openItems.length > 0 && (
          <span className="badge-neutral text-[11px] flex-shrink-0">
            {t('openCount', { count: openItems.length })}
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
              title={t('share')}
            >
              <Users className="w-4 h-4 text-accent" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
