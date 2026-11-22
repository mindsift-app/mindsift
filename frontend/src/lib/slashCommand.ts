// The slash menu of a bullet: where a typed "/" opens it, which commands fit the text around it, and what
// is left of the text once the typed "/query" is gone. Works at any cursor position, not only at the end.

export interface SlashQuery {
  /** What follows the "/" up to the cursor ("code", "code py", "" right after the slash) */
  query: string;
  /** Position of the "/" in the text */
  slashStart: number;
}

/**
 * The slash query ending at the cursor, or null. The "/" counts at the start of the bullet or after
 * whitespace only, so addresses (https://…) and units (km/h) open no menu.
 */
export function matchSlashQuery(text: string, cursor: number): SlashQuery | null {
  const m = text.slice(0, cursor).match(/(^|\s)\/(code\s+[a-z0-9_+#.-]{0,40}|[a-z0-9]*)$/i);
  if (!m) return null;
  return { query: m[2], slashStart: m.index! + m[1].length };
}

/**
 * The text without the typed "/query" (from `start` to `end`), and where the cursor goes. Only the
 * whitespace where the command stood is tidied (no double space, nothing left over at the start or end of
 * the bullet); the rest of the text stays exactly as it was.
 */
export function removeSlashQuery(text: string, start: number, end: number): { before: string; after: string; text: string; caret: number } {
  const rawBefore = text.slice(0, start);
  const rawAfter = text.slice(end);
  let before = rawBefore;
  let after = rawAfter;
  if (before.trim() === '') {
    before = '';
    after = after.replace(/^\s+/, '');
  } else if (after.trim() === '') {
    before = before.replace(/\s+$/, '');
    after = '';
  } else if (/\s$/.test(before) && /^[ \t]/.test(after)) {
    after = after.replace(/^[ \t]+/, '');
  } else if (/[ \t]$/.test(before) && /^\n/.test(after)) {
    before = before.replace(/[ \t]+$/, '');
  }
  return { before: rawBefore, after: rawAfter, text: before + after, caret: before.length };
}

// Commands that make the bullet into something else entirely (no text of its own): only in an empty one
const NEEDS_EMPTY_BULLET = new Set(['divider', 'image', 'audio', 'drawing']);

/**
 * Whether a command fits the bullet's text around the slash (`rest`: the text without the "/query").
 * Type changes (headings, to-do, quote boxes, code, table …) take the text along, wherever the slash was
 * typed; dividers and media only go into an empty bullet; extracting needs text to move.
 */
export function slashCommandFitsText(type: string, rest: string): boolean {
  const empty = rest.trim() === '';
  if (NEEDS_EMPTY_BULLET.has(type)) return empty;
  if (type === 'extract') return !empty;
  return true;
}
