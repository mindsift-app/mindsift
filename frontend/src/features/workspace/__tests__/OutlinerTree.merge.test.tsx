import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { OutlinerTree } from '../OutlinerTree';
import { DocumentBlock } from '../../../lib/types';

// Holds the latest block state rendered by the harness
let live: DocumentBlock[] = [];

let lockedNotices: string[] = [];

const Harness: React.FC<{ initial: DocumentBlock[]; locked?: Map<string, string> }> = ({ initial, locked }) => {
  const [blocks, setBlocks] = useState(initial);
  live = blocks;
  return (
    <OutlinerTree
      docId="d1"
      blocks={blocks}
      lockedBlocks={locked}
      onLockedAction={(name) => lockedNotices.push(name)}
      canEdit
      onUpdateBlock={(b) => setBlocks((p) => p.map((x) => (x.id === b.id ? b : x)))}
      onUpdateBlocks={(u) => setBlocks((p) => p.map((x) => u.find((y) => y.id === x.id) || x))}
      onCreateBlock={(nb, after) =>
        setBlocks((p) => {
          const i = p.findIndex((x) => x.id === after);
          return i < 0 ? [...p, nb] : [...p.slice(0, i + 1), nb, ...p.slice(i + 1)];
        })
      }
      onDeleteBlock={(id) => setBlocks((p) => p.filter((x) => x.id !== id))}
      onMoveBlock={() => {}}
    />
  );
};

const mk = (id: string, content: string, level = 0, type: any = 'bullet'): DocumentBlock =>
  ({ id, type, content, level, position: 1 }) as DocumentBlock;

const area = (text: string) => screen.getAllByDisplayValue(text)[0] as HTMLTextAreaElement;

const backspaceAt = async (ta: HTMLTextAreaElement, pos = 0) => {
  ta.focus();
  ta.setSelectionRange(pos, pos);
  await act(async () => {
    fireEvent.keyDown(ta, { key: 'Backspace' });
  });
};

describe('Backspace at the start of a bullet', () => {
  it('appends its text to the previous bullet', async () => {
    render(<Harness initial={[mk('a', 'Hallo '), mk('b', 'Welt')]} />);
    await backspaceAt(area('Welt'));
    expect(live.map((b) => b.content)).toEqual(['Hallo Welt']);
  });

  it('works for legacy blocks without a type', async () => {
    render(<Harness initial={[mk('a', 'A', 0, undefined), mk('b', 'B', 0, '')]} />);
    await backspaceAt(area('B'));
    expect(live.map((b) => b.content)).toEqual(['AB']);
  });

  it('moves children up under the previous bullet', async () => {
    render(<Harness initial={[mk('a', 'A'), mk('b', 'B'), mk('c', 'C', 1)]} />);
    await backspaceAt(area('B'));
    expect(live.map((b) => [b.content, b.level])).toEqual([
      ['AB', 0],
      ['C', 1],
    ]);
  });

  it('does nothing when the caret is not at the start', async () => {
    render(<Harness initial={[mk('a', 'A'), mk('b', 'BB')]} />);
    await backspaceAt(area('BB'), 1);
    expect(live).toHaveLength(2);
  });

  it('does not merge the first bullet', async () => {
    render(<Harness initial={[mk('a', 'A'), mk('b', 'B')]} />);
    await backspaceAt(area('A'));
    expect(live).toHaveLength(2);
  });

  it('does not merge into a code block', async () => {
    render(<Harness initial={[mk('a', 'x = 1', 0, 'code'), mk('b', 'B')]} />);
    await backspaceAt(area('B'));
    expect(live).toHaveLength(2);
  });
});

describe('blocks locked by someone else', () => {
  it('are read-only and show who edits them', () => {
    render(<Harness initial={[mk('a', 'Frei'), mk('b', 'Gesperrt')]} locked={new Map([['b', 'Anna']])} />);
    expect(area('Gesperrt').readOnly).toBe(true);
    expect(area('Frei').readOnly).toBe(false);
    expect(screen.getByTitle('Anna bearbeitet diesen Punkt gerade')).toBeTruthy();
  });

  it('merging into a locked bullet is not started at all', async () => {
    lockedNotices = [];
    render(<Harness initial={[mk('a', 'Oben'), mk('b', 'Unten')]} locked={new Map([['a', 'Anna']])} />);
    await backspaceAt(area('Unten'));
    expect(live.map((b) => b.content)).toEqual(['Oben', 'Unten']);
    expect(lockedNotices).toEqual(['Anna']);
  });

  it('a branch with a locked child cannot be merged away', async () => {
    lockedNotices = [];
    render(<Harness initial={[mk('a', 'A'), mk('b', 'B'), mk('c', 'C', 1)]} locked={new Map([['c', 'Ben']])} />);
    await backspaceAt(area('B'));
    expect(live.map((b) => b.content)).toEqual(['A', 'B', 'C']);
    expect(lockedNotices).toEqual(['Ben']);
  });
});

describe('Enter on a locked bullet', () => {
  for (const [label, pos] of [
    ['at the end', 8],
    ['in the middle', 3],
  ] as const) {
    it(`${label} adds a new bullet below and never splits the locked one`, async () => {
      render(<Harness initial={[mk('a', 'Gesperrt')]} locked={new Map([['a', 'Anna']])} />);
      const ta = area('Gesperrt');
      ta.focus();
      ta.setSelectionRange(pos, pos);
      await act(async () => {
        fireEvent.keyDown(ta, { key: 'Enter' });
      });
      expect(live.map((b) => b.content)).toEqual(['Gesperrt', '']);
    });
  }
});
