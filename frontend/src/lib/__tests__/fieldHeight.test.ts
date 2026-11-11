import { describe, it, expect, vi, afterEach } from 'vitest';

// A field whose text needs `lines` lines of 20 px at its current width
function field(width: number, lines: number) {
  const el = document.createElement('textarea');
  let w = width;
  Object.defineProperty(el, 'clientWidth', { get: () => w });
  Object.defineProperty(el, 'scrollHeight', { get: () => lines * 20 });
  return {
    el,
    resize: (next: number, nextLines: number) => {
      w = next;
      lines = nextLines;
    },
  };
}

describe('refitOnWidthChange', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('fits all fields whose width changed in one pass, and stops on cleanup', async () => {
    let notify: (entries: { target: Element }[]) => void = () => {};
    const observed = new Set<Element>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: typeof notify) {
          notify = cb;
        }
        observe(el: Element) {
          observed.add(el);
        }
        unobserve(el: Element) {
          observed.delete(el);
        }
      }
    );
    const { refitOnWidthChange } = await import('../fieldHeight');
    const a = field(300, 1);
    const b = field(300, 1);
    const own = field(300, 1);
    own.el.dataset.ownHeight = '1';
    const stops = [a, b, own].map((f) => refitOnWidthChange(f.el));
    expect(observed.size).toBe(3);

    a.resize(150, 3);
    own.resize(150, 3);
    notify([a, b, own].map((f) => ({ target: f.el })));
    expect(a.el.style.height).toBe('60px');
    // Width unchanged: left alone; the code editor sizes its own field
    expect(b.el.style.height).toBe('');
    expect(own.el.style.height).toBe('');

    stops.forEach((stop) => stop());
    expect(observed.size).toBe(0);
  });
});
