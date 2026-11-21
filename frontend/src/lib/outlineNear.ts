// Rows of a long note out of view skip layout and paint (content-visibility: auto, .outline-row in index.css).
// WebKit (Safari, WebKitGTK) mishandles a row on screen that goes back to auto, after the cursor left it or when
// the note opens: it takes the row for skipped until something makes it draw again, so its hit test stops at
// the row (a click into the text put the cursor at the end, its buttons did nothing). Such rows keep
// data-outline-near, which keeps them rendered, until they are more than a screen away from the view; the
// rows in view when the note opens and every row that had the cursor get it. Only these few rows are watched,
// so scrolling a long note costs no more than before. The distance is measured in the scroll container of
// the note or journal (data-outline-scroll), elsewhere in the window, where a row loses it once out of view.

type Shared = { observer: IntersectionObserver; count: number };
const observers = new Map<Element | null, Shared>();
const sharedOf = new WeakMap<Element, Shared>();

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
