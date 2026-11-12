import { describe, it, expect, vi, afterEach } from 'vitest';

// A field whose text needs `lines` lines of 20 px at its current width
function field(width: number, lines: number) {
  const el = document.createElement('textarea');
  let w = width;
  Object.defineProperty(el, 'clientWidth', { get: () => w, configurable: true });
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

  it('takes the width a field was fitted at, without measuring it again', async () => {
    let notify: (entries: { target: Element }[]) => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: typeof notify) {
          notify = cb;
        }
        observe() {}
        unobserve() {}
      }
    );
    const { fitFieldHeight, refitOnWidthChange } = await import('../fieldHeight');
    const f = field(300, 2);
    let widthReads = 0;
    let heightAtWidthRead = '';
    Object.defineProperty(f.el, 'clientWidth', {
      get: () => {
        widthReads++;
        heightAtWidthRead = f.el.style.height;
        return 300;
      },
    });
    fitFieldHeight(f.el);
    expect(f.el.style.height).toBe('40px');
    // Read right after the measurement, before the new height invalidates the layout again
    expect(widthReads).toBe(1);
    expect(heightAtWidthRead).toBe('auto');
    const stop = refitOnWidthChange(f.el);
    expect(widthReads).toBe(1);

    // The observer's first report with the same width leaves the field alone
    f.el.style.height = '1px';
    notify([{ target: f.el }]);
    expect(f.el.style.height).toBe('1px');
    stop();
  });
});
