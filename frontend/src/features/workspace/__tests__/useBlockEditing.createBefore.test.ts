import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlockEditing } from '../useBlockEditing';
import { DocumentBlock } from '../../../lib/types';

const mk = (id: string, content: string, level = 0, extra: Partial<DocumentBlock> = {}) =>
  ({ id, type: 'text', content, level, position: 1, ...extra }) as DocumentBlock;

const setup = (initial: DocumentBlock[]) => {
  const current = { current: initial };
  const { result } = renderHook(() =>
    useBlockEditing({
      docId: 'd1',
      canEdit: true,
      inTrash: false,
      embedded: false,
      zoomedBlockId: null,
      childBlocks: initial,
      scrollRef: { current: null },
      outlinerTreeRef: { current: null },
      currentBlocksRef: current,
      applyLocalBlocks: (update) => {
        current.current = typeof update === 'function' ? update(current.current) : update;
      },
    })
  );
  return { result, current };
};

describe('useBlockEditing: a new bullet before another', () => {
  it('goes directly above the given bullet', () => {
    const { result, current } = setup([mk('a', 'Oben'), mk('b', 'Unten'), mk('c', 'Kind', 1)]);
    act(() => result.current.handleCreateBlock(mk('neu', ''), 'b', 'before'));
    expect(current.current.map((b) => b.id)).toEqual(['a', 'neu', 'b', 'c']);
  });

  it('goes above the original when the bullet is its conflict copy', () => {
    const { result, current } = setup([mk('a', 'Original'), mk('a2', 'Kopie', 0, { conflictOf: 'a' })]);
    act(() => result.current.handleCreateBlock(mk('neu', ''), 'a2', 'before'));
    expect(current.current.map((b) => b.id)).toEqual(['neu', 'a', 'a2']);
  });
});
