import { describe, it, expect } from 'vitest';
import {
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
