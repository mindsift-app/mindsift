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
