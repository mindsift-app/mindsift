import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useKeyboardInset, useKeyboardRoom } from '../useKeyboardInset';

// Simulates iOS: the layout viewport keeps its height, the visual viewport shrinks by the keyboard
function mockVisualViewport(height: number) {
  const listeners: Record<string, (() => void)[]> = {};
  const vv = {
    height,
    offsetTop: 0,
    addEventListener: (t: string, fn: () => void) => (listeners[t] = [...(listeners[t] || []), fn]),
    removeEventListener: (t: string, fn: () => void) => (listeners[t] = (listeners[t] || []).filter((f) => f !== fn)),
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  return {
    open(keyboard: number) {
      vv.height = 844 - keyboard;
      (listeners.resize || []).forEach((fn) => fn());
    },
  };
}

describe('useKeyboardInset', () => {
  it('reports the keyboard height so sheets can sit above it', () => {
    const vv = mockVisualViewport(844);
    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current.inset).toBe(0);
    expect(result.current.keyboardOpen).toBe(false);
    act(() => vv.open(336));
    expect(result.current.inset).toBe(336);
    expect(result.current.visibleHeight).toBe(508);
    expect(result.current.keyboardOpen).toBe(true);
    act(() => vv.open(0));
    expect(result.current.inset).toBe(0);
    expect(result.current.keyboardOpen).toBe(false);
  });

  it('notices the keyboard also when the page shrinks instead (no inset)', () => {
    const vv = mockVisualViewport(844);
    const { result } = renderHook(() => useKeyboardInset());
    act(() => {
      Object.defineProperty(window, 'innerHeight', { value: 508, configurable: true });
      vv.open(336);
    });
    expect(result.current.inset).toBe(0);
    expect(result.current.keyboardOpen).toBe(true);
    // Browser bars appearing are not a keyboard
    act(() => {
      Object.defineProperty(window, 'innerHeight', { value: 788, configurable: true });
      vv.open(56);
    });
    expect(result.current.keyboardOpen).toBe(false);
  });
});

describe('useKeyboardRoom', () => {
  it('gives a centered form room for the keyboard and scrolls the focused field into view', () => {
    const vv = mockVisualViewport(844);
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const scroll = vi.fn();
    input.scrollIntoView = scroll;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const { result } = renderHook(() => useKeyboardRoom());
    expect(result.current).toBeUndefined();
    act(() => vv.open(336));
    expect(result.current).toEqual({ paddingBottom: 352 });
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    // Moving on to the next field scrolls that one into view too
    const next = document.createElement('input');
    document.body.appendChild(next);
    next.scrollIntoView = vi.fn();
    act(() => next.focus());
    expect(next.scrollIntoView).toHaveBeenCalled();
    act(() => vv.open(0));
    expect(result.current).toBeUndefined();
    raf.mockRestore();
    input.remove();
    next.remove();
  });
});
