// Rows of a long note out of view skip layout and paint (content-visibility: auto, .outline-row in index.css).
// WebKit (Safari, WebKitGTK) mishandles a row on screen that goes back to auto, after the cursor left it or when
// the note opens: it takes the row for skipped until something makes it draw again, so its hit test stops at
// the row (a click into the text put the cursor at the end, its buttons did nothing). Such rows keep
// data-outline-near, which keeps them rendered, until they are more than a screen away from the view; the
// rows in view when the note opens and every row that had the cursor get it. Only these few rows are watched,
// so scrolling a long note costs no more than before. The distance is measured in the scroll container of
// the note or journal (data-outline-scroll), elsewhere in the window, where a row loses it once out of view.
// The observer's first report can take most of a second in WebKit after a page load, and until then the rows
// on screen were skipped (a table row measured one line, a click landed on the wrong bullet): rows added
// together are measured once right after they mount (OutlinerBlock registers them in a layout effect, so this
// is before the first paint), all positions read before any row is marked, so the layout runs once for the
// whole note.

type Shared = { observer: IntersectionObserver; count: number };
const observers = new Map<Element | null, Shared>();
const sharedOf = new WeakMap<Element, Shared>();
// Rows registered since the last measuring, by scroll container
const unmeasured = new Map<Element | null, Element[]>();

// Marks the rows registered just now that are within a screen of the view, as the observer would. They come
// in document order (React runs the rows' layout effects in that order), so they lie top to bottom: the first
// one reaching into that range is found by halving and the following ones are read only while they start
// within it. WebKit takes a while for the position of every skipped row (about 1.5 s for all rows of a note
// of 5,000 bullets), a few dozen positions cost nothing. Sorting them first cost Chromium 0.5 s there
// (compareDocumentPosition walks the siblings). A row out of order is only marked late, by the observer.
function markNearRows(): void {
  const near: Element[] = [];
  for (const [root, batch] of unmeasured) {
    const rows = batch.filter((row) => row.isConnected && sharedOf.has(row));
    const view = root ? root.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const margin = view.bottom - view.top;
    const top = view.top - margin;
    const bottom = view.bottom + margin;
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].getBoundingClientRect().bottom < top) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (r.top > bottom) break;
      if (r.height > 0) near.push(rows[i]);
    }
  }
  unmeasured.clear();
  for (const row of near) row.setAttribute('data-outline-near', '');
}

/** Registers the row el (the rows in view get data-outline-near) until the returned function is called.
 *  Without IntersectionObserver nothing happens. */
export function observeOutlineRow(el: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const root = el.closest('[data-outline-scroll]');
  let shared = observers.get(root);
  if (!shared) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-outline-near', '');
          } else {
            entry.target.removeAttribute('data-outline-near');
            observer.unobserve(entry.target);
          }
        }
      },
      { root, rootMargin: '100% 0px' }
    );
    shared = { observer, count: 0 };
    observers.set(root, shared);
  }
  const current = shared;
  current.count++;
  sharedOf.set(el, current);
  current.observer.observe(el);
  const rows = unmeasured.get(root);
  if (rows) rows.push(el);
  else {
    if (unmeasured.size === 0) queueMicrotask(markNearRows);
    unmeasured.set(root, [el]);
  }
  return () => {
    current.observer.unobserve(el);
    sharedOf.delete(el);
    if (--current.count === 0) {
      current.observer.disconnect();
      observers.delete(root);
    }
  };
}

/** The row el had the cursor or a menu: it stays rendered until it is a screen away from the view. */
export function keepOutlineRowNear(el: Element): void {
  const shared = sharedOf.get(el);
  if (!shared || el.hasAttribute('data-outline-near')) return;
  el.setAttribute('data-outline-near', '');
  shared.observer.observe(el);
}
