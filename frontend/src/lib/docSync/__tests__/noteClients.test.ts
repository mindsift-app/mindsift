import { describe, it, expect, vi } from 'vitest';
import { noteClientId, onNoteClosed, registerNoteClient } from '../noteClients';

describe('noteClients', () => {
  it('keeps a note open while one of two engines of it is still open', () => {
    const closed = vi.fn();
    const stop = onNoteClosed(closed);
    const first = registerNoteClient('doc_twice', 'c1');
    const second = registerNoteClient('doc_twice', 'c2');
    expect(noteClientId('doc_twice')).toBe('c2');
    // The one opened last closes first: the other one still has the note open
    second();
    expect(noteClientId('doc_twice')).toBe('c1');
    expect(closed).not.toHaveBeenCalled();
    first();
    expect(noteClientId('doc_twice')).toBeUndefined();
    expect(closed).toHaveBeenCalledWith('doc_twice');
    stop();
  });

  it('closing an engine twice changes nothing', () => {
    const off = registerNoteClient('doc_once', 'c1');
    const other = registerNoteClient('doc_once', 'c2');
    off();
    off();
    expect(noteClientId('doc_once')).toBe('c2');
    other();
  });
});
