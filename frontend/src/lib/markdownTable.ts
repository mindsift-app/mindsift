// Tables in notes (block type 'table'). The block's content is a Markdown table in GitHub's style, so it
// reads as a table everywhere else too (copying, the Markdown export, AI agents):
//   | Name | Wert |
//   | --- | --- |
//   | a | 1 |
// The first row is the header. A "|" in a cell is written "\|" (as GitHub and Obsidian do, also inside
// [[Link|Text]]); nothing else is escaped: reading takes away only the backslash right in front of a pipe,
// so every text comes back exactly. Cells hold no line breaks (Enter adds a row).
// The block's `lang` carries the line mode (see tableLines).

export type TableAlign = '' | 'left' | 'center' | 'right';

export interface TableData {
  /** rows[0] is the header; every row has the same number of cells */
  rows: string[][];
  /** Alignment per column from the separator row (":---", ":---:", "---:"), kept when written back */
  align: TableAlign[];
}

/** Line modes, stored in the block's `lang`: '' inner lines fading out towards the edge (default),
 *  'grid' every line and a frame, 'header' the line below the header and the column lines */
export type TableLines = '' | 'grid' | 'header';
export const TABLE_LINE_MODES: TableLines[] = ['', 'grid', 'header'];

export function tableLines(lang?: string): TableLines {
  return lang === 'grid' || lang === 'header' ? lang : '';
}

const SEPARATOR_CELL = /^:?-+:?$/;

/** The cells of one table line: outer pipes are optional, "\|" is a pipe inside a cell, cells are trimmed. */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** A separator row: every cell dashes, optionally with colons for the alignment ("| --- | :-: |"). */
export function isTableSeparator(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => SEPARATOR_CELL.test(c));
}

/** Whether a Markdown table starts at lines[i]: a line with a pipe, then a separator with pipes and as many
 *  cells (a plain "---" below a line is a divider or heading, not a table). */
export function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const sep = lines[i + 1];
  if (head === undefined || sep === undefined || !head.includes('|') || !sep.includes('|') || !isTableSeparator(sep)) return false;
  return splitTableRow(head).length === splitTableRow(sep).length;
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : left ? 'left' : right ? 'right' : '';
}

/** Reads a table leniently: without a separator row every line is a row, missing cells are added (the
 *  widest row sets the number of columns, so no text is lost). Empty content gives one empty cell. */
export function parseMarkdownTable(md: string): TableData {
  const lines = (md || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [['']], align: [''] };
  let align: TableAlign[] = [];
  let body = lines.slice(1);
  // Only the line right below the header is the separator; a later row of dashes is text someone typed
  if (body.length > 0 && isTableSeparator(body[0])) {
    align = splitTableRow(body[0]).map(alignOf);
    body = body.slice(1);
  }
  const rows = [lines[0], ...body].map(splitTableRow);
  const cols = Math.max(1, align.length, ...rows.map((r) => r.length));
  return {
    rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')),
    align: Array.from({ length: cols }, (_, i) => align[i] ?? ''),
  };
}

const SEPARATOR: Record<TableAlign, string> = { '': '---', left: ':---', center: ':---:', right: '---:' };

/** Writes the table as Markdown (header, separator, rows); pipes in cells become "\|". */
export function serializeMarkdownTable(table: TableData): string {
  const cols = Math.max(1, table.align.length, ...table.rows.map((r) => r.length));
  const cell = (s: string | undefined) => (s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  const line = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cell(cells[i])).join(' | ')} |`;
  const separator = `| ${Array.from({ length: cols }, (_, i) => SEPARATOR[table.align[i] ?? '']).join(' | ')} |`;
  return [line(table.rows[0] ?? []), separator, ...table.rows.slice(1).map(line)].join('\n');
}

/** A new table of the given size; text goes into the first cell. */
export function emptyTable(cols: number, rows: number, firstCell = ''): TableData {
  const data: TableData = {
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
    align: Array.from({ length: cols }, () => '' as TableAlign),
  };
  data.rows[0][0] = firstCell.replace(/\s*\r?\n\s*/g, ' ').trim();
  return data;
}

export function setTableCell(table: TableData, row: number, col: number, text: string): TableData {
  return { ...table, rows: table.rows.map((r, i) => (i === row ? r.map((c, j) => (j === col ? text : c)) : r)) };
}

/** A row of empty cells at index `at` (0 = above the header: it becomes the new header). */
export function insertTableRow(table: TableData, at: number): TableData {
  const cols = table.align.length;
  const rows = [...table.rows];
  rows.splice(at, 0, Array.from({ length: cols }, () => ''));
  return { ...table, rows };
}

export function deleteTableRow(table: TableData, at: number): TableData {
  if (table.rows.length <= 1) return table;
  return { ...table, rows: table.rows.filter((_, i) => i !== at) };
}

/** A column of empty cells at index `at`. */
export function insertTableColumn(table: TableData, at: number): TableData {
  const splice = <T,>(arr: T[], v: T) => {
    const out = [...arr];
    out.splice(at, 0, v);
    return out;
  };
  return { rows: table.rows.map((r) => splice(r, '')), align: splice(table.align, '' as TableAlign) };
}

export function deleteTableColumn(table: TableData, at: number): TableData {
  if (table.align.length <= 1) return table;
  return { rows: table.rows.map((r) => r.filter((_, i) => i !== at)), align: table.align.filter((_, i) => i !== at) };
}

/** Puts a block of cells (pasted lines × tab-separated cells) into the table from (row, col) on, adding
 *  rows and columns where it runs over. */
export function pasteIntoTable(table: TableData, row: number, col: number, grid: string[][]): TableData {
  let out = table;
  const width = Math.max(...grid.map((r) => r.length));
  while (out.align.length < col + width) out = insertTableColumn(out, out.align.length);
  while (out.rows.length < row + grid.length) out = insertTableRow(out, out.rows.length);
  grid.forEach((cells, i) => cells.forEach((text, j) => (out = setTableCell(out, row + i, col + j, text.trim()))));
  return out;
}

/** Where the cursor in cell (row, col) goes when new content from outside (undo, another person) replaced
 *  `before` with `after`: its own row when rows above it went, else the nearest row above the rows that went
 *  (below them when there is none above), in its column or the last one. Null when no cell is left (the
 *  cursor leaves the table upwards); the same cell when nothing it stood in went away. */
export function cellAfterOutsideChange(
  before: TableData,
  after: TableData,
  row: number,
  col: number
): { row: number; col: number } | null {
  const rows = after.rows.length;
  const cols = after.align.length;
  if (rows === 0 || cols === 0) return null;
  let r = row;
  const removed = before.rows.length - rows;
  if (removed > 0) {
    // The rows that went start at the first row that differs (rows above them are the same)
    let first = 0;
    while (first < rows && before.rows[first].join('\u0000') === after.rows[first].join('\u0000')) first++;
    if (row >= first + removed) r = row - removed;
    else if (row >= first) r = first > 0 ? first - 1 : first;
  }
  return { row: Math.min(r, rows - 1), col: Math.min(col, cols - 1) };
}

export function isTableEmpty(table: TableData): boolean {
  return table.rows.every((r) => r.every((c) => c.trim() === ''));
}

/** A short plain-text line for the table (zoom title, breadcrumbs): its header cells. */
export function tableSummary(md: string): string {
  return parseMarkdownTable(md).rows[0].map((c) => c.trim()).filter(Boolean).join(' · ');
}
