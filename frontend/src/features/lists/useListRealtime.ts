import React, { useEffect, useRef } from 'react';
import { ListItem, SharedList, WSMessage } from '../../lib/types';
import { createRealtimeConnection } from '../../lib/api';
import { OFFLINE_ITEM_PREFIX, pendingListItems } from '../../lib/offline';
import { deduplicateItems } from './listItems';

// Events after which the lists are loaded again (new, deleted, shared or reordered lists)
export const LIST_RELOAD_EVENTS = ['LIST_CREATED', 'LIST_DELETED', 'LIST_SHARED', 'LIST_UNSHARED', 'ITEM_REORDERED', 'LIST_UPDATED'];

// How an entry event of a list's connection changes the lists shown
export function listsAfterMessage(prev: SharedList[], msg: WSMessage): SharedList[] {
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
    return prev.map((l) => {
      if (l.id !== msgListId) return l;
      return {
        ...l,
        items: l.items.map((i) => (i.id === updatedItem.id ? updatedItem : i)),
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

// Keeps the shopping lists current: a realtime connection for the open list, a reload once entries
// added offline have been sent, and a reload on list events from the app's global connection
export function useListRealtime(
  activeListId: string | undefined,
  lists: SharedList[],
  setLists: React.Dispatch<React.SetStateAction<SharedList[]>>,
  loadLists: () => Promise<void>
) {
  const realtimeConnRef = useRef<ReturnType<typeof createRealtimeConnection> | null>(null);
  // The listeners below live longer than one render; they call the loadLists of the latest one, which
  // knows the list that is open now
  const loadListsRef = useRef(loadLists);
  loadListsRef.current = loadLists;

  useEffect(() => {
    if (!activeListId) return;

    if (realtimeConnRef.current) {
      try {
        realtimeConnRef.current.close();
      } catch {}
      realtimeConnRef.current = null;
    }

    const conn = createRealtimeConnection({
      listId: activeListId,
      onMessage: (msg: WSMessage) => {
        if (LIST_RELOAD_EVENTS.includes(msg.event)) {
          void loadListsRef.current();
          return;
        }
        setLists((prev) => listsAfterMessage(prev, msg));
      },
    });

    realtimeConnRef.current = conn;

    return () => {
      if (realtimeConnRef.current) {
        try {
          realtimeConnRef.current.close();
        } catch {}
        realtimeConnRef.current = null;
      }
    };
  }, [activeListId, setLists]);

  // Back online: once the outbox has sent the entries added offline, show the server's version
  const listsRef = useRef(lists);
  listsRef.current = lists;
  useEffect(() => {
    const onOutbox = () => {
      const shown = listsRef.current.some((l) => l.items.some((i) => i.id.startsWith(OFFLINE_ITEM_PREFIX)));
      const queued = new Set(pendingListItems().map((p) => p.id));
      const sent = listsRef.current.some((l) => l.items.some((i) => i.id.startsWith(OFFLINE_ITEM_PREFIX) && !queued.has(i.id)));
      if (shown && sent) void loadListsRef.current();
    };
    window.addEventListener('mindsift:outbox-changed', onOutbox);
    return () => window.removeEventListener('mindsift:outbox-changed', onOutbox);
  }, []);

  useEffect(() => {
    const handleGlobalWs = (e: CustomEvent<WSMessage | undefined>) => {
      const msg = e.detail;
      if (!msg) return;
      if (LIST_RELOAD_EVENTS.includes(msg.event)) {
        void loadListsRef.current();
      }
    };
    window.addEventListener('mindsift:ws', handleGlobalWs);
    return () => window.removeEventListener('mindsift:ws', handleGlobalWs);
  }, []);
}
