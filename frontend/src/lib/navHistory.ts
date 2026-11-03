// In-app back and forward: where the user is (page, open note, workspace view, zoomed bullet, on phones
// list or note, open task list and list) goes into the browser history, so the browser's back button (mouse button, Android back)
// steps back inside the app instead of leaving it. Each part reports its own piece; changes from one
// action (e.g. opening a note from a task switches page and note) become one entry. While the app follows
// a back/forward step, reports change nothing: the step itself already is the entry.

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
    if (first || replace) window.history.replaceState({ ...(window.history.state || {}), mindsiftNav: next }, '');
    else window.history.pushState({ mindsiftNav: next }, '');
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

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const place = (e.state as { mindsiftNav?: NavPlace } | null)?.mindsiftNav;
    if (!place) return;
    current = place;
    pending = null;
    restoringUntil = Date.now() + RESTORE_MS;
    listeners.forEach((fn) => fn(place));
  });
}
