import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTagFilter } from '../useTagFilter';

describe('useTagFilter', () => {
  it('switches hashtags on and off and clears them all', () => {
    const { result } = renderHook(() => useTagFilter('haus'));
    expect(result.current.selectedTags).toEqual([]);
    act(() => result.current.toggleTag('garten'));
    act(() => result.current.toggleTag('einkauf'));
    expect(result.current.selectedTags).toEqual(['garten', 'einkauf']);
    act(() => result.current.toggleTag('garten'));
    expect(result.current.selectedTags).toEqual(['einkauf']);
    act(() => result.current.clearTags());
    expect(result.current.selectedTags).toEqual([]);
  });

  it('starts without a filter when another list opens, also when going back', () => {
    const { result, rerender } = renderHook(({ listId }) => useTagFilter(listId), { initialProps: { listId: 'haus' } });
    act(() => result.current.toggleTag('garten'));
    expect(result.current.selectedTags).toEqual(['garten']);
    rerender({ listId: 'arbeit' });
    expect(result.current.selectedTags).toEqual([]);
    act(() => result.current.toggleTag('büro'));
    expect(result.current.selectedTags).toEqual(['büro']);
    rerender({ listId: 'haus' });
    expect(result.current.selectedTags).toEqual([]);
  });

  it('keeps the filter while the same list renders again', () => {
    const { result, rerender } = renderHook(({ listId }) => useTagFilter(listId), { initialProps: { listId: 'all' } });
    act(() => result.current.toggleTag('garten'));
    const before = result.current.selectedTags;
    rerender({ listId: 'all' });
    expect(result.current.selectedTags).toBe(before);
  });
});
