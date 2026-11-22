import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepOutlineRowNear, observeOutlineRow } from '../outlineNear';

type Callback = (entries: { target: Element; isIntersecting: boolean }[]) => void;

class FakeObserver {
  static all: FakeObserver[] = [];
  targets = new Set<Element>();
  disconnected = false;
  constructor(
    public callback: Callback,
    public options: { root: Element | null; rootMargin: string }
  ) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.disconnected = true;
  }
}

describe('observeOutlineRow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeObserver.all = [];
    document.body.innerHTML = '';
  });

  it('keeps rows in view and rows that had the cursor rendered until they are far away', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    document.body.innerHTML = '<div data-outline-scroll><div id="a"></div><div id="b"></div></div><div id="c"></div>';
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    const c = document.getElementById('c')!;
    const stopA = observeOutlineRow(a);
    const stopB = observeOutlineRow(b);
    const stopC = observeOutlineRow(c);
    expect(FakeObserver.all).toHaveLength(2);
    const [inNote, inWindow] = FakeObserver.all;
    expect(inNote.options.root).toBe(document.querySelector('[data-outline-scroll]'));
    expect(inNote.options.rootMargin).toBe('100% 0px');
    expect(inWindow.options.root).toBeNull();

    // First report: a is in view and stays watched, b is far away and no longer watched
    inNote.callback([
      { target: a, isIntersecting: true },
      { target: b, isIntersecting: false },
    ]);
    expect(a.hasAttribute('data-outline-near')).toBe(true);
    expect(b.hasAttribute('data-outline-near')).toBe(false);
    expect([...inNote.targets]).toEqual([a]);

    // a scrolled far away
    inNote.callback([{ target: a, isIntersecting: false }]);
    expect(a.hasAttribute('data-outline-near')).toBe(false);
    expect(inNote.targets.size).toBe(0);

    // b gets the cursor: rendered and watched again
    keepOutlineRowNear(b);
    expect(b.hasAttribute('data-outline-near')).toBe(true);
    expect([...inNote.targets]).toEqual([b]);

    stopA();
    expect(inNote.disconnected).toBe(false);
    stopB();
    expect(inNote.disconnected).toBe(true);
    stopC();
    expect(inWindow.disconnected).toBe(true);
    // A row no longer registered is left alone
    keepOutlineRowNear(c);
    expect(c.hasAttribute('data-outline-near')).toBe(false);
  });

  it('marks the rows near the view right after they mount, before the observer reports', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    document.body.innerHTML = '<div data-outline-scroll></div>';
    const scroll = document.querySelector('[data-outline-scroll]')!;
    const rect = (el: Element, top: number, height: number) =>
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + height, height } as DOMRect);
    rect(scroll, 100, 500);
    // Above the view by more than a screen, in view, not laid out, half a screen below the view, two screens below
    const rows = [-900, 120, 0, 800, 1700].map((top) => {
      const row = document.createElement('div');
      scroll.appendChild(row);
      rect(row, top, top ? 40 : 0);
      return row;
    });
    const stops = rows.map((row) => observeOutlineRow(row));
    expect(rows.some((row) => row.hasAttribute('data-outline-near'))).toBe(false);
    await Promise.resolve();
    expect(rows.map((row) => row.hasAttribute('data-outline-near'))).toEqual([false, true, false, true, false]);
    stops.forEach((stop) => stop());
  });

  it('does nothing without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const el = document.createElement('div');
    expect(() => observeOutlineRow(el)()).not.toThrow();
    keepOutlineRowNear(el);
    expect(el.hasAttribute('data-outline-near')).toBe(false);
  });
});
