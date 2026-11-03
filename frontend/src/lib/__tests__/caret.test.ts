import { describe, it, expect } from 'vitest';
import { caretAfterChange } from '../caret';

describe('caret after an outside change', () => {
  it('stands at the end of the changed part', () => {
    // undo of typed " Brot" in the middle: back to where the typing started
    expect(caretAfterChange('Milch Brot und Butter', 'Milch und Butter')).toBe(6); // Milch |und
    // redo of it: after the inserted word
    expect(caretAfterChange('Milch und Butter', 'Milch Brot und Butter')).toBe(11); // Milch Brot |und
    // a replaced word: the common ending "er Ball" stays behind the cursor
    expect(caretAfterChange('Ein roter Ball', 'Ein blauer Ball')).toBe(8);
    // change at the start and at the end
    expect(caretAfterChange('xabc', 'abc')).toBe(0);
    expect(caretAfterChange('abc', 'abcdef')).toBe(6);
  });

  it('handles repeated letters and equal texts', () => {
    expect(caretAfterChange('aaaa', 'aaaaa')).toBe(5);
    expect(caretAfterChange('abab', 'ab')).toBe(2);
    expect(caretAfterChange('gleich', 'gleich')).toBe(6);
    expect(caretAfterChange('', 'neu')).toBe(3);
  });
});
