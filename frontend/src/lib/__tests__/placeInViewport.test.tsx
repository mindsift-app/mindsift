import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef, useState } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { placeInViewport } from '../placeInViewport';
import { useCloseOnEscape, useDismiss } from '../useDismiss';

const size = { width: 200, height: 100 };

describe('placeInViewport', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  it('opens below the anchor with the gap', () => {
    expect(placeInViewport({ left: 100, top: 50, right: 140, bottom: 70 }, size, { gap: 4 })).toMatchObject({ left: 100, top: 74, above: false });
  });

  it('flips above when the bottom has no room, and pushes left at the right edge', () => {
    expect(placeInViewport({ left: 950, top: 750 }, size)).toMatchObject({ left: 1000 - 200 - 8, top: 750 - 100 - 8, above: true });
  });

  it('aligns its right edge at the anchor and stays 8 px from the left and top', () => {
    expect(placeInViewport({ left: 500, top: 100 }, size, { align: 'end', shift: -12 })).toMatchObject({ left: 312, top: 108, above: false });
    expect(placeInViewport({ left: 50, top: 100 }, size, { align: 'end' })).toMatchObject({ left: 8, top: 108, above: false });
  });

  it('shrink: stays below with the room there, flips above only where there is more room', () => {
    // Below: 800 - 8 - (600 + 4) = 188 of the wanted 300; above: 580 - 4 - 8 = 568
    expect(placeInViewport({ left: 100, top: 580, bottom: 600 }, { width: 200, height: 300 }, { gap: 4, shrink: true })).toEqual({
      left: 100,
      top: 580 - 4 - 300,
      above: true,
      maxHeight: 300,
    });
    // Little room on both sides: the larger one, shortened to it
    expect(placeInViewport({ left: 100, top: 300, bottom: 320 }, { width: 200, height: 900 }, { gap: 4, shrink: true })).toEqual({
      left: 100,
      top: 324,
      above: false,
      maxHeight: 800 - 8 - 324,
    });
  });
});

function Menu({ onClose, escape, passThrough, active }: { onClose: () => void; escape?: boolean | 'unhandled'; passThrough?: boolean; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose, { escape, passThrough, active });
  return (
    <div>
      <div ref={ref}>innen</div>
      <span>außen</span>
    </div>
  );
}

describe('useDismiss', () => {
  it('closes on a press outside and on Escape, not on a press inside', () => {
    const onClose = vi.fn();
    const { getByText } = render(<Menu onClose={onClose} />);
    fireEvent.pointerDown(getByText('innen'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(getByText('außen'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('leaves an Escape that something inside took (default prevented)', () => {
    const onClose = vi.fn();
    render(<Menu onClose={onClose} />);
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the press that closes it reaches nothing below: no pointer down, no mouse down, no click', () => {
    const onClose = vi.fn();
    const below = { down: vi.fn(), mouse: vi.fn(), click: vi.fn() };
    const { getByText, rerender } = render(<Menu onClose={onClose} />);
    const target = getByText('außen');
    target.addEventListener('pointerdown', below.down);
    target.addEventListener('mousedown', below.mouse);
    target.addEventListener('click', below.click);
    fireEvent.pointerDown(target, { pointerType: 'touch' });
    fireEvent.pointerUp(target, { pointerType: 'touch' });
    fireEvent.mouseDown(target);
    fireEvent.mouseUp(target);
    const click = fireEvent.click(target);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(below.down).not.toHaveBeenCalled();
    expect(below.mouse).not.toHaveBeenCalled();
    expect(below.click).not.toHaveBeenCalled();
    // The click lost its default too (a link, a checkbox)
    expect(click).toBe(false);
    // Closed, the next press is an ordinary one again
    rerender(<Menu onClose={onClose} active={false} />);
    fireEvent.pointerDown(target);
    fireEvent.click(target);
    expect(below.down).toHaveBeenCalledTimes(1);
    expect(below.click).toHaveBeenCalledTimes(1);
  });

  it('a mouse press without pointer events (older browsers) is swallowed the same way', () => {
    const onClose = vi.fn();
    const click = vi.fn();
    const { getByText } = render(<Menu onClose={onClose} />);
    getByText('außen').addEventListener('click', click);
    fireEvent.mouseDown(getByText('außen'));
    fireEvent.click(getByText('außen'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  });

  it('passThrough: the press closes it and still reaches its target', () => {
    const onClose = vi.fn();
    const click = vi.fn();
    const { getByText } = render(<Menu onClose={onClose} passThrough />);
    getByText('außen').addEventListener('click', click);
    fireEvent.pointerDown(getByText('außen'));
    fireEvent.pointerUp(getByText('außen'));
    fireEvent.click(getByText('außen'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });
});

// A dialog with a button that opens a second one, and a menu inside the second
function Stack({ log }: { log: (what: string) => void }) {
  const [second, setSecond] = useState(false);
  const [menu, setMenu] = useState(false);
  useCloseOnEscape(() => log('erster'));
  return (
    <div>
      <button type="button" onClick={() => setSecond(true)}>
        zweiter Dialog
      </button>
      {second && <Second log={log} onClose={() => setSecond(false)} menu={menu} setMenu={setMenu} />}
    </div>
  );
}

function Second({ log, onClose, menu, setMenu }: { log: (what: string) => void; onClose: () => void; menu: boolean; setMenu: (v: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnEscape(() => {
    log('zweiter');
    onClose();
  });
  useDismiss(
    ref,
    () => {
      log('menü');
      setMenu(false);
    },
    { active: menu }
  );
  return (
    <div>
      <button type="button" onClick={() => setMenu(true)}>
        Menü öffnen
      </button>
      {menu && <div ref={ref}>Menü</div>}
    </div>
  );
}

describe('the stack of layers', () => {
  it('Escape closes only the top layer: the menu, then the second dialog, then the first', () => {
    const log = vi.fn();
    const { getByText, queryByText } = render(<Stack log={log} />);
    fireEvent.click(getByText('zweiter Dialog'));
    fireEvent.click(getByText('Menü öffnen'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(log.mock.calls.flat()).toEqual(['menü']);
    expect(queryByText('Menü')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(log.mock.calls.flat()).toEqual(['menü', 'zweiter']);
    expect(queryByText('Menü öffnen')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(log.mock.calls.flat()).toEqual(['menü', 'zweiter', 'erster']);
  });

  it('a later window listener sees the Escape a layer took as handled', () => {
    const later = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
    window.addEventListener('keydown', later);
    render(<Stack log={() => {}} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(later).toHaveReturnedWith(true);
    window.removeEventListener('keydown', later);
  });

  it('a press beside the menu closes only the menu, not the dialog it lies in', () => {
    const log = vi.fn();
    const { getByText, queryByText } = render(<Stack log={log} />);
    fireEvent.click(getByText('zweiter Dialog'));
    fireEvent.click(getByText('Menü öffnen'));
    // The press lands on the first dialog's button: it only closes the menu
    fireEvent.pointerDown(getByText('zweiter Dialog'));
    fireEvent.pointerUp(getByText('zweiter Dialog'));
    fireEvent.click(getByText('Menü öffnen'));
    expect(log.mock.calls.flat()).toEqual(['menü']);
    // ... and its click was swallowed: the menu did not open again
    expect(queryByText('Menü')).toBeNull();
  });
});
