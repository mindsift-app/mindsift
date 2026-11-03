import { describe, it, expect } from 'vitest';
import { parsePastedLines } from '../pasteOutline';

const parse = (text: string) => parsePastedLines(text.split('\n'));

describe('parsePastedLines', () => {
  it('splits paragraphs at blank lines and keeps wrapped lines together', () => {
    expect(parse('Erster Absatz\nnoch erster\n\nZweiter Absatz')).toEqual([
      { type: 'text', content: 'Erster Absatz\nnoch erster', indent: 0 },
      { type: 'text', content: 'Zweiter Absatz', indent: 0 },
    ]);
  });

  it('keeps numbered lists with nesting (3-space indent)', () => {
    expect(parse('1. Eins\n   1. Unterpunkt\n      1. Tiefer\n2. Zwei')).toEqual([
      { type: 'numbered', content: 'Eins', indent: 0 },
      { type: 'numbered', content: 'Unterpunkt', indent: 1 },
      { type: 'numbered', content: 'Tiefer', indent: 2 },
      { type: 'numbered', content: 'Zwei', indent: 0 },
    ]);
  });

  it('reads headings, todos, bullets and dividers and nests sections under headings', () => {
    expect(parse('# Titel\nText danach\n- [x] erledigt\n* Punkt\n  + tiefer\n---\nOhne Abschnitt')).toEqual([
      { type: 'h1', content: 'Titel', indent: 0 },
      { type: 'text', content: 'Text danach', indent: 1 },
      { type: 'todo', checked: true, content: 'erledigt', indent: 2 },
      { type: 'text', content: 'Punkt', indent: 2 },
      { type: 'text', content: 'tiefer', indent: 3 },
      { type: 'divider', content: '---', indent: 0 },
      { type: 'text', content: 'Ohne Abschnitt', indent: 0 },
    ]);
  });

  it('nests H2 below H1 and closes sections at the same rank', () => {
    expect(parse('# A\n## A1\n1. eins\n## A2\nText\n# B\n- b')).toEqual([
      { type: 'h1', content: 'A', indent: 0 },
      { type: 'h2', content: 'A1', indent: 1 },
      { type: 'numbered', content: 'eins', indent: 2 },
      { type: 'h2', content: 'A2', indent: 1 },
      { type: 'text', content: 'Text', indent: 2 },
      { type: 'h1', content: 'B', indent: 0 },
      { type: 'text', content: 'b', indent: 1 },
    ]);
  });

  it('keeps fenced code as one block', () => {
    const items = parse('```go\nfunc main() {}\n\n```\nDanach');
    expect(items[0].content).toBe('```go\nfunc main() {}\n\n```');
    expect(items[1]).toEqual({ type: 'text', content: 'Danach', indent: 0 });
  });

  it('nests a list under the paragraph that introduces it', () => {
    expect(parse('# Plan\nFolgende Punkte:\n\n- eins\n  - tiefer\n- zwei\n\nDanach Text\n1. a\n2. b')).toEqual([
      { type: 'h1', content: 'Plan', indent: 0 },
      { type: 'text', content: 'Folgende Punkte:', indent: 1 },
      { type: 'text', content: 'eins', indent: 2 },
      { type: 'text', content: 'tiefer', indent: 3 },
      { type: 'text', content: 'zwei', indent: 2 },
      { type: 'text', content: 'Danach Text', indent: 1 },
      { type: 'numbered', content: 'a', indent: 2 },
      { type: 'numbered', content: 'b', indent: 2 },
    ]);
  });
});
