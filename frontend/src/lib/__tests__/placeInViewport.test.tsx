import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { placeInViewport } from '../placeInViewport';
import { useDismiss } from '../useDismiss';

const size = { width: 200, height: 100 };

describe('placeInViewport', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  it('opens below the anchor with the gap', () => {
    expect(placeInViewport({ left: 100, top: 50, right: 140, bottom: 70 }, size, { gap: 4 })).toEqual({ left: 100, top: 74, above: false });
  });

  it('flips above when the bottom has no room, and pushes left at the right edge', () => {
    expect(placeInViewport({ left: 950, top: 750 }, size)).toEqual({ left: 1000 - 200 - 8, top: 750 - 100 - 8, above: true });
  });

  it('aligns its right edge at the anchor and stays 8 px from the left and top', () => {
    expect(placeInViewport({ left: 500, top: 100 }, size, { align: 'end', shift: -12 })).toEqual({ left: 312, top: 108, above: false });
    expect(placeInViewport({ left: 50, top: 100 }, size, { align: 'end' })).toEqual({ left: 8, top: 108, above: false });
  });
});

function Menu({ onClose, escape }: { onClose: () => void; escape?: boolean | 'unhandled' }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose, { escape });
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

  it("'unhandled' leaves an Escape that something inside took", () => {
    const onClose = vi.fn();
    render(<Menu onClose={onClose} escape="unhandled" />);
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(onClose).not.toHaveBeenCalled();
  });
});
