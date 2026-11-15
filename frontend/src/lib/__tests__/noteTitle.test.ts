import { describe, it, expect } from 'vitest';
import { NOTE_TITLE_MAX, noteTitleLength, shortNoteTitle } from '../noteTitle';

describe('note title limit', () => {
  it('counts characters like the server (an emoji is one)', () => {
    expect(noteTitleLength('Grüße 🚀')).toBe(7);
  });

  it('cuts a longer title with an ellipsis to the limit, keeps a short one', () => {
    expect(shortNoteTitle('  Besprechung  ')).toBe('Besprechung');
    const long = 'Besprechung mit der Hausverwaltung über die Nebenkostenabrechnung 2026';
    const cut = shortNoteTitle(long);
    expect(noteTitleLength(cut)).toBeLessThanOrEqual(NOTE_TITLE_MAX);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });
});
