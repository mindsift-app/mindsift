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
    expect(blocksToMarkdown([b('bullet', 'Ast', 3), b('bullet', 'Kind', 4)])).toBe('- Ast\n\t- Kind');
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
});
