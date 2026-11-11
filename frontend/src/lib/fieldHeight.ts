// Text fields that grow with their text (the bullets of a note). Their height depends on their width, so
// they are measured again when it changes. One ResizeObserver for all of them: when the note gets wider or
// narrower (window, focus mode, sidebar) every field is measured in one pass, all heights reset first and
// read after, instead of one forced layout per field.

const MIN_HEIGHT = 22;

/** Sets the field's height to its text. A field with data-own-height (code editor) sizes itself. */
export function fitFieldHeight(el: HTMLTextAreaElement) {
  if (el.dataset.ownHeight) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(MIN_HEIGHT, el.scrollHeight)}px`;
}

const lastWidth = new WeakMap<Element, number>();
let observer: ResizeObserver | null = null;

function refit(entries: ResizeObserverEntry[]) {
  const fields = entries
    .map((e) => e.target as HTMLTextAreaElement)
    .filter((el) => {
      const width = el.clientWidth;
      if (width === lastWidth.get(el)) return false;
      lastWidth.set(el, width);
      return !el.dataset.ownHeight;
    });
  fields.forEach((el) => (el.style.height = 'auto'));
  const heights = fields.map((el) => el.scrollHeight);
  fields.forEach((el, i) => (el.style.height = `${Math.max(MIN_HEIGHT, heights[i])}px`));
}

/** Fits the field again whenever its width changes; returns the function that stops it. */
export function refitOnWidthChange(el: HTMLTextAreaElement): () => void {
  if (typeof ResizeObserver === 'undefined') {
    const fit = () => fitFieldHeight(el);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }
  observer ??= new ResizeObserver(refit);
  lastWidth.set(el, el.clientWidth);
  observer.observe(el);
  return () => {
    observer?.unobserve(el);
    lastWidth.delete(el);
  };
}
