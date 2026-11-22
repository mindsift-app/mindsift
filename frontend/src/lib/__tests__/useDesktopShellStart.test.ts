import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { desktopShellStart, useDesktopShellStart } from '../useDesktopShellStart';

afterEach(() => {
  delete window.__msDesktopShell;
});

describe('the desktop app on a server page', () => {
  it("only takes the app's own start view addresses", () => {
    expect(desktopShellStart()).toBeNull();
    window.__msDesktopShell = 'wails://localhost/__desktop/start';
    expect(desktopShellStart()).toBe('wails://localhost/__desktop/start');
    window.__msDesktopShell = 'http://wails.localhost/__desktop/start';
    expect(desktopShellStart()).toBe('http://wails.localhost/__desktop/start');
    for (const v of ['https://evil.example/', 'javascript:alert(1)', 'wails://localhost/', 42, null]) {
      window.__msDesktopShell = v;
      expect(desktopShellStart()).toBeNull();
    }
  });

  it('shows the way back once the app has marked the page', () => {
    const { result } = renderHook(() => useDesktopShellStart());
    expect(result.current).toBeNull();
    act(() => {
      window.__msDesktopShell = 'wails://localhost/__desktop/start';
      window.dispatchEvent(new Event('mindsift:desktop-shell'));
    });
    expect(result.current).toBe('wails://localhost/__desktop/start');
  });
});
