// Where the cursor belongs after a field's text was replaced from outside (undo, redo, a paste that
// stays in the field): at the end of the changed part, found from the common start and end of both texts.
// Without a change it stays where the texts start to differ, i.e. at the end.
export function caretAfterChange(before: string, after: string): number {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let end = 0;
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return after.length - end;
}

// Rendered markdown only drops syntax characters (**, `, [..](url) …), so its text is a subsequence of the raw
// text. Walking both strings in parallel maps a caret offset in the rendered text back to the raw text.
// The end of a line is ambiguous (the closing markup is not rendered, so the walk stops in front of it):
// a caret at the end of the rendered text, or in front of a line break, belongs behind the closing markup
// (`code`, **bold**, [label](url) …), not in front of it.
export function mapRenderedOffsetToRaw(raw: string, rendered: string, renderedOffset: number): number {
  if (renderedOffset >= rendered.length) return raw.length;
  let j = 0;
  for (let i = 0; i < renderedOffset && i < rendered.length; i++) {
    const idx = raw.indexOf(rendered[i], j);
    if (idx === -1) break;
    j = idx + 1;
  }
  if (rendered[renderedOffset] === '\n') {
    const nl = raw.indexOf('\n', j);
    return nl === -1 ? raw.length : nl;
  }
  return Math.min(j, raw.length);
}

/** The text position under a point on the page (caretPositionFromPoint, or caretRangeFromPoint in WebKit). */
export function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const r = document.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

/** The text position in el nearest to a point, found from the boxes of its characters: for a point the hit
 *  test does not take into el (WebKit does not look into rows with content-visibility: auto, so
 *  caretAtPoint gives the row). Lines decide before columns; null when el has no text. */
export function caretInElementAtPoint(el: Node, x: number, y: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  if (typeof range.getClientRects !== 'function') return null;
  let best: { node: Node; offset: number; dist: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    for (let i = 0; i < length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      for (const r of Array.from(range.getClientRects())) {
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        const dist = dy * 1e6 + dx;
        if (!best || dist < best.dist) best = { node, offset: x > (r.left + r.right) / 2 ? i + 1 : i, dist };
      }
    }
  }
  return best && { node: best.node, offset: best.offset };
}

/** Where a click or drop at a point lands in the raw (markdown) text shown rendered in el (a bullet's text
 *  layer, a table cell): the hit test, or for a point it does not take into el (WebKit, rows with
 *  content-visibility: auto) the nearest character of el, mapped back to raw. onlyInside: the nearest
 *  character only for a point inside el's box, else null (the caller decides between start and end).
 *  node/nodeOffset: the position in the rendered text. Null when el has no text to hit. */
export function rawOffsetAtPoint(
  el: Node,
  raw: string,
  x: number,
  y: number,
  onlyInside = false
): { offset: number; node: Node; nodeOffset: number } | null {
  let at = caretAtPoint(x, y);
  if (!at || !el.contains(at.node)) {
    at = null;
    const box = onlyInside && el instanceof Element ? el.getBoundingClientRect() : null;
    if (!box || (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) at = caretInElementAtPoint(el, x, y);
  }
  if (!at) return null;
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(at.node, at.offset);
  return { offset: mapRenderedOffsetToRaw(raw, el.textContent || '', range.toString().length), node: at.node, nodeOffset: at.offset };
}
