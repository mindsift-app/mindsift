// The entries of the notification center (the bell), shared by every bell on the page (phone header and
// desktop rail are both mounted). Realtime events carry what changed, so they are applied here without a
// request: NOTIFICATION brings the new entry, NOTIFICATIONS_READ the ids read, NOTIFICATIONS_CLEARED
// empties it. The list is loaded when the first bell mounts, when a bell opens, after a reconnect and in
// the one case an event cannot be applied exactly (below).
import { useSyncExternalStore } from 'react';
import { api } from '../lib/api';
import { CenterEntry, WSMessage } from '../lib/types';
import { createRealtimeReloader } from '../lib/realtimeReload';
import { onRealtimeMessage, onRealtimeStatus } from '../lib/realtimeBus';

export interface CenterState {
  items: CenterEntry[];
  unread: number;
}

// The server answers the newest 50 (GET /notifications); the bell keeps no more
export const CENTER_LIMIT = 50;

// How a realtime event changes the bell. reload: the event cannot be applied exactly, load the list.
export function centerAfterEvent(state: CenterState, msg: WSMessage): { state: CenterState; reload: boolean } {
  if (msg.event === 'NOTIFICATION') {
    const entry = msg.payload as CenterEntry | null | undefined;
    if (!entry || typeof entry.id !== 'number') return { state, reload: true };
    // An entry with a group key (a watched task keeps one, its latest change) names the entries it replaced
    const replaced = new Set(Array.isArray(entry.replaces) ? entry.replaces : []);
    const dropped = state.items.filter((e) => e.id !== entry.id && replaced.has(e.id));
    const items = state.items.filter((e) => e.id !== entry.id && !replaced.has(e.id));
    const known = state.items.some((e) => e.id === entry.id && !e.read);
    const unread = Math.max(0, state.unread - dropped.filter((e) => !e.read).length - (known ? 1 : 0) + (entry.read ? 0 : 1));
    const stored: CenterEntry = { ...entry };
    delete stored.replaces;
    // A replaced entry beyond the newest 50 may have been unread: only the server knows the count then
    const reload = state.items.length >= CENTER_LIMIT && dropped.length < replaced.size;
    return { state: { items: [stored, ...items].slice(0, CENTER_LIMIT), unread }, reload };
  }
  if (msg.event === 'NOTIFICATIONS_READ') {
    const ids = (msg.payload as { ids?: unknown } | null | undefined)?.ids;
    // Without ids: all of them (also those beyond the newest 50)
    if (!Array.isArray(ids) || ids.length === 0) {
      if (state.unread === 0 && state.items.every((e) => e.read)) return { state, reload: false };
      return { state: { items: state.items.map((e) => (e.read ? e : { ...e, read: true })), unread: 0 }, reload: false };
    }
    const read = new Set(ids);
    const newlyRead = state.items.filter((e) => !e.read && read.has(e.id)).length;
    if (newlyRead === 0) return { state, reload: false };
    return {
      state: {
        items: state.items.map((e) => (!e.read && read.has(e.id) ? { ...e, read: true } : e)),
        unread: Math.max(0, state.unread - newlyRead),
      },
      reload: false,
    };
  }
  if (msg.event === 'NOTIFICATIONS_CLEARED') {
    if (state.items.length === 0 && state.unread === 0) return { state, reload: false };
    return { state: { items: [], unread: 0 }, reload: false };
  }
  return { state, reload: false };
}

const EMPTY: CenterState = { items: [], unread: 0 };
let state: CenterState = EMPTY;
const listeners = new Set<() => void>();
let loadSeq = 0;

const emit = () => listeners.forEach((fn) => fn());

// A change (own action, event) also drops a load on its way: its answer would not know the change yet
export function setCenter(next: CenterState | ((prev: CenterState) => CenterState)) {
  const value = typeof next === 'function' ? next(state) : next;
  if (value === state) return;
  loadSeq++;
  state = value;
  emit();
}

// A load that started before a newer one (or before a change, setCenter) is dropped
export function loadCenter(): void {
  const seq = ++loadSeq;
  api
    .getNotifications()
    .then((res) => {
      if (seq !== loadSeq) return;
      setCenter({ items: Array.isArray(res.items) ? res.items : [], unread: res.unread || 0 });
    })
    .catch(() => {});
}

const reloader = createRealtimeReloader(loadCenter);

const onMessage = (msg: WSMessage) => {
  if (!msg.event?.startsWith('NOTIFICATION')) return;
  const res = centerAfterEvent(state, msg);
  setCenter(res.state);
  // Only the bell's own person gets these events: no shared rhythm needed
  if (res.reload) reloader.request(true);
};
const onVisible = () => reloader.visible();
let unsubscribeRealtime: (() => void)[] = [];

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    unsubscribeRealtime = [onRealtimeMessage(onMessage), onRealtimeStatus((connected) => reloader.status(connected))];
    document.addEventListener('visibilitychange', onVisible);
    loadCenter();
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size > 0) return;
    // The last bell is gone (signed out, demo reset): the next one starts fresh
    unsubscribeRealtime.forEach((off) => off());
    unsubscribeRealtime = [];
    document.removeEventListener('visibilitychange', onVisible);
    reloader.cancel();
    loadSeq++;
    state = EMPTY;
  };
}

const snapshot = () => state;

export function useNotificationCenter(): CenterState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
