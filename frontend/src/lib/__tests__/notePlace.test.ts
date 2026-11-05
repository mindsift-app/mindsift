import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readNotePlace, writeNotePlace } from '../notePlace';

describe('notePlace', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('remembers zoom and scroll position per note', () => {
    writeNotePlace('a', { zoom: 'blk1', scroll: 420.6 });
    writeNotePlace('b', { zoom: null, scroll: 0 });
    expect(readNotePlace('a')).toEqual({ zoom: 'blk1', scroll: 421 });
    expect(readNotePlace('b')).toEqual({ zoom: null, scroll: 0 });
    expect(readNotePlace('c')).toBeNull();
  });

  it('keeps only the last 20 notes', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 25; i++) {
      vi.setSystemTime(1_000 + i);
      writeNotePlace(`n${i}`, { zoom: null, scroll: i });
    }
    expect(readNotePlace('n4')).toBeNull();
    expect(readNotePlace('n5')).toEqual({ zoom: null, scroll: 5 });
    expect(readNotePlace('n24')).toEqual({ zoom: null, scroll: 24 });
  });

  it('ignores broken storage', () => {
    localStorage.setItem('mindsift_note_place', 'kaputt');
    expect(readNotePlace('a')).toBeNull();
    writeNotePlace('a', { zoom: null, scroll: 10 });
    expect(readNotePlace('a')).toEqual({ zoom: null, scroll: 10 });
  });
});
