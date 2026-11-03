import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useKeyboardInset } from '../useKeyboardInset';

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
