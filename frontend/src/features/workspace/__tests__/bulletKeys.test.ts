import { describe, it, expect } from 'vitest';
import { bulletKeyAction, BulletKey, BulletKeyAction, BulletKeyState } from '../bulletKeys';

const key = (k: string, mods: Partial<BulletKey> = {}): BulletKey => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

// A bullet "Einkauf" with the cursor at the end, on the top level, nothing open
const state = (over: Partial<BulletKeyState> & { caret?: number; selEnd?: number } = {}): BulletKeyState => {
  const { caret, selEnd, ...rest } = over;
  const content = rest.content ?? 'Einkauf';
  const start = caret ?? content.length;
  const sel = { start, end: selEnd ?? start, value: content };
  return {
    type: 'text',
    canEdit: true,
    lockedAppend: false,
    content,
    target: sel,
    field: sel,
    slashOpen: false,
    slashCount: 0,
    level: 0,
    minLevel: 0,
    siblingFollows: false,
    canCreateAbove: true,
    canMerge: true,
    ...rest,
  };
};

const ctrl = { ctrlKey: true };
const none: BulletKeyAction = { kind: 'none' };

describe('bulletKeyAction', () => {
  const cases: [string, BulletKey, BulletKeyState, BulletKeyAction][] = [
    // Undo and redo, also in read-only bullets
    ['Strg+Z', key('z', ctrl), state(), { kind: 'history', redo: false }],
    ['Cmd+Z', key('z', { metaKey: true }), state({ canEdit: false }), { kind: 'history', redo: false }],
    ['Strg+Y', key('y', ctrl), state(), { kind: 'history', redo: true }],
    ['Strg+Umschalt+Z', key('Z', { ctrlKey: true, shiftKey: true }), state(), { kind: 'history', redo: true }],
    ['Strg+Alt+Z', key('z', { ctrlKey: true, altKey: true }), state(), none],

    // A bullet someone else edits
    ['Enter, gesperrt', key('Enter'), state({ canEdit: false, lockedAppend: true }), { kind: 'appendBelow' }],
    ['Umschalt+Enter, gesperrt', key('Enter', { shiftKey: true }), state({ canEdit: false, lockedAppend: true }), none],
    ['Enter, nur lesen', key('Enter'), state({ canEdit: false }), none],
    ['Tab, nur lesen', key('Tab'), state({ canEdit: false }), none],

    // Formatting
    ['Strg+B mit Markierung', key('b', ctrl), state({ caret: 0, selEnd: 3 }), { kind: 'format', value: '**Ein**kauf', start: 2, end: 5 }],
    ['Strg+I mit Markierung', key('i', ctrl), state({ caret: 0, selEnd: 3 }), { kind: 'format', value: '*Ein*kauf', start: 1, end: 4 }],
    ['Strg+B im Code', key('b', ctrl), state({ type: 'code' }), none],
    ['Strg+Umschalt+B', key('b', { ctrlKey: true, shiftKey: true }), state(), none],
    ['Strg+L ohne Markierung', key('l', ctrl), state({ caret: 3 }), { kind: 'linkDialog', before: 'Ein', after: 'kauf', caret: 3, label: null }],
    [
      'Strg+L mit Markierung',
      key('L', ctrl),
      state({ content: 'Liste Einkauf heute', caret: 6, selEnd: 14 }),
      { kind: 'linkDialog', before: 'Liste ', after: 'heute', caret: 6, label: 'Einkauf' },
    ],

    // Slash menu
    ['Escape im Menü', key('Escape'), state({ slashOpen: true }), { kind: 'closeSlash' }],
    ['Pfeil runter im Menü', key('ArrowDown'), state({ slashOpen: true, slashCount: 3 }), { kind: 'moveSlash', step: 1 }],
    ['Pfeil hoch im Menü', key('ArrowUp'), state({ slashOpen: true, slashCount: 3, caret: 0 }), { kind: 'moveSlash', step: -1 }],
    ['Enter im Menü', key('Enter'), state({ slashOpen: true, slashCount: 3 }), { kind: 'applySlash' }],
    ['Tab im Menü', key('Tab'), state({ slashOpen: true, slashCount: 3 }), { kind: 'applySlash' }],
    ['Enter im leeren Menü', key('Enter'), state({ slashOpen: true }), { kind: 'split', before: 'Einkauf', after: '' }],
    ['Pfeil hoch im leeren Menü', key('ArrowUp'), state({ slashOpen: true, caret: 0 }), { kind: 'navigate', direction: 'up' }],

    // Tab
    ['Tab', key('Tab'), state(), { kind: 'indent', delta: 1 }],
    ['Umschalt+Tab', key('Tab', { shiftKey: true }), state(), { kind: 'indent', delta: -1 }],
    ['Tab im Code', key('Tab'), state({ type: 'code' }), { kind: 'indent', delta: 1 }],

    // Enter
    ['Enter am Ende', key('Enter'), state(), { kind: 'split', before: 'Einkauf', after: '' }],
    ['Enter in der Mitte', key('Enter'), state({ caret: 3 }), { kind: 'split', before: 'Ein', after: 'kauf' }],
    ['Enter über Markierung', key('Enter'), state({ caret: 2, selEnd: 5 }), { kind: 'split', before: 'Ei', after: 'uf' }],
    ['Enter am Zeilenumbruch', key('Enter'), state({ content: 'a\nb', caret: 2 }), { kind: 'split', before: 'a', after: 'b' }],
    ['Enter vor Zeilenumbruch', key('Enter'), state({ content: 'a\r\nb', caret: 1 }), { kind: 'split', before: 'a', after: 'b' }],
    ['Enter am Anfang', key('Enter'), state({ caret: 0 }), { kind: 'createAbove' }],
    ['Enter am Anfang ohne Einfügen davor', key('Enter'), state({ caret: 0, canCreateAbove: false }), { kind: 'split', before: '', after: 'Einkauf' }],
    ['Umschalt+Enter', key('Enter', { shiftKey: true }), state(), none],
    ['Enter im Code', key('Enter'), state({ type: 'code' }), none],
    ['Enter nach ```', key('Enter'), state({ content: '```' }), { kind: 'toCode', lang: '' }],
    ['Enter nach ```js', key('Enter'), state({ content: '```js' }), { kind: 'toCode', lang: 'js' }],
    ['Enter im leeren To-do', key('Enter'), state({ content: '', type: 'todo', level: 2 }), { kind: 'endTodo' }],
    ['Enter leer eingerückt', key('Enter'), state({ content: '', level: 1 }), { kind: 'outdentEmpty' }],
    ['Enter leer, Geschwister folgt', key('Enter'), state({ content: '', level: 1, siblingFollows: true }), { kind: 'split', before: '', after: '' }],
    ['Enter leer auf Zoom-Ebene', key('Enter'), state({ content: '', level: 2, minLevel: 2 }), { kind: 'split', before: '', after: '' }],
    ['Enter leere letzte Nummer', key('Enter'), state({ content: '', type: 'numbered' }), { kind: 'endNumbered' }],
    ['Enter leere Nummer, Geschwister folgt', key('Enter'), state({ content: '', type: 'numbered', siblingFollows: true }), { kind: 'split', before: '', after: '' }],

    // Backspace
    ['Rücktaste leer', key('Backspace'), state({ content: '', level: 1 }), { kind: 'deleteEmpty' }],
    ['Rücktaste leer im Code', key('Backspace'), state({ content: '', type: 'code' }), { kind: 'deleteEmpty' }],
    ['Rücktaste am Anfang', key('Backspace'), state({ caret: 0 }), { kind: 'merge' }],
    ['Rücktaste am Anfang im Code', key('Backspace'), state({ caret: 0, type: 'code' }), none],
    ['Rücktaste am Anfang ohne Zusammenführen', key('Backspace'), state({ caret: 0, canMerge: false }), none],
    ['Rücktaste mit Markierung am Anfang', key('Backspace'), state({ caret: 0, selEnd: 2 }), none],
    ['Rücktaste in der Mitte', key('Backspace'), state({ caret: 3 }), none],

    // Arrows
    ['Pfeil hoch am Anfang', key('ArrowUp'), state({ caret: 0 }), { kind: 'navigate', direction: 'up' }],
    ['Pfeil hoch in der Mitte', key('ArrowUp'), state({ caret: 3 }), none],
    ['Pfeil runter am Ende', key('ArrowDown'), state(), { kind: 'navigate', direction: 'down' }],
    ['Pfeil runter in der Mitte', key('ArrowDown'), state({ caret: 3 }), none],
    ['Umschalt+Pfeil runter am Ende', key('ArrowDown', { shiftKey: true }), state(), none],
    ['Alt+Pfeil hoch am Anfang', key('ArrowUp', { altKey: true }), state({ caret: 0 }), none],
    ['Pfeil hoch ohne eigenes Feld', key('ArrowUp'), state({ caret: 0, field: null }), none],
    ['Pfeil links', key('ArrowLeft'), state({ caret: 0 }), none],
    ['Buchstabe', key('a'), state(), none],
  ];

  it.each(cases)('%s', (_name, k, s, expected) => {
    expect(bulletKeyAction(k, s)).toEqual(expected);
  });

  it('nimmt für Formatierung und Arrows das eigene Feld, für Enter das Feld des Tastendrucks', () => {
    const s = state({ caret: 3 });
    const other = { start: 0, end: 0, value: 'Einkauf' };
    expect(bulletKeyAction(key('Enter'), { ...s, target: other })).toEqual({ kind: 'createAbove' });
    expect(bulletKeyAction(key('ArrowUp'), { ...s, target: other })).toEqual(none);
    expect(bulletKeyAction(key('l', ctrl), { ...s, field: null, target: other })).toEqual({
      kind: 'linkDialog',
      before: '',
      after: 'Einkauf',
      caret: 0,
      label: null,
    });
  });
});
