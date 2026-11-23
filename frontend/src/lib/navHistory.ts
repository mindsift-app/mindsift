// In-app back and forward: where the user is (page, open note, workspace view, zoomed bullet, on phones
// list or note, open task list and list) goes into the browser history, so the browser's back button (mouse button, Android back)
// steps back inside the app instead of leaving it. Each part reports its own piece; changes from one
// action (e.g. opening a note from a task switches page and note) become one entry. While the app follows
// a back/forward step, reports change nothing: the step itself already is the entry. While a dictation
// would be lost (lib/leaveGuard.ts), a step is taken back at once and only taken again once the person
// chose to leave anyway.
import { confirmLeave, leaveHeld } from './leaveGuard';

export interface NavPlace {
  tab: string;
  docId?: string | null;
  view?: string | null; // workspace view: editor, todos, tags, trash, journal …
  zoom?: string | null; // bullet the open note is zoomed into
  detail?: boolean; // phones: the note (true) or the list of notes (false)
  taskList?: string | null; // open task list on the tasks page ("all" for Alle Aufgaben)
  shopList?: string | null; // open list on the lists page
}

const RESTORE_MS = 600; // the app needs a moment to follow a step (views mount, notes load)

let current: NavPlace | null = null;
let pending: Partial<NavPlace> | null = null;
let pendingReplace = false;
let restoringUntil = 0;
// Position of the current entry in the session history, kept in each entry the app makes (mindsiftIdx), so
// a step back or forward can be measured and taken back with history.go
const entryIndex = (state: unknown): number | null => {
  const idx = (state as { mindsiftIdx?: unknown } | null)?.mindsiftIdx;
  return typeof idx === 'number' ? idx : null;
};
let index = typeof window !== 'undefined' ? (entryIndex(window.history.state) ?? 0) : 0;
const listeners = new Set<(place: NavPlace) => void>();

const same = (a: NavPlace, b: NavPlace) =>
  a.tab === b.tab &&
  (a.docId ?? null) === (b.docId ?? null) &&
  (a.view ?? null) === (b.view ?? null) &&
  (a.zoom ?? null) === (b.zoom ?? null) &&
  Boolean(a.detail) === Boolean(b.detail) &&
  (a.taskList ?? null) === (b.taskList ?? null) &&
  (a.shopList ?? null) === (b.shopList ?? null);

function flush() {
  if (!pending) return;
  const part = pending;
  const replace = pendingReplace;
  pending = null;
  pendingReplace = false;
  if (Date.now() < restoringUntil) return;
  const next: NavPlace = { ...(current || { tab: '' }), ...part };
  if (current && same(current, next)) return;
  const first = !current;
  current = next;
  try {
    if (first || replace) window.history.replaceState({ ...(window.history.state || {}), mindsiftNav: next, mindsiftIdx: index }, '');
    else {
      window.history.pushState({ mindsiftNav: next, mindsiftIdx: index + 1 }, '');
      index++;
    }
  } catch {
    // history unavailable (tests, sandboxed frames): back simply leaves the app as before
  }
}

/**
 * Reports a change of the user's place; changes in the same tick become one history entry. replace: the
 * app chose it by itself (e.g. the first note after loading), so it updates the current entry instead.
 */
export function reportNav(part: Partial<NavPlace>, options: { replace?: boolean } = {}) {
  pending = { ...(pending || {}), ...part };
  if (options.replace) pendingReplace = true;
  queueMicrotask(flush);
}

/** The place the app is following right now (back/forward), for views that mount during the step. */
export function restoringNavPlace(): NavPlace | null {
  return Date.now() < restoringUntil ? current : null;
}

/** Called with the place to go to on back/forward. */
export function onNavStep(fn: (place: NavPlace) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Dialogs on top of a place (e.g. the task dialog): opening one adds a history entry, so back closes the
// dialog first instead of leaving the page. onBack returns false to stay open (e.g. to ask about unsaved
// changes); the entry is then added again. Closed another way, the dialog takes its entry back.
interface ModalLayer {
  id: number;
  onBack: () => boolean;
}
const modals: ModalLayer[] = [];
let nextModalId = 1;
let ignorePops = 0;

export function pushModal(onBack: () => boolean): () => void {
  const layer: ModalLayer = { id: nextModalId++, onBack };
  modals.push(layer);
  try {
    window.history.pushState({ ...(window.history.state || {}), mindsiftModal: layer.id, mindsiftIdx: index + 1 }, '');
    index++;
  } catch {
    // history unavailable: back keeps its old behaviour
  }
  return () => {
    const i = modals.indexOf(layer);
    if (i < 0) return; // already closed by back
    modals.splice(i, 1);
    if ((window.history.state as { mindsiftModal?: number } | null)?.mindsiftModal === layer.id) {
      ignorePops++;
      window.history.back();
    }
  };
}

// The next step is the one the person confirmed after it was taken back: it goes through unasked
let passGuard = false;

function handlePop(e: PopStateEvent) {
  const from = index;
  const to = entryIndex(e.state);
  if (to !== null) index = to;
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = modals[modals.length - 1];
  const place = (e.state as { mindsiftNav?: NavPlace } | null)?.mindsiftNav;
  if ((top || place) && leaveHeld() && !passGuard) {
    // A dictation would be lost: back to where the person was, then ask
    const delta = to === null ? null : to - from;
    try {
      if (top) window.history.pushState({ ...(window.history.state || {}), mindsiftModal: top.id, mindsiftIdx: index + 1 }, '');
      else if (delta) {
        ignorePops++;
        window.history.go(-delta);
      }
    } catch {}
    if (top) index++;
    else if (delta) index = from;
    void confirmLeave({ close: Boolean(top) }).then((ok) => {
      if (!ok) return;
      passGuard = true;
      // Released again if the step does not come (e.g. history unavailable)
      window.setTimeout(() => (passGuard = false), 1000);
      if (top) window.history.back();
      else if (delta) window.history.go(delta);
      else {
        passGuard = false;
        follow(place);
      }
    });
    return;
  }
  passGuard = false;
  if (top) {
    // Back while a dialog is open: it handles the step, the page stays where it is
    if (top.onBack()) {
      modals.pop();
    } else {
      try {
        window.history.pushState({ ...(window.history.state || {}), mindsiftModal: top.id, mindsiftIdx: index + 1 }, '');
        index++;
      } catch {}
    }
    return;
  }
  follow(place);
}

function follow(place: NavPlace | undefined) {
  if (!place) return;
  current = place;
  pending = null;
  restoringUntil = Date.now() + RESTORE_MS;
  listeners.forEach((fn) => fn(place));
}

if (typeof window !== 'undefined') window.addEventListener('popstate', handlePop);
