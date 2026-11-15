// Characters of a note title: it fits on one line of the note at its full width on a desktop and stays a
// usable file name on export. The server refuses longer new titles (collab.MaxTitleRunes); a longer title
// from before keeps working and may be edited as long as it does not grow.
export const NOTE_TITLE_MAX = 60;

/** Characters as the server counts them (code points, an emoji is one) */
export function noteTitleLength(title: string): number {
  return Array.from(title).length;
}

/** A title made from other text (a wiki link to a missing note) cut to the limit, with "…" */
export function shortNoteTitle(title: string): string {
  const chars = Array.from(title.trim());
  if (chars.length <= NOTE_TITLE_MAX) return title.trim();
  return chars.slice(0, NOTE_TITLE_MAX - 1).join('').trimEnd() + '…';
}
