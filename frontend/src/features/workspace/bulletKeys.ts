import { BlockType } from '../../lib/types';
import { toggleInlineFormat } from '../../lib/inlineFormat';

// The keys of a bullet's text field (OutlinerBlock): which action a key press takes in which state. Pure:
// OutlinerBlock reads the state, asks bulletKeyAction and carries the action out (text, engine, focus).
// Checked in this order: undo/redo, Enter in a bullet someone else holds, formatting, the slash menu, Tab,
// Enter, Backspace, the arrows.

export interface BulletKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Selection and text of a text field */
export interface FieldSelection {
  start: number | null;
  end: number | null;
  value: string;
}

export interface BulletKeyState {
  type: BlockType;
  canEdit: boolean;
  /** Someone else edits the bullet while new bullets may still be added (a read-only field) */
  lockedAppend: boolean;
  /** The bullet's text as the field shows it */
  content: string;
  /** The field the key went to */
  target: FieldSelection;
  /** The bullet's own text field, when it has one (the same field, except in tests) */
  field: FieldSelection | null;
  /** The slash menu is open, with this many commands */
  slashOpen: boolean;
  slashCount: number;
  level: number;
  /** The lowest level of the view (the zoomed bullet's children) */
  minLevel: number;
  siblingFollows: boolean;
  canCreateAbove: boolean;
  canMerge: boolean;
}

export type BulletKeyAction =
  /** Not taken: the field (or the browser) handles the key */
  | { kind: 'none' }
  /** Ctrl/Cmd+Z, Ctrl/Cmd+Y, Ctrl/Cmd+Shift+Z: the note's own undo and redo */
  | { kind: 'history'; redo: boolean }
  /** Enter in a bullet someone else holds: a new bullet below, the held one stays as it is */
  | { kind: 'appendBelow' }
  /** Ctrl/Cmd+L: the link dialog, the link goes between before and after; label: the marked text */
  | { kind: 'linkDialog'; before: string; after: string; caret: number; label: string | null }
  /** Ctrl/Cmd+B or I: the text with the marking toggled */
  | { kind: 'format'; value: string; start: number; end: number }
  | { kind: 'closeSlash' }
  | { kind: 'moveSlash'; step: 1 | -1 }
  /** Enter or Tab in the slash menu: the marked command */
  | { kind: 'applySlash' }
  | { kind: 'indent'; delta: 1 | -1 }
  /** Enter after "```lang": the bullet becomes a code block (lang as typed, may be empty) */
  | { kind: 'toCode'; lang: string }
  /** Enter in an empty to-do: a plain bullet on the same level */
  | { kind: 'endTodo' }
  /** Enter in an empty bullet below the view's top level, nothing after it: one level up */
  | { kind: 'outdentEmpty' }
  /** Enter in an empty last numbered item at the top: ends the list */
  | { kind: 'endNumbered' }
  /** Enter at the very start of a bullet with text: a new empty bullet above it */
  | { kind: 'createAbove' }
  /** Enter elsewhere: the bullet keeps before, a new bullet below gets after */
  | { kind: 'split'; before: string; after: string }
  /** Backspace in an empty bullet */
  | { kind: 'deleteEmpty' }
  /** Backspace at the very start of a bullet with text: its text goes to the end of the previous bullet */
  | { kind: 'merge' }
  /** ArrowUp at the very start, ArrowDown at the very end: the bullet above or below */
  | { kind: 'navigate'; direction: 'up' | 'down' };

const NONE: BulletKeyAction = { kind: 'none' };

/** What a key press in a bullet's text field does. */
export function bulletKeyAction(e: BulletKey, s: BulletKeyState): BulletKeyAction {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
    return { kind: 'history', redo: key === 'y' || e.shiftKey };
  }
  // (Chromium does not move the caret with End in read-only fields, so Enter cannot split it anyway)
  if (s.lockedAppend && e.key === 'Enter' && !e.shiftKey) return { kind: 'appendBelow' };
  if (!s.canEdit) return NONE;

  // Ctrl+K stays with the global search; Ctrl+L would otherwise go to the browser's address bar
  const isMod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  if (isMod && s.type !== 'code' && (key === 'b' || key === 'i' || key === 'l')) {
    const f = s.field ?? s.target;
    const start = f.start ?? 0;
    const end = f.end ?? 0;
    const text = f.value;
    if (key === 'l') {
      // Without a marking the link goes in at the cursor; marked text becomes the link's own text
      if (start >= end) return { kind: 'linkDialog', before: text.slice(0, start), after: text.slice(start), caret: start, label: null };
      return { kind: 'linkDialog', before: text.slice(0, start), after: text.slice(end), caret: start, label: text.slice(start, end).trim() };
    }
    const next = toggleInlineFormat(text, start, end, key === 'b');
    return { kind: 'format', value: next.value, start: next.start, end: next.end };
  }

  if (s.slashOpen) {
    if (e.key === 'Escape') return { kind: 'closeSlash' };
    if (s.slashCount > 0) {
      if (e.key === 'ArrowDown') return { kind: 'moveSlash', step: 1 };
      if (e.key === 'ArrowUp') return { kind: 'moveSlash', step: -1 };
      if (e.key === 'Enter' || e.key === 'Tab') return { kind: 'applySlash' };
    }
  }

  if (e.key === 'Tab') return { kind: 'indent', delta: e.shiftKey ? -1 : 1 };

  const content = s.content;
  if (e.key === 'Enter' && !e.shiftKey && s.type !== 'code') {
    const fence = content.match(/^```([a-z0-9_+#.-]{0,40})$/i);
    if (fence) return { kind: 'toCode', lang: fence[1] };
    if (content === '') {
      if (s.type === 'todo') return { kind: 'endTodo' };
      if (s.level > s.minLevel && !s.siblingFollows) return { kind: 'outdentEmpty' };
      if (s.type === 'numbered' && !s.siblingFollows) return { kind: 'endNumbered' };
    }
    const start = s.target.start ?? content.length;
    const end = s.target.end ?? start;
    // The bullet keeps its text, type, children and the cursor
    if (start === 0 && end === 0 && content !== '' && s.canCreateAbove) return { kind: 'createAbove' };
    // A line break at the split goes
    const before = content.slice(0, start).replace(/\r?\n$/, '');
    const after = content.slice(end).replace(/^\r?\n/, '');
    return { kind: 'split', before, after };
  }

  // Outdenting is Shift+Tab only
  if (e.key === 'Backspace' && content === '') return { kind: 'deleteEmpty' };
  if (e.key === 'Backspace' && s.type !== 'code' && s.canMerge && s.target.start === 0 && s.target.end === 0) {
    return { kind: 'merge' };
  }

  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey) {
    const f = s.field;
    if (e.key === 'ArrowUp' && f && f.start === 0 && f.end === 0) return { kind: 'navigate', direction: 'up' };
    if (e.key === 'ArrowDown' && f && f.start === content.length && f.end === content.length) {
      return { kind: 'navigate', direction: 'down' };
    }
  }
  return NONE;
}
