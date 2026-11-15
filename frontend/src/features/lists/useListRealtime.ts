import React, { useEffect, useRef } from 'react';
import { ListItem, SharedList, WSMessage } from '../../lib/types';
import { createRealtimeConnection } from '../../lib/api';
import { OFFLINE_ITEM_PREFIX, PendingListChange, getOutbox, isListEntry, isOffline, pendingListChanges, pendingListItems } from '../../lib/offline';
import { deduplicateItems, withPendingChanges } from './listItems';
import { useLatestRef } from '../../lib/useLatestRef';
import { useRealtimeReload } from '../../lib/realtimeReload';

// List events that cannot be applied from their payload: shares changed (the members shown need the
// people's details). They reload the lists, one request per burst.
export const LIST_RELOAD_EVENTS = ['LIST_SHARED', 'LIST_UNSHARED'];

type ReorderedItem = { id: string; sortOrder: number; category?: string; content?: string };

// Ticks, edits and deletions made offline and not sent yet (lib/offline.ts pendingListChanges), by item id:
// an event arriving meanwhile carries the server's older state, the change waiting to be sent stays on top
type PendingChanges = Map<string, PendingListChange>;
const NO_CHANGES: PendingChanges = new Map();

// ITEM_REORDERED carries the new places (and category and text of an entry dropped into another
// category): applied in place, the list sorted by them. Nothing changed keeps the list.
function itemsAfterReorder(items: ListItem[], moved: ReorderedItem[]): ListItem[] {
  const byId = new Map(moved.filter((m) => m && typeof m.id === 'string').map((m) => [m.id, m]));
  let changed = false;
  const next = items.map((i) => {
    const m = byId.get(i.id);
    if (!m) return i;
    const category = m.category ?? i.category;
    const content = m.content ?? i.content;
    if (i.sortOrder === m.sortOrder && category === i.category && content === i.content) return i;
    changed = true;
    return { ...i, sortOrder: m.sortOrder, category, content };
  });
  if (!changed) return items;
  return next.map((item, index) => ({ item, index })).sort((a, b) => a.item.sortOrder - b.item.sortOrder || a.index - b.index).map((x) => x.item);
}

// LIST_UPDATED carries the list without what differs per person (isOwner, role): title, icon, type,
// entries, shares and members. Entries added offline and not sent yet stay, and so do changes made offline.
function listAfterUpdate(l: SharedList, p: Partial<SharedList>, changes: PendingChanges): SharedList {
  const offline = l.items.filter((i) => i.id.startsWith(OFFLINE_ITEM_PREFIX));
  return {
    ...l,
    ...(typeof p.title === 'string' ? { title: p.title } : {}),
    ...(typeof p.icon === 'string' ? { icon: p.icon } : {}),
    ...(typeof p.listType === 'string' ? { listType: p.listType } : {}),
    ...(typeof p.updatedAt === 'string' ? { updatedAt: p.updatedAt } : {}),
    ...(Array.isArray(p.items) ? { items: withPendingChanges(deduplicateItems([...offline, ...p.items]), changes) } : {}),
    ...(Array.isArray(p.shares) ? { shares: p.shares } : {}),
    ...(Array.isArray(p.members) ? { members: p.members } : {}),
  };
}

// How a list event changes the lists shown; reload: it cannot be applied from what it carries. changes:
// the ones made offline and not sent yet, kept on top of what the event carries
export function listsAfterEvent(
  prev: SharedList[],
  msg: WSMessage,
  changes: PendingChanges = NO_CHANGES
): { lists: SharedList[]; reload: boolean } {
  if (LIST_RELOAD_EVENTS.includes(msg.event)) return { lists: prev, reload: true };
  // Only the creator gets it: the tab that created the list shows it already, their other devices load
  // the lists (its place among them is the server's)
  if (msg.event === 'LIST_CREATED') {
    const id = (msg.payload as { id?: unknown } | null | undefined)?.id;
    return { lists: prev, reload: typeof id !== 'string' || !prev.some((l) => l.id === id) };
  }
  const listId = msg.listId || msg.list_id;
  if (msg.event === 'LIST_UPDATED') {
    const p = msg.payload as Partial<SharedList> | null | undefined;
    const id = listId || p?.id;
    if (!p || !id || !prev.some((l) => l.id === id)) return { lists: prev, reload: true };
    return { lists: prev.map((l) => (l.id === id ? listAfterUpdate(l, p, changes) : l)), reload: false };
  }
  if (msg.event === 'LIST_DELETED') {
    const id = listId || (msg.payload as { listId?: string } | null | undefined)?.listId;
    if (!id) return { lists: prev, reload: true };
    if (!prev.some((l) => l.id === id)) return { lists: prev, reload: false };
    const lists = prev.filter((l) => l.id !== id);
    // The last list gone: loading creates the default list again
    return { lists, reload: lists.length === 0 };
  }
  if (msg.event === 'ITEM_REORDERED') {
    const moved = (msg.payload as { items?: unknown } | null | undefined)?.items;
    if (!listId || !prev.some((l) => l.id === listId)) return { lists: prev, reload: false };
    if (!Array.isArray(moved)) return { lists: prev, reload: true };
    let changed = false;
    const lists = prev.map((l) => {
      if (l.id !== listId) return l;
      const items = itemsAfterReorder(l.items, moved as ReorderedItem[]);
      if (items === l.items) return l;
      changed = true;
      // A category or text changed offline wins over the one of the entry moved
      return { ...l, items: withPendingChanges(items, changes) };
    });
    return { lists: changed ? lists : prev, reload: false };
  }
  return { lists: listsAfterMessage(prev, msg, changes), reload: false };
}

// How an entry event of a list's connection changes the lists shown (changes: see listsAfterEvent)
export function listsAfterMessage(prev: SharedList[], msg: WSMessage, changes: PendingChanges = NO_CHANGES): SharedList[] {
  const msgListId = msg.listId || msg.list_id;
  if (!msgListId) return prev;
  if (msg.event === 'ITEM_CREATED') {
    const newItem = msg.payload as ListItem | undefined;
    if (!newItem || !newItem.id) return prev;
    return prev.map((l) => {
      if (l.id !== msgListId) return l;
      if (l.items.some((i) => i.id === newItem.id)) return l;
      return { ...l, items: deduplicateItems([newItem, ...l.items]) };
    });
  }
  if (msg.event === 'ITEM_TOGGLED' || msg.event === 'ITEM_UPDATED') {
    const updatedItem = msg.payload as ListItem;
    if (!updatedItem || !updatedItem.id) return prev;
    // Deleted offline: it stays hidden
    const shown = withPendingChanges([updatedItem], changes)[0] as ListItem | undefined;
    return prev.map((l) => {
      if (l.id !== msgListId) return l;
      return {
        ...l,
        items: shown ? l.items.map((i) => (i.id === updatedItem.id ? shown : i)) : l.items.filter((i) => i.id !== updatedItem.id),
      };
    });
  }
  if (msg.event === 'ITEM_DELETED') {
    const deletedId = (msg.payload as { itemId?: string } | undefined)?.itemId;
    return prev.map((l) => {
      if (l.id !== msgListId) return l;
      return { ...l, items: l.items.filter((i) => i.id !== deletedId) };
    });
  }
  if (msg.event === 'LIST_CLEARED') {
    return prev.map((l) => {
      if (l.id !== msgListId) return l;
      return { ...l, items: l.items.filter((i) => !i.isCompleted) };
    });
  }
  return prev;
}

// Keeps the shopping lists current: the open list's room joined on the app's realtime connection (its
// entry events arrive there), list events applied from their payload where they can be and otherwise one
// reload per burst (lib/realtimeReload.ts: hidden tabs wait, a reconnect reloads once), and a reload once
// entries added offline have been sent.
export function useListRealtime(
  activeListId: string | undefined,
  lists: SharedList[],
  setLists: React.Dispatch<React.SetStateAction<SharedList[]>>,
  loadLists: () => Promise<void>
) {
  const realtimeConnRef = useRef<ReturnType<typeof createRealtimeConnection> | null>(null);
  // The listeners below live longer than one render; they call the loadLists of the latest one, which
  // knows the list that is open now
  const loadListsRef = useLatestRef(loadLists);
  const reloader = useRealtimeReload(() => void loadListsRef.current());

  // Only joins the room: every message of the connection also arrives as mindsift:ws (handled below),
  // reacting here as well made each list event load the lists twice
  useEffect(() => {
    if (!activeListId) return;

    if (realtimeConnRef.current) {
      try {
        realtimeConnRef.current.close();
      } catch {}
      realtimeConnRef.current = null;
    }

    realtimeConnRef.current = createRealtimeConnection({ listId: activeListId });

    return () => {
      if (realtimeConnRef.current) {
        try {
          realtimeConnRef.current.close();
        } catch {}
        realtimeConnRef.current = null;
      }
    };
  }, [activeListId]);

  // Back online: once the outbox has sent the entries added offline, or ticks, edits and deletions made
  // offline, show the server's version (a tick somebody else had made already, or a newer change of theirs,
  // is kept there and not echoed back)
  const listsRef = useLatestRef(lists);
  useEffect(() => {
    let queuedChanges = getOutbox().filter(isListEntry).length;
    const onOutbox = () => {
      const shown = listsRef.current.some((l) => l.items.some((i) => i.id.startsWith(OFFLINE_ITEM_PREFIX)));
      const queued = new Set(pendingListItems().map((p) => p.id));
      const sent = listsRef.current.some((l) => l.items.some((i) => i.id.startsWith(OFFLINE_ITEM_PREFIX) && !queued.has(i.id)));
      const before = queuedChanges;
      queuedChanges = getOutbox().filter(isListEntry).length;
      if (shown && sent) void loadListsRef.current();
      // One reload for a whole batch sent (each sent entry is an outbox change of its own)
      else if (queuedChanges < before && !isOffline()) reloader.request(true);
    };
    window.addEventListener('mindsift:outbox-changed', onOutbox);
    return () => window.removeEventListener('mindsift:outbox-changed', onOutbox);
  }, [listsRef, loadListsRef, reloader]);

  useEffect(() => {
    const handleGlobalWs = (e: CustomEvent<WSMessage | undefined>) => {
      const msg = e.detail;
      if (!msg || !msg.event) return;
      if (!msg.event.startsWith('LIST_') && !msg.event.startsWith('ITEM_')) return;
      // Applied to the latest state (an event right after another must not undo it); whether it needs a
      // reload is decided from the lists shown
      const changes = pendingListChanges();
      setLists((prev) => listsAfterEvent(prev, msg, changes).lists);
      if (listsAfterEvent(listsRef.current, msg).reload) reloader.request();
    };
    window.addEventListener('mindsift:ws', handleGlobalWs);
    return () => window.removeEventListener('mindsift:ws', handleGlobalWs);
  }, [listsRef, setLists, reloader]);
}
