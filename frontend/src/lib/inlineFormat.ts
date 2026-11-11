// Ctrl/Cmd+B and Ctrl/Cmd+I in a text field (a bullet, a table cell): wraps the selection in ** or *, or
// takes them away when the selection is wrapped already (marks inside or right around it); without a
// selection a pair goes in at the cursor, with the cursor between. Returns the new text and selection.
export function toggleInlineFormat(
  text: string,
  start: number,
  end: number,
  bold: boolean
): { value: string; start: number; end: number } {
  const delim = bold ? '**' : '*';
  if (start >= end) {
    const pair = delim + delim;
    return { value: text.slice(0, start) + pair + text.slice(start), start: start + delim.length, end: start + delim.length };
  }

  const selected = text.slice(start, end);

  if (bold) {
    const isOutside = start >= 2 && end + 2 <= text.length && text.slice(start - 2, start) === '**' && text.slice(end, end + 2) === '**';
    const isInside = selected.length >= 4 && selected.startsWith('**') && selected.endsWith('**');
    if (isOutside) {
      return { value: text.slice(0, start - 2) + selected + text.slice(end + 2), start: start - 2, end: end - 2 };
    }
    if (isInside) {
      const unwrapped = selected.slice(2, -2);
      return { value: text.slice(0, start) + unwrapped + text.slice(end), start, end: start + unwrapped.length };
    }
    return { value: text.slice(0, start) + '**' + selected + '**' + text.slice(end), start: start + 2, end: end + 2 };
  }

  const isOutside =
    start >= 1 &&
    end + 1 <= text.length &&
    text[start - 1] === '*' &&
    text[end] === '*' &&
    (start < 2 || text[start - 2] !== '*') &&
    (end + 1 >= text.length || text[end + 1] !== '*');
  const isInside =
    selected.length >= 2 &&
    selected.startsWith('*') &&
    selected.endsWith('*') &&
    (!selected.startsWith('**') || !selected.endsWith('**') || selected.length < 4);
  if (isOutside) {
    return { value: text.slice(0, start - 1) + selected + text.slice(end + 1), start: start - 1, end: end - 1 };
  }
  if (isInside) {
    const unwrapped = selected.slice(1, -1);
    return { value: text.slice(0, start) + unwrapped + text.slice(end), start, end: start + unwrapped.length };
  }
  return { value: text.slice(0, start) + '*' + selected + '*' + text.slice(end), start: start + 1, end: end + 1 };
}
