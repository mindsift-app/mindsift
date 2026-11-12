import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Columns3,
  Grid2x2,
  IndentDecrease,
  IndentIncrease,
  Plus,
  Table as TableIcon,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionMenu, ActionMenuItem } from '../../components/ActionMenu';
import { InlineMarkdownOptions, renderInlineMarkdown } from '../../lib/markdown';
import { caretAtPoint, mapRenderedOffsetToRaw } from '../../lib/caret';
import { toggleInlineFormat } from '../../lib/inlineFormat';
import {
  TableData,
  TableLines,
  cellAfterOutsideChange,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  isTableEmpty,
  isTableStart,
  parseMarkdownTable,
  pasteIntoTable,
  serializeMarkdownTable,
  setTableCell,
  tableLines,
} from '../../lib/markdownTable';

export interface TableBlockProps {
  blockId: string;
  /** The table as Markdown (the block's content) */
  content: string;
  /** The block's lang: its line mode (lib/markdownTable.ts) */
  lang?: string;
  canEdit: boolean;
  /** A table someone else edits can still get the cursor (read only), e.g. to add a bullet below it */
  canFocus: boolean;
  /** The table's outer element: the bullet checks with it whether the cursor is inside the table */
  rootRef: React.MutableRefObject<HTMLDivElement | null>;
  /** The bullet's text field: a table hands it its first cell (focus from outside, Ctrl+A …) */
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  registerTextareaRef: (blockId: string, el: HTMLTextAreaElement | null) => void;
  inline: InlineMarkdownOptions;
  /** New content; typing waits a moment (immediate false), rows, columns and pastes go at once */
  onChange: (content: string, immediate: boolean) => void;
  onChangeLines: (lines: TableLines) => void;
  /** The cursor came into the table / left it (moving between cells counts as staying) */
  onFocusIn: () => void;
  onFocusOut: () => void;
  /** Arrow up in the first row, arrow down in the last: on to the bullet above / below */
  onLeave: (direction: 'up' | 'down') => void;
  /** Backspace in a table without any text: the bullet goes, like an empty code block */
  onDelete: () => void;
  /** Enter while someone else edits the table: a new bullet below it */
  onAppendBelow?: () => void;
  onHistory: (redo: boolean) => void;
  /** Tab moves between cells, so the bullet is indented from the table's menu */
  onIndent?: () => void;
  onOutdent?: () => void;
  canIndent?: boolean;
  canOutdent?: boolean;
}

type Cell = { r: number; c: number };
type PendingFocus = Cell & { caret: number | 'start' | 'end'; end?: number };

const cellKey = (r: number, c: number) => `${r}:${c}`;

// A table in a note: one text field per cell over the rendered cell text (like a bullet: the cell with the
// cursor shows its Markdown, the others the formatted text). The first row is the header. Enter adds a row
// below, Tab and Shift+Tab go from cell to cell (Tab in the last cell adds a row), the + right of the table
// adds a column. The line mode and row/column actions sit in the ⋯ menu below the +.
const TableBlockView: React.FC<TableBlockProps> = ({
  blockId,
  content,
  lang,
  canEdit,
  canFocus,
  rootRef,
  textareaRef,
  registerTextareaRef,
  inline,
  onChange,
  onChangeLines,
  onFocusIn,
  onFocusOut,
  onLeave,
  onDelete,
  onAppendBelow,
  onHistory,
  onIndent,
  onOutdent,
  canIndent = false,
  canOutdent = false,
}) => {
  const { t } = useTranslation('workspace');

  // The table as cells. Content this table wrote itself is not read back (that would trim a space just
  // typed at the end of a cell); new content from outside (another person, undo) replaces it. `before` keeps
  // the cells it replaced, so the cursor can move on when its row went.
  const [own, setOwn] = useState<{ content: string; data: TableData; before?: TableData }>(() => ({
    content,
    data: parseMarkdownTable(content),
  }));
  let data = own.data;
  if (content !== own.content) {
    data = parseMarkdownTable(content);
    setOwn({ content, data, before: own.data });
  }
  const rows = data.rows;
  const cols = data.align.length;
  const lines = tableLines(lang);

  // The cell with the cursor (it shows its raw text); the last one stays known for the menu
  const [active, setActive] = useState<Cell | null>(null);
  const lastCellRef = useRef<Cell | null>(null);
  const cellRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocusRef = useRef<PendingFocus | null>(null);
  const hasFocusRef = useRef(false);
  const blurTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    },
    []
  );

  const commit = (next: TableData, immediate: boolean) => {
    const md = serializeMarkdownTable(next);
    setOwn({ content: md, data: next });
    onChange(md, immediate);
  };

  const applyFocus = (p: PendingFocus) => {
    const el = cellRefs.current.get(cellKey(p.r, p.c));
    if (!el) return false;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    const len = el.value.length;
    const start = p.caret === 'start' ? 0 : p.caret === 'end' ? len : Math.min(p.caret, len);
    const end = p.end !== undefined ? Math.min(p.end, len) : start;
    try {
      el.setSelectionRange(start, end);
    } catch {
      // ignore
    }
    // Keep the cell in view inside a table that scrolls sideways (and in the note)
    el.closest('td, th')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  };

  // Moving between cells right away; after a change of rows or columns once the new cells are rendered
  const focusCell = (target: PendingFocus, afterRender = false) => {
    if (!afterRender && applyFocus(target)) return;
    pendingFocusRef.current = target;
  };
  useLayoutEffect(() => {
    const p = pendingFocusRef.current;
    if (p) {
      pendingFocusRef.current = null;
      applyFocus(p);
      return;
    }
    // New content from outside while the cursor is in the table (undo took away its row or column): into
    // the nearest cell, else out of the table upwards like arrow up
    const cell = lastCellRef.current;
    if (!own.before || !hasFocusRef.current || !cell) return;
    const to = cellAfterOutsideChange(own.before, own.data, cell.r, cell.c);
    if (!to) {
      onLeave('up');
      return;
    }
    // Its cell is still there (someone typed elsewhere): the cursor stays where it is
    if (to.row === cell.r && to.col === cell.c) return;
    applyFocus({ r: to.row, c: to.col, caret: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only for new cells; onLeave keeps its identity
  }, [own]);

  // Mobile keyboards and the context menu undo via beforeinput instead of key events
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        onHistory(e.inputType === 'historyRedo');
      }
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, [rootRef, onHistory]);

  const handleFocus = (r: number, c: number) => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setActive({ r, c });
    lastCellRef.current = { r, c };
    if (!hasFocusRef.current) {
      hasFocusRef.current = true;
      onFocusIn();
    }
  };

  const handleBlur = () => {
    setActive(null);
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    // Into another cell or the table's own buttons is no leaving
    blurTimerRef.current = window.setTimeout(() => {
      blurTimerRef.current = null;
      if (rootRef.current?.contains(document.activeElement)) return;
      if (hasFocusRef.current) {
        hasFocusRef.current = false;
        onFocusOut();
      }
    }, 0);
  };

  const addRowBelow = (r: number) => {
    commit(insertTableRow(data, r + 1), true);
    focusCell({ r: r + 1, c: 0, caret: 'start' }, true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>, r: number, c: number) => {
    if (!canEdit) return;
    const value = e.target.value;
    // A line break typed on a phone keyboard that sent no Enter key: a new row, like Enter
    if (/[\r\n]/.test(value)) {
      const next = insertTableRow(setTableCell(data, r, c, value.replace(/[\r\n]+/g, '')), r + 1);
      commit(next, true);
      focusCell({ r: r + 1, c: 0, caret: 'start' }, true);
      return;
    }
    commit(setTableCell(data, r, c, value), false);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>, r: number, c: number) => {
    if (!canEdit) return;
    const text = e.clipboardData.getData('text');
    const clean = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!clean.includes('\n') && !clean.includes('\t')) {
      // One line: into the cell at the cursor (without the line break it may end with)
      if (clean === text) return;
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart ?? ta.value.length;
      commit(setTableCell(data, r, c, ta.value.slice(0, start) + clean + ta.value.slice(ta.selectionEnd ?? start)), false);
      focusCell({ r, c, caret: start + clean.length }, true);
      return;
    }
    // Several lines or cells (a spreadsheet, a Markdown table): into the cells from here on
    e.preventDefault();
    const pastedLines = clean.split('\n');
    const grid = isTableStart(pastedLines, 0) ? parseMarkdownTable(clean).rows : pastedLines.map((l) => l.split('\t'));
    commit(pasteIntoTable(data, r, c, grid), true);
    const last = grid[grid.length - 1];
    focusCell({ r: r + grid.length - 1, c: c + Math.max(0, last.length - 1), caret: 'end' }, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, r: number, c: number) => {
    if (e.nativeEvent.isComposing) return;
    const ta = e.currentTarget;
    const key = e.key;
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    const lastRow = rows.length - 1;
    const lastCol = cols - 1;

    // Ctrl/Cmd+Z undoes the user's own changes in the whole note
    if (mod && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) {
      e.preventDefault();
      e.stopPropagation();
      onHistory(key.toLowerCase() === 'y' || e.shiftKey);
      return;
    }

    const selStart = ta.selectionStart ?? 0;
    const selEnd = ta.selectionEnd ?? 0;
    const collapsed = selStart === selEnd;
    const atStart = collapsed && selStart === 0;
    const atEnd = collapsed && selEnd === ta.value.length;
    // Up and down go to the next row unless the cell has several lines and the cursor is not at its edge
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const singleLine = ta.clientHeight < lineHeight * 1.8;

    if (key === 'ArrowUp' && plain && (singleLine || atStart)) {
      e.preventDefault();
      if (r === 0) onLeave('up');
      else focusCell({ r: r - 1, c, caret: selStart });
      return;
    }
    if (key === 'ArrowDown' && plain && (singleLine || atEnd)) {
      e.preventDefault();
      if (r === lastRow) onLeave('down');
      else focusCell({ r: r + 1, c, caret: selStart });
      return;
    }
    if (key === 'ArrowLeft' && plain && atStart && (r > 0 || c > 0)) {
      e.preventDefault();
      focusCell(c > 0 ? { r, c: c - 1, caret: 'end' } : { r: r - 1, c: lastCol, caret: 'end' });
      return;
    }
    if (key === 'ArrowRight' && plain && atEnd && (r < lastRow || c < lastCol)) {
      e.preventDefault();
      focusCell(c < lastCol ? { r, c: c + 1, caret: 'start' } : { r: r + 1, c: 0, caret: 'start' });
      return;
    }
    if (key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        if (c > 0) focusCell({ r, c: c - 1, caret: 'end' });
        else if (r > 0) focusCell({ r: r - 1, c: lastCol, caret: 'end' });
      } else if (c < lastCol) {
        focusCell({ r, c: c + 1, caret: 'end' });
      } else if (r < lastRow) {
        focusCell({ r: r + 1, c: 0, caret: 'end' });
      } else if (canEdit) {
        // Tab in the last cell adds a row
        addRowBelow(r);
      }
      return;
    }

    if (!canEdit) {
      if (key === 'Enter' && !e.shiftKey && onAppendBelow) {
        e.preventDefault();
        onAppendBelow();
      }
      return;
    }

    // Cells hold no line breaks: Enter (also with Shift) adds a row below this one
    if (key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      addRowBelow(r);
      return;
    }

    if (key === 'Backspace' && plain && collapsed) {
      // A table without any text goes as a whole, like an empty code block
      if (isTableEmpty(data)) {
        e.preventDefault();
        e.stopPropagation();
        onDelete();
        return;
      }
      // An empty row goes; the cursor moves up to the end of the cell above
      if (rows.length > 1 && rows[r].every((cell) => cell.trim() === '')) {
        e.preventDefault();
        e.stopPropagation();
        commit(deleteTableRow(data, r), true);
        focusCell({ r: Math.max(0, r - 1), c, caret: 'end' }, true);
        return;
      }
    }

    // Bold and italic like in a bullet
    if (mod && !e.shiftKey && (key.toLowerCase() === 'b' || key.toLowerCase() === 'i')) {
      e.preventDefault();
      e.stopPropagation();
      const next = toggleInlineFormat(ta.value, selStart, selEnd, key.toLowerCase() === 'b');
      commit(setTableCell(data, r, c, next.value), false);
      focusCell({ r, c, caret: next.start, end: next.end }, true);
    }
  };

  // A click into a cell's formatted text puts the cursor at the same place in its Markdown
  const handleViewClick = (e: React.MouseEvent<HTMLDivElement>, r: number, c: number) => {
    if (!canFocus) return;
    const ta = cellRefs.current.get(cellKey(r, c));
    if (!ta) return;
    const text = rows[r][c];
    let pos = text.length;
    const view = e.currentTarget;
    const at = caretAtPoint(e.clientX, e.clientY);
    if (at && view.contains(at.node)) {
      const range = document.createRange();
      range.setStart(view, 0);
      range.setEnd(at.node, at.offset);
      pos = mapRenderedOffsetToRaw(text, view.textContent || '', range.toString().length);
    }
    ta.focus();
    ta.setSelectionRange(pos, pos);
  };

  const cellForMenu = (): Cell | null => {
    const cell = active ?? lastCellRef.current;
    return cell && cell.r < rows.length && cell.c < cols ? cell : null;
  };

  // The + right of the table: a column at the end, the cursor into its header
  const addColumn = () => {
    commit(insertTableColumn(data, cols), true);
    focusCell({ r: 0, c: cols, caret: 'start' }, true);
  };

  const menuItems = (): ActionMenuItem[] => {
    const cell = cellForMenu();
    const needCell = cell ? undefined : t('table.needCell');
    const mode = (key: string, value: TableLines, icon: React.ReactNode, separatorBefore = false): ActionMenuItem => ({
      key,
      icon,
      label: t(`table.lines.${key}`),
      checked: lines === value,
      separatorBefore,
      onSelect: () => {
        if (value !== lines) onChangeLines(value);
      },
    });
    const items: ActionMenuItem[] = [
      mode('fade', '', <Grid2x2 className="w-3.5 h-3.5" />),
      mode('grid', 'grid', <TableIcon className="w-3.5 h-3.5" />),
      mode('header', 'header', <Columns3 className="w-3.5 h-3.5" />),
      {
        key: 'colLeft',
        icon: <BetweenVerticalStart className="w-3.5 h-3.5" />,
        label: t('table.insertColumnLeft'),
        separatorBefore: true,
        disabled: !cell,
        hint: needCell,
        onSelect: () => {
          if (!cell) return;
          commit(insertTableColumn(data, cell.c), true);
          focusCell({ r: cell.r, c: cell.c, caret: 'start' }, true);
        },
      },
      {
        key: 'colRight',
        icon: <BetweenVerticalEnd className="w-3.5 h-3.5" />,
        label: t('table.insertColumnRight'),
        disabled: !cell,
        hint: needCell,
        onSelect: () => {
          if (!cell) return;
          commit(insertTableColumn(data, cell.c + 1), true);
          focusCell({ r: cell.r, c: cell.c + 1, caret: 'start' }, true);
        },
      },
      {
        key: 'deleteRow',
        icon: <Trash2 className="w-3.5 h-3.5" />,
        label: t('table.deleteRow'),
        danger: true,
        separatorBefore: true,
        disabled: !cell || rows.length <= 1,
        hint: needCell ?? (rows.length <= 1 ? t('table.onlyRow') : undefined),
        onSelect: () => {
          if (!cell || rows.length <= 1) return;
          commit(deleteTableRow(data, cell.r), true);
          focusCell({ r: Math.min(cell.r, rows.length - 2), c: cell.c, caret: 'end' }, true);
        },
      },
      {
        key: 'deleteColumn',
        icon: <Trash2 className="w-3.5 h-3.5" />,
        label: t('table.deleteColumn'),
        danger: true,
        disabled: !cell || cols <= 1,
        hint: needCell ?? (cols <= 1 ? t('table.onlyColumn') : undefined),
        onSelect: () => {
          if (!cell || cols <= 1) return;
          commit(deleteTableColumn(data, cell.c), true);
          focusCell({ r: cell.r, c: Math.min(cell.c, cols - 2), caret: 'end' }, true);
        },
      },
    ];
    if (onIndent || onOutdent) {
      items.push(
        {
          key: 'indent',
          icon: <IndentIncrease className="w-3.5 h-3.5" />,
          label: t('outlineBar.indent'),
          separatorBefore: true,
          disabled: !canIndent,
          onSelect: () => onIndent?.(),
        },
        {
          key: 'outdent',
          icon: <IndentDecrease className="w-3.5 h-3.5" />,
          label: t('outlineBar.outdent'),
          disabled: !canOutdent,
          onSelect: () => onOutdent?.(),
        }
      );
    }
    return items;
  };

  const renderCell = (text: string, r: number, c: number) => {
    const isActive = active?.r === r && active.c === c;
    const Tag = r === 0 ? 'th' : 'td';
    return (
      <Tag
        key={c}
        className="nt-cell"
        data-top={r === 0 || undefined}
        data-bottom={r === rows.length - 1 || undefined}
        data-left={c === 0 || undefined}
        data-right={c === cols - 1 || undefined}
        style={data.align[c] ? { textAlign: data.align[c] as React.CSSProperties['textAlign'] } : undefined}
      >
        {/* data-text: the column's minimum width on the desktop (index.css) */}
        <div className="relative" data-text={text}>
          <div
            className={`nt-text ${isActive ? 'invisible' : canFocus ? 'cursor-text' : ''}`}
            aria-hidden={isActive || undefined}
            // Keeps the cursor in the table while it moves to another cell (no leaving and coming back)
            onMouseDown={(e) => {
              if (canFocus && hasFocusRef.current) e.preventDefault();
            }}
            onClick={(e) => handleViewClick(e, r, c)}
          >
            {/* The cell with the cursor sizes itself by its raw text, the others show it formatted */}
            {isActive ? `${text}\u200b` : text ? renderInlineMarkdown(text, inline) : '\u200b'}
          </div>
          <textarea
            ref={(el) => {
              const k = cellKey(r, c);
              if (el) cellRefs.current.set(k, el);
              else if (cellRefs.current.get(k)) cellRefs.current.delete(k);
              if (r === 0 && c === 0) {
                textareaRef.current = el;
                registerTextareaRef(blockId, el);
              }
            }}
            data-table-cell=""
            data-own-height="true"
            rows={1}
            value={text}
            readOnly={!canEdit}
            tabIndex={canFocus ? 0 : -1}
            aria-label={r === 0 ? t('table.headerCell', { col: c + 1 }) : t('table.cell', { row: r, col: c + 1 })}
            onFocus={() => handleFocus(r, c)}
            onBlur={handleBlur}
            onChange={(e) => handleChange(e, r, c)}
            onKeyDown={(e) => handleKeyDown(e, r, c)}
            onPaste={(e) => handlePaste(e, r, c)}
            className={`nt-input absolute inset-0 block w-full h-full m-0 p-0 resize-none overflow-hidden bg-transparent border-0 focus:outline-none focus:ring-0 ${
              isActive ? 'text-main' : 'text-transparent selection:text-transparent pointer-events-none'
            }`}
          />
        </div>
      </Tag>
    );
  };

  const header = rows[0];
  const body = rows.slice(1);

  return (
    <div
      ref={rootRef}
      data-table-block=""
      data-lines={lines || 'fade'}
      className="note-table-block group/table relative flex max-w-full items-stretch gap-0.5 sm:gap-1"
      // The row would put the cursor into the first cell otherwise
      onClick={(e) => e.stopPropagation()}
    >
      <div className="table-scroll min-w-0 overflow-x-auto overscroll-x-contain">
        <table className="note-table" data-lines={lines || 'fade'}>
          <thead>
            <tr>{header.map((text, c) => renderCell(text, 0, c))}</tr>
          </thead>
          {body.length > 0 && (
            <tbody>
              {body.map((cells, i) => (
                <tr key={i + 1}>{cells.map((text, c) => renderCell(text, i + 1, c))}</tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {canEdit && (
        // Phones: always there and big enough to tap; desktop: shows on hover or with the cursor in the table
        <div className="flex flex-col shrink-0 gap-0.5 opacity-100 sm:opacity-0 sm:group-hover/table:opacity-100 sm:group-focus-within/table:opacity-100 transition-opacity">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addColumn}
            title={t('table.addColumn')}
            aria-label={t('table.addColumn')}
            className="flex-1 min-h-11 w-11 sm:min-h-6 sm:w-6 flex items-center justify-center rounded-btn text-faint hover:text-accent hover:bg-panel-elevated transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          </button>
          <ActionMenu
            keepFocus
            label={t('table.menu')}
            items={menuItems()}
            buttonClassName="h-11 w-11 sm:h-6 sm:w-6 flex items-center justify-center rounded-btn text-faint hover:text-main hover:bg-panel-elevated transition-colors cursor-pointer"
          />
        </div>
      )}
    </div>
  );
};

// Memoized: its handlers come stable from the bullet, so moving the mouse over the row does not render it
export const TableBlock = React.memo(TableBlockView);
