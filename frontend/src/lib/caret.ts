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
export function mapRenderedOffsetToRaw(raw: string, rendered: string, renderedOffset: number): number {
  let j = 0;
  for (let i = 0; i < renderedOffset && i < rendered.length; i++) {
    const idx = raw.indexOf(rendered[i], j);
    if (idx === -1) break;
    j = idx + 1;
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
