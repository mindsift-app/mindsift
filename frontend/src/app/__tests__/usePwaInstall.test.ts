import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePwaInstall } from '../usePwaInstall';
import { setCurrentDesktop } from '../../lib/api/client';

beforeEach(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  setCurrentDesktop(null);
  sessionStorage.clear();
});

describe('usePwaInstall', () => {
  it('counts the desktop app as installed: no install button, no offer sheet', () => {
    setCurrentDesktop({ platform: 'linux', realtime: 'sse' });
    const { result } = renderHook(() => usePwaInstall('u1'));
    expect(result.current.isStandaloneApp).toBe(true);
    expect(result.current.showPwaInstallModal).toBe(false);
  });

  it('keeps offering the install in the browser', () => {
    const { result } = renderHook(() => usePwaInstall('u1'));
    expect(result.current.isStandaloneApp).toBe(false);
  });
});
