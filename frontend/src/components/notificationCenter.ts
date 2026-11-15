// The entries of the notification center (the bell), shared by every bell on the page (phone header and
// desktop rail are both mounted). Realtime events carry what changed, so they are applied here without a
// request: NOTIFICATION brings the new entry, NOTIFICATIONS_READ the ids read, NOTIFICATIONS_CLEARED
// empties it. The list is loaded when the first bell mounts, when a bell opens, after a reconnect and in
// the one case an event cannot be applied exactly (below).
import { useSyncExternalStore } from 'react';
import { api } from '../lib/api';
import { CenterEntry, WSMessage } from '../lib/types';
import { createRealtimeReloader } from '../lib/realtimeReload';

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
    // A watched task keeps one entry, its latest change: the server replaced the earlier ones of the task
    // (group "watched:<task>"). Without a target (the task was deleted) the earlier entry is not known here.
    let reload = false;
    let dropped: CenterEntry[] = [];
    let items = state.items.filter((e) => e.id !== entry.id);
    if (entry.kind === 'watched') {
      if (entry.targetType === 'task' && entry.targetId) {
        dropped = items.filter((e) => e.kind === 'watched' && e.targetType === 'task' && e.targetId === entry.targetId);
        items = items.filter((e) => !dropped.includes(e));
      } else {
        reload = true;
      }
    }
    const known = state.items.some((e) => e.id === entry.id && !e.read);
    const unread = Math.max(0, state.unread - dropped.filter((e) => !e.read).length - (known ? 1 : 0) + (entry.read ? 0 : 1));
    return { state: { items: [entry, ...items].slice(0, CENTER_LIMIT), unread }, reload };
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

const onWs = (e: Event) => {
  const msg = (e as CustomEvent<WSMessage | undefined>).detail;
  if (!msg || !msg.event?.startsWith('NOTIFICATION')) return;
  const res = centerAfterEvent(state, msg);
  setCenter(res.state);
  // Only the bell's own person gets these events: no shared rhythm needed
  if (res.reload) reloader.request(true);
};
const onVisible = () => reloader.visible();
const onStatus = (e: WindowEventMap['mindsift:ws:status']) => {
  if (e.detail) reloader.status(e.detail.connected);
};

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    window.addEventListener('mindsift:ws', onWs);
    window.addEventListener('mindsift:ws:status', onStatus);
    document.addEventListener('visibilitychange', onVisible);
    loadCenter();
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size > 0) return;
    // The last bell is gone (signed out, demo reset): the next one starts fresh
    window.removeEventListener('mindsift:ws', onWs);
    window.removeEventListener('mindsift:ws:status', onStatus);
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
