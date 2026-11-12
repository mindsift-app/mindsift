import { describe, it, expect } from 'vitest';
import {
  cellAfterOutsideChange,
  deleteTableColumn,
  deleteTableRow,
  emptyTable,
  insertTableColumn,
  insertTableRow,
  isTableEmpty,
  isTableSeparator,
  isTableStart,
  parseMarkdownTable,
  pasteIntoTable,
  serializeMarkdownTable,
  setTableAlign,
  setTableCell,
  splitTableRow,
  tableLines,
  tableSummary,
} from '../markdownTable';

describe('parseMarkdownTable', () => {
  it('reads header, separator and rows', () => {
    expect(parseMarkdownTable('| Name | Wert |\n| --- | --- |\n| a | 1 |\n| b | 2 |')).toEqual({
      rows: [
        ['Name', 'Wert'],
        ['a', '1'],
        ['b', '2'],
      ],
      align: ['', ''],
    });
  });

  it('takes the outer pipes as optional and keeps the alignment', () => {
    expect(parseMarkdownTable('Name | Wert\n:--- | ---:\na | 1')).toEqual({
      rows: [
        ['Name', 'Wert'],
        ['a', '1'],
      ],
      align: ['left', 'right'],
    });
    expect(parseMarkdownTable('| x |\n| :-: |').align).toEqual(['center']);
  });

  it('fills missing cells and keeps extra ones (the widest row sets the columns)', () => {
    expect(parseMarkdownTable('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |').rows).toEqual([
      ['a', 'b', ''],
      ['1', '', ''],
      ['1', '2', '3'],
    ]);
  });

  it('reads lines without a separator as rows, the first one as header', () => {
    expect(parseMarkdownTable('a | b\nc | d').rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('gives one empty cell for empty content and skips blank lines', () => {
    expect(parseMarkdownTable('')).toEqual({ rows: [['']], align: [''] });
    expect(parseMarkdownTable('\n| a |\n\n| --- |\n| b |\n').rows).toEqual([['a'], ['b']]);
  });

  it('keeps a typed row of dashes below the separator as text', () => {
    const md = serializeMarkdownTable({ rows: [['a', 'b'], ['---', '---']], align: ['', ''] });
    expect(parseMarkdownTable(md).rows).toEqual([
      ['a', 'b'],
      ['---', '---'],
    ]);
  });
});

describe('splitTableRow', () => {
  it('reads "\\|" as a pipe inside the cell', () => {
    expect(splitTableRow('| [[Notiz#doc_1\\|Text]] | a \\| b |')).toEqual(['[[Notiz#doc_1|Text]]', 'a | b']);
  });

  it('keeps other backslashes', () => {
    expect(splitTableRow('| C:\\temp | \\*x\\* |')).toEqual(['C:\\temp', '\\*x\\*']);
  });
});

describe('serializeMarkdownTable', () => {
  it('writes header, separator and rows with escaped pipes', () => {
    expect(
      serializeMarkdownTable({
        rows: [
          ['Name', 'Link'],
          ['a|b', '[[Notiz#doc_1|Text]]'],
          ['', ''],
        ],
        align: ['', 'center'],
      })
    ).toBe('| Name | Link |\n| --- | :---: |\n| a\\|b | [[Notiz#doc_1\\|Text]] |\n|  |  |');
  });

  it('turns line breaks in a cell into spaces', () => {
    expect(serializeMarkdownTable({ rows: [['a\nb']], align: [''] })).toBe('| a b |\n| --- |');
  });

  it('gives back every text exactly (round trip)', () => {
    const texts = ['a|b', 'a\\|b', 'a\\', '\\\\|', '| x |', 'C:\\temp\\', '**fett** und `code`', '#tag @x'];
    const table = { rows: [texts, texts.map((t) => `${t}!`)], align: texts.map(() => '' as const) };
    expect(parseMarkdownTable(serializeMarkdownTable(table))).toEqual(table);
  });
});

describe('table helpers', () => {
  it('detects separators and the start of a table', () => {
    expect(isTableSeparator('| --- | :---: |')).toBe(true);
    expect(isTableSeparator('---')).toBe(true);
    expect(isTableSeparator('|  |  |')).toBe(false);
    expect(isTableSeparator('| a | b |')).toBe(false);
    expect(isTableStart(['| a | b |', '| - | - |'], 0)).toBe(true);
    // A divider below a line with a pipe is no table (the cell counts differ)
    expect(isTableStart(['a | b', '---'], 0)).toBe(false);
    expect(isTableStart(['| a |'], 0)).toBe(false);
  });

  it('creates a table with the text in the first cell', () => {
    expect(serializeMarkdownTable(emptyTable(2, 2, ' Einkauf\nliste '))).toBe('| Einkauf liste |  |\n| --- | --- |\n|  |  |');
  });

  it('inserts and deletes rows and columns', () => {
    let t = emptyTable(2, 2, 'a');
    t = insertTableRow(t, 1);
    expect(t.rows.length).toBe(3);
    t = insertTableColumn(t, 1);
    expect(t.rows[0]).toEqual(['a', '', '']);
    expect(t.align.length).toBe(3);
    t = setTableCell(t, 2, 2, 'x');
    t = deleteTableColumn(t, 0);
    expect(t.rows[2]).toEqual(['', 'x']);
    t = deleteTableRow(t, 0);
    expect(t.rows).toEqual([
      ['', ''],
      ['', 'x'],
    ]);
    // The last row and the last column stay
    expect(deleteTableRow(emptyTable(1, 1), 0).rows.length).toBe(1);
    expect(deleteTableColumn(emptyTable(1, 1), 0).align.length).toBe(1);
  });

  it('aligns a column, written in the separator row (GitHub style)', () => {
    let t = parseMarkdownTable('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    t = setTableAlign(setTableAlign(t, 1, 'center'), 2, 'right');
    const md = serializeMarkdownTable(t);
    expect(md).toBe('| a | b | c |\n| --- | :---: | ---: |\n| 1 | 2 | 3 |');
    // Round trip: read back, the alignment and every text are the same
    expect(parseMarkdownTable(md)).toEqual(t);
    expect(serializeMarkdownTable(parseMarkdownTable(md))).toBe(md);
    // Left writes no colon; a column that is left already stays as it was (also ":---")
    expect(setTableAlign(t, 1, 'left').align).toEqual(['', '', 'right']);
    const explicit = parseMarkdownTable('| a |\n| :--- |');
    expect(setTableAlign(explicit, 0, 'left')).toBe(explicit);
    expect(serializeMarkdownTable(explicit)).toBe('| a |\n| :--- |');
    // Out of range changes nothing
    expect(setTableAlign(t, 5, 'center')).toBe(t);
  });

  it('moves the alignment with its column when columns come or go', () => {
    let t = setTableAlign(setTableAlign(emptyTable(3, 2), 1, 'center'), 2, 'right');
    t = insertTableColumn(t, 1);
    expect(t.align).toEqual(['', '', 'center', 'right']);
    t = deleteTableColumn(t, 0);
    expect(t.align).toEqual(['', 'center', 'right']);
    t = pasteIntoTable(t, 0, 2, [['x', 'y']]);
    expect(t.align).toEqual(['', 'center', 'right', '']);
    // Old tables without colons stay left
    expect(parseMarkdownTable('| a | b |\n| --- | --- |').align).toEqual(['', '']);
  });

  it('pastes a block of cells, growing the table', () => {
    const t = pasteIntoTable(emptyTable(2, 2, 'a'), 1, 1, [
      ['x', 'y'],
      ['z'],
    ]);
    expect(t.rows).toEqual([
      ['a', '', ''],
      ['', 'x', 'y'],
      ['', 'z', ''],
    ]);
  });

  it('knows empty tables, line modes and a summary', () => {
    expect(isTableEmpty(emptyTable(2, 2))).toBe(true);
    expect(isTableEmpty(emptyTable(2, 2, 'a'))).toBe(false);
    expect(tableLines('grid')).toBe('grid');
    expect(tableLines('header')).toBe('header');
    expect(tableLines('yaml')).toBe('');
    expect(tableLines(undefined)).toBe('');
    expect(tableSummary('| Name | | Wert |\n| --- | --- | --- |\n| a | b | c |')).toBe('Name · Wert');
  });
});

describe('cellAfterOutsideChange', () => {
  const t = (...rows: string[]) => parseMarkdownTable(rows.join('\n'));
  const before = t('| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |', '| 5 | 6 |');

  it('keeps the cell when its row stays', () => {
    expect(cellAfterOutsideChange(before, t('| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'), 1, 1)).toEqual({ row: 1, col: 1 });
  });
  it('goes to the row above when undo takes away the row with the cursor', () => {
    // The last row went
    expect(cellAfterOutsideChange(before, t('| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'), 3, 0)).toEqual({ row: 2, col: 0 });
    // A row in the middle went: above it, not into the row that moved up
    expect(cellAfterOutsideChange(before, t('| A | B |', '| --- | --- |', '| 1 | 2 |', '| 5 | 6 |'), 2, 1)).toEqual({ row: 1, col: 1 });
  });
  it('goes below when no row is left above', () => {
    expect(cellAfterOutsideChange(before, t('| 1 | 2 |', '| --- | --- |', '| 3 | 4 |', '| 5 | 6 |'), 0, 0)).toEqual({ row: 0, col: 0 });
  });
  it('follows its own row when a row above it went', () => {
    expect(cellAfterOutsideChange(before, t('| A | B |', '| --- | --- |', '| 3 | 4 |', '| 5 | 6 |'), 3, 1)).toEqual({ row: 2, col: 1 });
  });
  it('moves to the last column when its column went', () => {
    expect(cellAfterOutsideChange(before, t('| A |', '| --- |', '| 1 |', '| 3 |', '| 5 |'), 2, 1)).toEqual({ row: 2, col: 0 });
  });
});
