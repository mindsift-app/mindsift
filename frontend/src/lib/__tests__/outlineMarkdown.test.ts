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
});
