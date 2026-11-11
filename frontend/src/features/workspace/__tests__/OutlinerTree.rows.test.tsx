import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutlinerTree } from '../OutlinerTree';
import type { BlockLock } from '../OutlinerBlock';
import { DocumentBlock } from '../../../lib/types';

// The tree keeps each bullet's element while its values stay the same; whatever changes must still show
const mk = (id: string, content: string, level = 0, type: any = 'bullet', more: Partial<DocumentBlock> = {}): DocumentBlock =>
  ({ id, type, content, level, position: 1, ...more }) as DocumentBlock;

const tree = (blocks: DocumentBlock[], lockedBlocks?: Map<string, BlockLock>, canEdit = true) => (
  <OutlinerTree
    docId="d1"
    blocks={blocks}
    lockedBlocks={lockedBlocks}
    canEdit={canEdit}
    onUpdateBlock={() => {}}
    onCreateBlock={() => {}}
    onDeleteBlock={() => {}}
    onMoveBlock={() => {}}
  />
);

const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-outline-block]')).map((el) => el.getAttribute('data-outline-block'));
const marker = (container: HTMLElement, id: string) => container.querySelector(`[data-outline-block="${id}"]`)?.textContent || '';

describe('OutlinerTree rows', () => {
  it('shows new text, numbers, folding and locks after a change', () => {
    const blocks = [mk('a', 'Eins', 0, 'numbered'), mk('b', 'Zwei', 0, 'numbered'), mk('c', 'Kind', 1)];
    const { container, rerender } = render(tree(blocks));
    expect(rowIds(container)).toEqual(['a', 'b', 'c']);
    expect(marker(container, 'b')).toContain('2.');

    // New text in one bullet, the outline stays
    rerender(tree([blocks[0], { ...blocks[1], content: 'Zwei neu' }, blocks[2]]));
    expect(screen.getByDisplayValue('Zwei neu')).toBeTruthy();
    expect(marker(container, 'b')).toContain('2.');

    // The first bullet becomes text: the second one is now number 1
    rerender(tree([{ ...blocks[0], type: 'bullet' }, { ...blocks[1], content: 'Zwei neu' }, blocks[2]]));
    expect(marker(container, 'b')).toContain('1.');

    // Folding hides the child
    const folded = [{ ...blocks[0], type: 'bullet' as const }, { ...blocks[1], content: 'Zwei neu', collapsed: true }, blocks[2]];
    rerender(tree(folded));
    expect(rowIds(container)).toEqual(['a', 'b']);

    // A lock from someone else (the very same blocks) makes that bullet read-only, and the tree read-only all
    const lock: BlockLock = { userId: 'u2', name: 'Bea' };
    rerender(tree(folded, new Map([['a', lock]])));
    expect((screen.getByDisplayValue('Eins') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((screen.getByDisplayValue('Zwei neu') as HTMLTextAreaElement).readOnly).toBe(false);
    rerender(tree(folded, new Map([['a', lock]]), false));
    expect((screen.getByDisplayValue('Zwei neu') as HTMLTextAreaElement).readOnly).toBe(true);
  });
});
