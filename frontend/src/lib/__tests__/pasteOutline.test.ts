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

  it('makes fenced code one code block with its language', () => {
    const items = parse('```go\nfunc main() {}\n\n```\nDanach');
    expect(items[0]).toEqual({ type: 'code', content: 'func main() {}', lang: 'go', indent: 0 });
    expect(items[1]).toEqual({ type: 'text', content: 'Danach', indent: 0 });
  });

  describe('a fence as a list item content ("- ```bash")', () => {
    const rows = (text: string) => parse(text).map((i) => [i.indent, i.type, i.lang ?? '', i.content]);
    it.each([
      ['with language', '- Installieren\n  - ```bash\n    npm ci\n    npm test\n    ```\n- weiter',
        [[0, 'text', '', 'Installieren'], [1, 'code', 'bash', 'npm ci\nnpm test'], [0, 'text', '', 'weiter']]],
      ['without language', '- ```\n  a\n    b\n  ```\n- weiter',
        [[0, 'code', '', 'a\n  b'], [0, 'text', '', 'weiter']]],
      ['tildes', '- Einrichten\n  * ~~~ python\n    print(1)\n    ~~~\n- weiter',
        [[0, 'text', '', 'Einrichten'], [1, 'code', 'python', 'print(1)'], [0, 'text', '', 'weiter']]],
      ['nested level', '- a\n  - b\n    - ```sh\n      ls\n      ```\n    - c\n  - d',
        [[0, 'text', '', 'a'], [1, 'text', '', 'b'], [2, 'code', 'bash', 'ls'], [2, 'text', '', 'c'], [1, 'text', '', 'd']]],
      ['closing fence at the marker indentation', '- x\n  - ```bash\n    npm ci\n  ```\n- weiter',
        [[0, 'text', '', 'x'], [1, 'code', 'bash', 'npm ci'], [0, 'text', '', 'weiter']]],
      ['closing fence at column 0', '- ```bash\n  npm ci\n```\n- weiter',
        [[0, 'code', 'bash', 'npm ci'], [0, 'text', '', 'weiter']]],
      ['unclosed fence followed by bullets', '- Installieren\n  - ```bash\n    npm ci\n\n- weiter\n  - tiefer',
        [[0, 'text', '', 'Installieren'], [1, 'code', 'bash', 'npm ci'], [0, 'text', '', 'weiter'], [1, 'text', '', 'tiefer']]],
      ['tabs', '- x\n\t- ```bash\n\t  npm ci\n\t    echo\n\t  ```\n- weiter',
        [[0, 'text', '', 'x'], [1, 'code', 'bash', 'npm ci\n  echo'], [0, 'text', '', 'weiter']]],
      ['CRLF', '- Installieren\r\n  - ```bash\r\n    npm ci\r\n    ```\r\n- weiter',
        [[0, 'text', '', 'Installieren'], [1, 'code', 'bash', 'npm ci'], [0, 'text', '', 'weiter']]],
      ['inline code stays text', '- ```x``` ist inline\n- weiter',
        [[0, 'text', '', '```x``` ist inline'], [0, 'text', '', 'weiter']]],
    ])('%s', (_name, text, want) => {
      expect(rows(text)).toEqual(want);
    });
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
  it('turns a Markdown table into one table block, also right after a paragraph line', () => {
    const items = parse('Preise:\n| Ding | Preis |\n|:--|--:|\n| Brot | 3 \\| 4 |\nDanach');
    expect(items.map((i) => [i.type, i.content, i.indent])).toEqual([
      ['text', 'Preise:', 0],
      ['table', '| Ding | Preis |\n| :--- | ---: |\n| Brot | 3 \\| 4 |', 0],
      ['text', 'Danach', 0],
    ]);
  });

  it('does not take a line with a pipe above a divider for a table', () => {
    expect(parse('a | b\n---').map((i) => i.type)).toEqual(['text', 'divider']);
  });
});

describe('pasted file references', () => {
  it('come back as image and audio bullets', () => {
    const items = parsePastedLines(['- ![Foto](media:med_ab12)', '- [Sprachnotiz](media:med_cd34)', '- Text mit ![x](media:med_ab12) drin']);
    expect(items.map((i) => i.type)).toEqual(['image', 'audio', 'text']);
    expect(items[0].content).toBe('![Foto](media:med_ab12)');
  });
});
