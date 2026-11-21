import { afterEach, describe, it, expect } from 'vitest';
import { caretAfterChange, rawOffsetAtPoint } from '../caret';

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

describe('raw offset at a point', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'caretRangeFromPoint');
    Reflect.deleteProperty(Range.prototype, 'getClientRects');
    document.body.innerHTML = '';
  });

  const setup = () => {
    const outer = document.createElement('div');
    const el = document.createElement('span');
    el.innerHTML = 'Mit <strong>fettem</strong> Wort';
    outer.append(el, document.createTextNode('daneben'));
    document.body.append(outer);
    return { outer, el, raw: 'Mit **fettem** Wort' };
  };
  const hitAt = (node: Node, offset: number) => {
    document.caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(node, offset);
      return r;
    };
  };

  it('maps a hit in the rendered text back to the raw text', () => {
    const { el, raw } = setup();
    const strong = el.querySelector('strong')!;
    hitAt(strong.firstChild!, 3);
    expect(rawOffsetAtPoint(el, raw, 0, 0)).toEqual({ offset: 9, node: strong.firstChild, nodeOffset: 3 }); // Mit **fet|tem**
  });

  it('takes the nearest character when the hit test stops outside the text', () => {
    const { outer, el, raw } = setup();
    hitAt(outer, 0);
    // jsdom has no layout: every character a 10 px box on one line
    Range.prototype.getClientRects = function (this: Range) {
      const before = document.createRange();
      before.setStart(el, 0);
      before.setEnd(this.startContainer, this.startOffset);
      const left = before.toString().length * 10;
      return [{ left, right: left + 10, top: 0, bottom: 20 }] as unknown as DOMRectList;
    };
    // x 118: on the right half of the 12th character ("Mit fettem W"), so behind it
    expect(rawOffsetAtPoint(el, raw, 118, 10)?.offset).toBe(16);
  });

  it('with onlyInside leaves a point outside the text to the caller', () => {
    const { outer, el, raw } = setup();
    hitAt(outer, 0);
    el.getBoundingClientRect = () => ({ left: 0, right: 150, top: 0, bottom: 20 }) as DOMRect;
    expect(rawOffsetAtPoint(el, raw, 10, 40, true)).toBeNull();
  });
});
