import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { OutlinerTree } from '../OutlinerTree';
import { DocumentBlock } from '../../../lib/types';

// Holds the latest block state rendered by the harness
let live: DocumentBlock[] = [];

const Harness: React.FC<{ initial: DocumentBlock[] }> = ({ initial }) => {
  const [blocks, setBlocks] = useState(initial);
  // The test reads the blocks of the harness's last render
  // eslint-disable-next-line react-hooks/globals
  live = blocks;
  return (
    <OutlinerTree
      docId="d1"
      blocks={blocks}
      canEdit
      onUpdateBlock={(b) => setBlocks((p) => p.map((x) => (x.id === b.id ? b : x)))}
      onCreateBlock={(nb, anchor, placement) =>
        setBlocks((p) => {
          const i = p.findIndex((x) => x.id === anchor);
          if (i < 0) return [...p, nb];
          const at = placement === 'before' ? i : i + 1;
          return [...p.slice(0, at), nb, ...p.slice(at)];
        })
      }
      onDeleteBlock={(id) => setBlocks((p) => p.filter((x) => x.id !== id))}
      onMoveBlock={() => {}}
    />
  );
};

const mk = (id: string, content: string, level = 0, type: DocumentBlock['type'] = 'text', extra: Partial<DocumentBlock> = {}) =>
  ({ id, type, content, level, position: 1, ...extra }) as DocumentBlock;

const area = (text: string) => screen.getAllByDisplayValue(text)[0] as HTMLTextAreaElement;

const enterAt = async (ta: HTMLTextAreaElement, pos: number) => {
  ta.focus();
  ta.setSelectionRange(pos, pos);
  await act(async () => {
    fireEvent.keyDown(ta, { key: 'Enter' });
  });
};

const shape = () => live.map((b) => [b.id.startsWith('blk_') ? 'neu' : b.id, b.type, b.content, b.level]);

describe('Enter at the start of a bullet', () => {
  it('pushes a heading with children down a line after a drawing', async () => {
    render(
      <Harness
        initial={[
          mk('zeichnung', '', 0, 'drawing'),
          mk('titel', 'Einkauf', 0, 'h2'),
          mk('kind', 'Brot', 1),
        ]}
      />
    );
    const heading = area('Einkauf');
    await enterAt(heading, 0);
    expect(shape()).toEqual([
      ['zeichnung', 'drawing', '', 0],
      ['neu', 'text', '', 0],
      ['titel', 'h2', 'Einkauf', 0],
      ['kind', 'text', 'Brot', 1],
    ]);
    // The cursor stays at the start of the heading
    expect(document.activeElement).toBe(area('Einkauf'));
    expect(area('Einkauf').selectionStart).toBe(0);
  });

  it('does the same without anything before the heading', async () => {
    render(<Harness initial={[mk('titel', 'Einkauf', 0, 'h1'), mk('kind', 'Brot', 1)]} />);
    await enterAt(area('Einkauf'), 0);
    expect(shape()).toEqual([
      ['neu', 'text', '', 0],
      ['titel', 'h1', 'Einkauf', 0],
      ['kind', 'text', 'Brot', 1],
    ]);
  });

  it('keeps the type and state of other bullets, on their own level', async () => {
    render(
      <Harness
        initial={[
          mk('oben', 'Liste'),
          mk('hinweis', 'Achtung', 1, 'callout'),
          mk('aufgabe', 'Milch holen', 1, 'todo', { checked: true }),
          mk('nummer', 'Erster Schritt', 1, 'numbered'),
        ]}
      />
    );
    await enterAt(area('Achtung'), 0);
    await enterAt(area('Milch holen'), 0);
    await enterAt(area('Erster Schritt'), 0);
    expect(shape()).toEqual([
      ['oben', 'text', 'Liste', 0],
      ['neu', 'text', '', 1],
      ['hinweis', 'callout', 'Achtung', 1],
      // To-dos and numbered items get one more item in front, as with Enter at the end
      ['neu', 'todo', '', 1],
      ['aufgabe', 'todo', 'Milch holen', 1],
      ['neu', 'numbered', '', 1],
      ['nummer', 'numbered', 'Erster Schritt', 1],
    ]);
    expect(live.find((b) => b.id === 'aufgabe')?.checked).toBe(true);
    expect(live.filter((b) => b.id.startsWith('blk_')).every((b) => !b.checked)).toBe(true);
  });

  it('still opens the section at the end of a heading with children', async () => {
    render(<Harness initial={[mk('titel', 'Einkauf', 0, 'h2'), mk('kind', 'Brot', 1)]} />);
    await enterAt(area('Einkauf'), 'Einkauf'.length);
    expect(shape()).toEqual([
      ['titel', 'h2', 'Einkauf', 0],
      ['neu', 'text', '', 1],
      ['kind', 'text', 'Brot', 1],
    ]);
  });

  it('still splits the text with the cursor in the middle', async () => {
    render(<Harness initial={[mk('a', 'Hallo Welt')]} />);
    await enterAt(area('Hallo Welt'), 6);
    expect(shape()).toEqual([
      ['a', 'text', 'Hallo ', 0],
      ['neu', 'text', 'Welt', 0],
    ]);
  });
});
