import { describe, expect, it } from 'vitest';
import { guideCounts } from '../outlineGuides';

const row = (id: string, level: number, content: string, type = 'bullet', hasChildren = false) => ({ block: { id, level, content, type }, hasChildren });

describe('guideCounts (indent guide lines per row)', () => {
  it('gives empty rows no lines of their own at the end of a group', () => {
    const rows = [row('a', 0, 'Projekt'), row('b', 1, 'Plan'), row('c', 2, 'Schritt'), row('d', 2, ''), row('e', 0, 'Nächstes')];
    expect(guideCounts(rows, 0)).toEqual([0, 1, 2, 0, 0]);
  });

  it('keeps the lines through an empty row in the middle of a list', () => {
    const rows = [row('a', 0, 'Projekt'), row('b', 1, 'eins'), row('c', 1, ''), row('d', 1, 'zwei')];
    expect(guideCounts(rows, 0)).toEqual([0, 1, 1, 1]);
  });

  it('ends the lines at the level that goes on, also over several empty rows', () => {
    const rows = [row('a', 1, 'tief'), row('b', 2, 'tiefer'), row('c', 2, ''), row('d', 2, ''), row('e', 1, 'weiter')];
    expect(guideCounts(rows, 0)).toEqual([1, 2, 1, 1, 1]);
  });

  it('keeps the lines of the row being edited, of to-dos and of rows with children', () => {
    const rows = [row('a', 1, ''), row('b', 1, '', 'todo'), row('c', 1, '', 'bullet', true), row('d', 2, 'Kind')];
    expect(guideCounts(rows, 0)).toEqual([1, 1, 1, 2]);
    expect(guideCounts([row('a', 2, '')], 0, 'a')).toEqual([2]);
    expect(guideCounts([row('a', 2, '')], 0)).toEqual([0]);
  });

  it('counts from the zoomed level', () => {
    expect(guideCounts([row('a', 3, 'x'), row('b', 4, 'y')], 2)).toEqual([1, 2]);
  });
});
