import { describe, it, expect } from 'vitest';
import { blocksToMarkdown } from '../outlineMarkdown';
import { parsePastedLines } from '../pasteOutline';
import type { DocumentBlock } from '../types';

const b = (type: DocumentBlock['type'], content: string, level = 0, extra: Partial<DocumentBlock> = {}): DocumentBlock => ({
  id: Math.random().toString(36).slice(2),
  type,
  content,
  level,
  ...extra,
});

describe('blocksToMarkdown', () => {
  it('writes warnings and errors as Obsidian callouts', () => {
    const md = blocksToMarkdown([b('warning', 'Strom vorher abschalten', 0), b('text', 'Server', 0), b('error', 'Backup fehlgeschlagen', 1)]);
    expect(md).toBe(['> [!warning]', '> Strom vorher abschalten', '', 'Server', '- > [!failure] Backup fehlgeschlagen'].join('\n'));
  });

  it('writes a nested list with to-dos, headings and code', () => {
    const md = blocksToMarkdown([
      b('h2', 'Umzug', 0),
      b('bullet', 'Server', 1),
      b('todo', 'Backup prüfen', 2, { checked: true }),
      b('todo', 'DNS umstellen', 2),
      b('numbered', 'Erstens', 1),
      b('code', 'docker compose up -d', 1, { lang: 'bash' }),
    ]);
    expect(md).toBe(
      ['## Umzug', '', '- Server', '\t- [x] Backup prüfen', '\t- [ ] DNS umstellen', '1. Erstens', '```bash', 'docker compose up -d', '```'].join('\n')
    );
  });

  it('starts a copied branch at the left margin', () => {
    expect(blocksToMarkdown([b('bullet', 'Ast', 3), b('bullet', 'Kind', 4), b('bullet', 'Enkel', 5)])).toBe('Ast\n- Kind\n\t- Enkel');
  });

  it('writes the top level as paragraphs and headings, the indented bullets as lists', () => {
    const md = blocksToMarkdown([
      b('h1', 'Projekt', 0),
      b('text', 'Ziel des Projekts', 0),
      b('text', 'Teil A', 1),
      b('numbered', 'Schritt eins', 2),
      b('numbered', 'Schritt zwei', 2),
      b('text', 'Zweiter Absatz', 0),
      b('todo', 'Offen', 0),
      b('text', 'Detail', 1),
    ]);
    expect(md).toBe(
      ['# Projekt', '', 'Ziel des Projekts', '- Teil A', '\t1. Schritt eins', '\t1. Schritt zwei', '', 'Zweiter Absatz', '', '- [ ] Offen', '\t- Detail'].join('\n')
    );
  });

  it('pasted back, it gives the same bullets', () => {
    // 'text' is the plain bullet of a note
    const blocks = [b('text', 'Eins', 0), b('text', 'Zwei', 1), b('todo', 'Drei', 2, { checked: true }), b('text', 'Vier', 0)];
    const items = parsePastedLines(blocksToMarkdown(blocks).split('\n'));
    expect(items.map((i) => [i.type, i.content, i.indent, Boolean(i.checked)])).toEqual([
      ['text', 'Eins', 0, false],
      ['text', 'Zwei', 1, false],
      ['todo', 'Drei', 2, true],
      ['text', 'Vier', 0, false],
    ]);
  });

  it('pasted back, paragraphs and their lists keep their levels', () => {
    const blocks = [
      b('text', 'Ziel', 0),
      b('text', 'Teil A', 1),
      b('numbered', 'Schritt', 2),
      b('text', 'Zweiter Absatz', 0),
      b('h2', 'Abschnitt', 0),
      b('text', 'Punkt', 1),
      b('text', 'Schluss', 0),
    ];
    const items = parsePastedLines(blocksToMarkdown(blocks).split('\n'));
    expect(items.map((i) => [i.type, i.content, i.indent])).toEqual([
      ['text', 'Ziel', 0],
      ['text', 'Teil A', 1],
      ['numbered', 'Schritt', 2],
      ['text', 'Zweiter Absatz', 0],
      ['h2', 'Abschnitt', 0],
      ['text', 'Punkt', 1],
      ['text', 'Schluss', 1],
    ]);
  });

  it('a top-level to-do right after a paragraph pastes back under it (like any list after an intro)', () => {
    const items = parsePastedLines(blocksToMarkdown([b('text', 'Einleitung', 0), b('todo', 'Offen', 0)]).split('\n'));
    expect(items.map((i) => [i.type, i.indent])).toEqual([
      ['text', 0],
      ['todo', 1],
    ]);
  });

  // Fenced blocks paste back on the level of their section, nested ones too (same as code)
  it('a copied drawing pastes back as a drawing', () => {
    const model = '{"v":1,"els":[{"id":"a","ver":1,"t":"rect","x":0,"y":0,"w":10,"h":10,"s":"main","f":"none","sw":2,"txt":"Box"}]}';
    const md = blocksToMarkdown([b('drawing', model, 0), b('text', 'Darunter', 0), b('drawing', model, 1)]);
    expect(md.split('\n')[0]).toBe('```mindsift-canvas');
    const items = parsePastedLines(md.split('\n'));
    expect(items.map((i) => [i.type, i.indent])).toEqual([
      ['drawing', 0],
      ['text', 0],
      ['drawing', 0],
    ]);
    expect(JSON.parse(items[2].content).els[0].txt).toBe('Box');
  });

  it('a mindsift-canvas fence without a valid model stays text', () => {
    const items = parsePastedLines(['```mindsift-canvas', 'kein Modell', '```']);
    expect(items[0].type).toBe('text');
  });
  it('writes a table as a block of its own, indented in a list with blank lines around it', () => {
    const table = '| Name | Wert |\n| --- | --- |\n| a\\|b | 1 |';
    const md = blocksToMarkdown([b('table', table, 0), b('text', 'Liste', 0), b('text', 'Punkt', 1), b('table', table, 2), b('text', 'Weiter', 1)]);
    expect(md).toBe(
      [
        '| Name | Wert |',
        '| --- | --- |',
        '| a\\|b | 1 |',
        '',
        'Liste',
        '- Punkt',
        '',
        '\t| Name | Wert |',
        '\t| --- | --- |',
        '\t| a\\|b | 1 |',
        '',
        '- Weiter',
      ].join('\n')
    );
  });

  it('tables paste back as tables on their levels (round trip)', () => {
    const table = '| Name | Wert |\n| --- | :---: |\n| [[Notiz#doc_1\\|Text]] | 1 |';
    const blocks = [
      b('text', 'Absatz', 0),
      b('text', 'Punkt', 1),
      b('table', table, 2),
      b('text', 'Weiter', 1),
      b('table', table, 0),
      b('todo', 'Danach', 0),
      b('h2', 'Abschnitt', 0),
      b('table', table, 1),
    ];
    const items = parsePastedLines(blocksToMarkdown(blocks).split('\n'));
    expect(items.map((i) => [i.type, i.content, i.indent])).toEqual([
      ['text', 'Absatz', 0],
      ['text', 'Punkt', 1],
      ['table', table, 2],
      ['text', 'Weiter', 1],
      ['table', table, 0],
      ['todo', 'Danach', 0],
      ['h2', 'Abschnitt', 0],
      ['table', table, 1],
    ]);
  });
});
