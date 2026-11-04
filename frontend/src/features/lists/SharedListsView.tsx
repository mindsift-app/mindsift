import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  ShoppingCart,
} from 'lucide-react';
import { ListItem, SharedList, Team, User } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';
import { readViewMemory, writeViewMemory } from '../../lib/viewSession';
import { pendingListItems } from '../../lib/offline';
import { UnifiedShareModal } from '../../components/UnifiedShareModal';
import { AvatarStack, AvatarPerson } from '../../components/AvatarStack';
import { isPhoneWidth } from '../../lib/breakpoints';
import { reportNav, onNavStep, restoringNavPlace } from '../../lib/navHistory';
import { VoiceInputButton } from '../../components/VoiceInputButton';
import { FormSheet } from '../../components/FormSheet';
import { EmojiIconButton } from '../../components/EmojiIconButton';
import { useMobileActions } from '../../context/MobileActionContext';
import { collectHashtags, deduplicateItems, findHashtagQuery, matchHashtags, groupOpenItems, parseListItemInput } from './listItems';
import { useListDrag } from './useListDrag';
import { useListRealtime } from './useListRealtime';
import { useItemEditing } from './useItemEditing';
import { CompletedItems, OpenItemGroups } from './ListItemGroups';
import { ListTabsHeader, MobileListHeader } from './ListHeaders';
import { buildListsMenu } from './listsMenu';
import { askConfirm } from '../../components/askConfirm';
import { showError } from '../../components/ErrorNotice';

interface SharedListsViewProps {
  onRefreshGlobal: () => void;
  currentUser?: User | null;
  initialListId?: string | null;
}

export const SharedListsView: React.FC<SharedListsViewProps> = ({ onRefreshGlobal, currentUser, initialListId }) => {
  const { t } = useTranslation('lists');
  const { setGroups, setPrimaryAction } = useMobileActions();
  const [lists, setLists] = useState<SharedList[]>([]);
  // The open list is remembered on this device (other tabs of the app, new tab, restart)
  const [activeListId, setActiveListId] = useState<string>(() => {
    // Coming back here by the browser's back/forward: the list of that step
    const step = restoringNavPlace();
    return (step?.tab === 'lists' && step.shopList) || initialListId || readViewMemory<{ listId: string }>('lists').listId || '';
  });
  // Switching lists is a step of the browser history (lib/navHistory.ts)
  const autoSelectedListRef = useRef(false);
  useEffect(() => {
    const replace = autoSelectedListRef.current;
    autoSelectedListRef.current = false;
    if (activeListId) reportNav({ shopList: activeListId }, { replace });
  }, [activeListId]);
  useEffect(
    () =>
      onNavStep((place) => {
        if (place.tab === 'lists' && place.shopList) setActiveListId(place.shopList);
      }),
    []
  );
  useEffect(() => {
    if (activeListId) writeViewMemory('lists', { listId: activeListId });
  }, [activeListId]);

  useEffect(() => {
    if (initialListId) {
      setActiveListId(initialListId);
    }
  }, [initialListId]);

  const [newItemText, setNewItemText] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const [itemVoiceError, setItemVoiceError] = useState<string | null>(null);
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListIcon, setNewListIcon] = useState('🛒');

  const [showShareModal, setShowShareModal] = useState(false);
  const [collaborators, setCollaborators] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const [cursorPosition, setCursorPosition] = useState<number | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState<number>(0);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [workspaceTags, setWorkspaceTags] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Phones: the add form lives in a sheet opened by "+" instead of taking room above the list
  const [isPhone, setIsPhone] = useState(isPhoneWidth);
  const [showAddSheet, setShowAddSheet] = useState(false);
  useEffect(() => {
    const onResize = () => setIsPhone(isPhoneWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);


  const loadLists = async () => {
    try {
      let all = await api.getAllLists();
      if (all.length === 0) {
        try {
          const created = await api.createList('Wocheneinkauf', '🛒', 'shopping');
          all = [created];
        } catch {
          // fallback
        }
      }
      // Entries added offline and not sent yet stay visible (also after a reload without connection)
      const pending = pendingListItems();
      const deduplicated = all.map((l) => ({
        ...l,
        items: deduplicateItems([
          ...pending.filter((p) => p.listId === l.id).map((p) => ({ ...p, isCompleted: false, sortOrder: 0 }) as ListItem),
          ...(l.items || []),
        ]),
      }));
      setLists(deduplicated);
      if (initialListId && deduplicated.some((l) => l.id === initialListId)) {
        setActiveListId(initialListId);
      } else if (deduplicated.length > 0 && (!activeListId || !deduplicated.some((l) => l.id === activeListId))) {
        autoSelectedListRef.current = true; // chosen by the app, not a step of its own in the history
        setActiveListId(deduplicated[0].id);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadLists();
    api
      .getWorkspaceTags()
      .then((tags) => {
        setWorkspaceTags(tags.map((t) => t.tag.replace(/^#/, '')));
      })
      .catch(() => {});
  }, []);

  // People shown in tabs: everyone with access except me
  const otherMembers = (lst: SharedList): AvatarPerson[] =>
    (lst.members || [])
      .filter((m) => m.userId !== currentUser?.id)
      .map((m) => ({ id: m.userId, name: m.displayName || m.email, avatarUrl: m.avatarUrl }));

  const activeList = useMemo(() => {
    return lists.find((l) => l.id === activeListId) || lists[0] || null;
  }, [lists, activeListId]);

  // In shared lists every item shows who added it (older items without an author show nothing)
  const isActiveListShared = (activeList?.members?.length || 0) > 1 || (activeList?.shares?.length || 0) > 0;
  const renderItemAuthor = (item: ListItem) => {
    if (!isActiveListShared || !item.createdBy) return null;
    const member = activeList?.members?.find((m) => m.userId === item.createdBy);
    const name = member?.displayName || member?.email || item.createdByName || '';
    return (
      <AvatarStack
        people={[{ id: item.createdBy, name, avatarUrl: member?.avatarUrl }]}
        size="xxs"
        ringClass="ring-transparent"
        title={name ? t('addedBy', { name }) : undefined}
      />
    );
  };

  // Realtime: the open list's own connection, entries sent after being offline, list events (useListRealtime.ts)
  useListRealtime(activeList?.id, lists, setLists, loadLists);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    // Keep the field (and the phone keyboard) for the next item: refocus inside the tap
    inputRef.current?.focus({ preventScroll: true });
    if (!activeList || !newItemText.trim() || isSubmittingItem) return;
    setIsSubmittingItem(true);
    triggerHaptic(15);

    setShowSuggestions(false);
    const parsed = parseListItemInput(newItemText, newItemQty);
    setNewItemText('');
    setNewItemQty('');
    setCursorPosition(null);

    try {
      const item = await api.createListItem(activeList.id, parsed.content, parsed.category, parsed.quantity);
      setLists((prev) =>
        prev.map((l) => {
          if (l.id !== activeList.id) return l;
          if (l.items.some((i) => i.id === item.id)) return l;
          return { ...l, items: deduplicateItems([item, ...l.items]) };
        })
      );
      onRefreshGlobal();
    } catch (err: any) {
      showError(err.message || t('createItemFailed'));
    } finally {
      setIsSubmittingItem(false);
    }
  };

  // Quantity editing, ticking, deleting and clearing done entries (useItemEditing.ts)
  const editing = useItemEditing({ activeList, setLists, onRefreshGlobal });
  const { handleClearCompleted } = editing;

  // Dragging entries: within the list, into another category, onto another list's tab (useListDrag.ts)
  const drag = useListDrag({ activeList, setLists, loadLists, onRefreshGlobal });

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    const created = await api.createList(newListTitle.trim(), newListIcon, 'shopping');
    setNewListTitle('');
    setShowNewListModal(false);
    await loadLists();
    setActiveListId(created.id);
    onRefreshGlobal();
  };

  const handleDeleteList = async (listId: string) => {
    if (!(await askConfirm({ message: t('confirmDelete'), confirmLabel: t('common:delete'), danger: true }))) return;
    try {
      await api.deleteList(listId);
      await loadLists();
      onRefreshGlobal();
    } catch (err: any) {
      showError(err.message || t('deleteFailed'));
    }
  };

  const openShareModal = async () => {
    if (!activeList) return;
    setShowShareModal(true);
    try {
      const [usersList, teamsList, sharesList] = await Promise.all([
        api.getUsersDirectory ? api.getUsersDirectory().catch(() => api.getCollaborators().catch(() => [])) : api.getCollaborators().catch(() => []),
        api.getUserTeams().catch(() => []),
        api.getListShares(activeList.id).catch(() => []),
      ]);
      setCollaborators(usersList);
      setTeams(teamsList);
      setLists((prev) => prev.map((l) => (l.id === activeList.id ? { ...l, shares: sharesList } : l)));
    } catch {
      // ignore
    }
  };

  const allAvailableHashtags = useMemo(() => collectHashtags(lists, workspaceTags), [lists, workspaceTags]);

  const activeHashtagQuery = useMemo(
    () => (showSuggestions ? findHashtagQuery(newItemText, cursorPosition !== null ? cursorPosition : newItemText.length) : null),
    [newItemText, cursorPosition, showSuggestions]
  );

  const matchingSuggestions = useMemo(
    () => (activeHashtagQuery ? matchHashtags(activeHashtagQuery.query, allAvailableHashtags) : []),
    [activeHashtagQuery, allAvailableHashtags]
  );

  const applySuggestion = (tag: string) => {
    if (!activeHashtagQuery) return;
    const before = newItemText.slice(0, activeHashtagQuery.matchIndex);
    const after = newItemText.slice(activeHashtagQuery.cursorPos);
    const newText = `${before}#${tag} ${after}`;
    setNewItemText(newText);
    setShowSuggestions(false);
    setSuggestionIndex(0);

    const newCursor = activeHashtagQuery.matchIndex + tag.length + 2; // '#' + tag + ' '
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursor, newCursor);
        setCursorPosition(newCursor);
      }
    }, 10);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && activeHashtagQuery && matchingSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex((prev) => (prev + 1) % matchingSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex((prev) => (prev - 1 + matchingSuggestions.length) % matchingSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = matchingSuggestions[suggestionIndex] || matchingSuggestions[0];
        if (selected) {
          applySuggestion(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }
  };

  const safeActiveItems = useMemo(() => deduplicateItems(activeList?.items || []), [activeList?.items]);
  const openItems = useMemo(() => safeActiveItems.filter((i) => !i.isCompleted), [safeActiveItems]);
  const completedItems = useMemo(() => safeActiveItems.filter((i) => i.isCompleted), [safeActiveItems]);

  const groupedOpenItems = useMemo(() => groupOpenItems(openItems), [openItems]);

  const focusNewItemInput = () => {
    if (isPhoneWidth()) {
      setShowAddSheet(true);
      return;
    }
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Register context-sensitive mobile menu groups behind the MindSift logo (listsMenu.tsx)
  useEffect(() => {
    setPrimaryAction(() => {
      // Focus right inside the tap: iOS only opens the keyboard for focus() during the user gesture
      focusNewItemInput();
    });

    setGroups(
      buildListsMenu({
        lists,
        activeList,
        completedCount: completedItems.length,
        focusNewItemInput,
        setShowNewListModal,
        openShareModal,
        handleClearCompleted,
        handleDeleteList,
        setActiveListId,
      })
    );
  }, [lists, activeList, completedItems.length, setGroups, setPrimaryAction]);

  // The add form's fields: inline on the desktop, on phones in a sheet that "+" opens (no fixed field
  // taking room above the list); the sheet brings its own buttons
  const renderAddItemFields = (withButton: boolean) =>
    activeList ? (
      <>
        {/* The item is the main field: a real input like the quantity next to it, with the + inside */}
        <div className="relative flex-1 w-full min-w-0">
          <Plus className="w-4 h-4 text-accent absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            autoFocus={!withButton}
            value={newItemText}
            onChange={(e) => {
              setNewItemText(e.target.value);
              setCursorPosition(e.target.selectionStart);
              setShowSuggestions(true);
              setSuggestionIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            onSelect={(e) => {
              setCursorPosition(e.currentTarget.selectionStart);
            }}
            onFocus={(e) => {
              setCursorPosition(e.target.selectionStart);
              setShowSuggestions(true);
            }}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 200);
            }}
            placeholder={itemVoiceError || t('itemPlaceholder', { title: activeList.title })}
            // 16px on phones: iOS zooms into smaller fields and the layout jumps under the keyboard
            className="w-full h-11 sm:h-9 pl-9 pr-11 sm:pr-9 input-field text-base sm:text-sm"
          />
          <VoiceInputButton
            value={newItemText}
            onChange={setNewItemText}
            focusRef={inputRef}
            onError={(message) => {
              setItemVoiceError(message);
              window.setTimeout(() => setItemVoiceError(null), 4000);
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2"
          />

          {/* Hashtag Autocomplete Suggestions Dropdown */}
          {showSuggestions && activeHashtagQuery && matchingSuggestions.length > 0 && (
            <div className="absolute left-6 top-full mt-2 w-64 max-h-56 overflow-y-auto bg-panel-elevated border border-border rounded-btn shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2.5 py-1 text-[10px] uppercase font-semibold text-faint tracking-wider border-b border-border/50">
                Hashtags
              </div>
              {matchingSuggestions.map((tag, idx) => {
                const isSelected = idx === suggestionIndex;
                return (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySuggestion(tag);
                    }}
                    className={`w-full text-left px-3 py-2 sm:py-1.5 text-xs flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-accent/20 text-accent font-medium'
                        : 'text-main hover:bg-panel-hover'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-accent font-mono font-semibold">#</span>
                      <span>{tag}</span>
                    </span>
                    {isSelected && (
                      <span className="text-[10px] text-faint font-mono">↵</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="text"
            inputMode="decimal"
            value={newItemQty}
            onChange={(e) => setNewItemQty(e.target.value.replace(/[^0-9.,xX]/g, ''))}
            placeholder={t('quantity')}
            aria-label={t('quantityLabel')}
            className="w-24 sm:w-20 h-11 sm:h-9 px-2.5 input-field text-base sm:text-sm"
          />
          {withButton && (
            <button
              type="submit"
              disabled={isSubmittingItem || !newItemText.trim()}
              className="btn-primary flex-1 sm:flex-none h-11 sm:h-9 px-4 text-sm sm:text-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 flex-shrink-0"
            >
              {isSubmittingItem ? t('adding') : t('common:add')}
            </button>
          )}
        </div>
      </>
    ) : null;


  return (
    <div className="w-full space-y-3">
      {/* Top Header: List Tabs & Actions (Desktop) */}
      <ListTabsHeader
        lists={lists}
        activeList={activeList}
        setActiveListId={setActiveListId}
        currentUser={currentUser}
        otherMembers={otherMembers}
        drag={drag}
        handleDeleteList={handleDeleteList}
        openShareModal={openShareModal}
        setShowNewListModal={setShowNewListModal}
      />

      {/* Mobile Compact Header Bar (List switching & actions live in MindSift Logo Menu) */}
      <MobileListHeader lists={lists} activeList={activeList} setActiveListId={setActiveListId} openItems={openItems} openShareModal={openShareModal} />

      {showNewListModal && (
        <FormSheet
          title={t('menu.newList')}
          icon={<ShoppingCart className="w-4 h-4 text-accent" />}
          onClose={() => setShowNewListModal(false)}
          onSubmit={handleCreateList}
        >
            <div>
              <label className="block text-xs text-muted mb-1">{t('listTitle')}</label>
              <div className="flex items-center gap-1.5">
                <EmojiIconButton value={newListIcon} onChange={setNewListIcon} />
                <input
                  type="text"
                  value={newListTitle}
                  onChange={(e) => setNewListTitle(e.target.value)}
                  placeholder={t('listTitlePlaceholder')}
                  autoFocus
                  required
                  className="flex-1 min-w-0 h-11 sm:h-8 input-field px-2.5 text-base sm:text-xs"
                />
              </div>
            </div>
        </FormSheet>
      )}

      {/* Active Shared List View */}
      {activeList ? (
        <div className="space-y-4">
          {/* Phones: "+" opens the add form as a sheet; it stays open for the next item */}
          {isPhone && showAddSheet && (
            <FormSheet
              title={`Auf „${activeList.title}“`}
              icon={<ShoppingCart className="w-4 h-4 text-accent" />}
              onClose={() => setShowAddSheet(false)}
              onSubmit={handleAddItem}
              submitLabel={t('common:add')}
              busy={isSubmittingItem}
            >
              <div className="flex flex-col gap-2 relative">{renderAddItemFields(false)}</div>
            </FormSheet>
          )}

          {/* Quick-Add Form (desktop; on phones it is the sheet above) */}
          {!isPhone && (
            <form
              onSubmit={handleAddItem}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 panel-surface p-2 relative"
            >
              {renderAddItemFields(true)}
            </form>
          )}

          {/* Open Items Grouped by Hashtags / Categories */}
          <OpenItemGroups
            openItems={openItems}
            groupedOpenItems={groupedOpenItems}
            drag={drag}
            editing={editing}
            renderItemAuthor={renderItemAuthor}
          />

          {/* Completed Items Section */}
          <CompletedItems completedItems={completedItems} editing={editing} renderItemAuthor={renderItemAuthor} />
        </div>
      ) : null}

      {/* Unified Shopping List Sharing Modal */}
      {showShareModal && activeList && (
        <UnifiedShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          title={t('shareDialogTitle', { title: activeList.title })}
          resourceName={activeList.title}
          resourceIcon={activeList.icon || undefined}
          isOwner={activeList.isOwner !== false && (activeList.userId === currentUser?.id || !activeList.userId || currentUser?.role === 'admin')}
          currentUserId={currentUser?.id}
          shares={(activeList.shares || []).map((s) => ({
            id: s.id,
            targetType: s.targetType,
            targetId: s.targetId,
            targetName: s.targetName || (s.targetType === 'team' ? t('common:share.group') : t('common:share.user')),
            targetEmail: s.targetEmail,
            permission: s.role === 'viewer' ? ('viewer' as const) : ('editor' as const),
            role: s.role,
            createdAt: s.createdAt,
          }))}
          teams={teams}
          collaborators={collaborators}
          allowRoleSelection={true}
          onAddShare={async (targetType, targetId, permission) => {
            await api.addListShare(activeList.id, {
              targetType,
              targetId,
              role: permission,
            });
            const freshShares = await api.getListShares(activeList.id);
            setLists((prev) =>
              prev.map((l) => (l.id === activeList.id ? { ...l, shares: freshShares } : l))
            );
            onRefreshGlobal();
          }}
          onRemoveShare={async (shareId) => {
            await api.removeListShare(activeList.id, shareId);
            const freshShares = await api.getListShares(activeList.id);
            setLists((prev) =>
              prev.map((l) => (l.id === activeList.id ? { ...l, shares: freshShares } : l))
            );
            onRefreshGlobal();
          }}
        />
      )}
    </div>
  );
};
