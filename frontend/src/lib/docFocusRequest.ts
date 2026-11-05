// A note opened from the search (Strg+K) gets the cursor in its first bullet, so typing and the arrow keys
// work at once. The search leaves the request here; the editor of that note takes it once it has loaded
// (or at once, when the note was already open).
const EVENT = 'mindsift:doc-focus';
const MAX_AGE_MS = 5000;
let pending: { docId: string; at: number } | null = null;

export function requestDocFocus(docId: string) {
  pending = { docId, at: Date.now() };
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function takeDocFocus(docId: string): boolean {
  if (!pending || pending.docId !== docId || Date.now() - pending.at > MAX_AGE_MS) return false;
  pending = null;
  return true;
}

export function onDocFocusRequest(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
