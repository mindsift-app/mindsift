import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const askChoice = vi.hoisted(() => vi.fn());
vi.mock('../../components/askConfirm', () => ({ askChoice }));

import { guardLeave, holdLeave, holdUnload, unloadHeld } from '../leaveGuard';
import { setCurrentDesktop } from '../api/client';
import type { DesktopInfo } from '../types';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('leaveGuard', () => {
  const dictation = {};
  beforeEach(() => {
    askChoice.mockReset();
    holdLeave(dictation, false);
  });

  it('switches at once while nothing would be lost', () => {
    const go = vi.fn();
    guardLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(askChoice).not.toHaveBeenCalled();
  });

  it('asks during a dictation: "Trotzdem wechseln" switches, "Bleiben" or a click outside stays', async () => {
    holdLeave(dictation, true);
    const go = vi.fn();

    askChoice.mockResolvedValueOnce('alt');
    guardLeave(go);
    await flush();
    expect(askChoice).toHaveBeenCalledWith({ message: expect.stringContaining('Aufnahme'), confirmLabel: 'Trotzdem wechseln', altLabel: 'Bleiben' });
    expect(go).not.toHaveBeenCalled();

    askChoice.mockResolvedValueOnce(null);
    guardLeave(go);
    await flush();
    expect(go).not.toHaveBeenCalled();

    askChoice.mockResolvedValueOnce('confirm');
    guardLeave(go);
    await flush();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('asks "Trotzdem schließen" before a dialog with the dictation in it closes', async () => {
    holdLeave(dictation, true);
    const close = vi.fn();
    askChoice.mockResolvedValueOnce('confirm');
    guardLeave(close, { close: true });
    await flush();
    expect(askChoice).toHaveBeenCalledWith({ message: expect.stringContaining('Beim Schließen'), confirmLabel: 'Trotzdem schließen', altLabel: 'Bleiben' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('asks for a dictation of the caller\'s own (held), and not when the caller says nothing is held', async () => {
    const close = vi.fn();
    askChoice.mockResolvedValueOnce('alt');
    guardLeave(close, { close: true, held: true });
    await flush();
    expect(askChoice).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    holdLeave(dictation, true);
    guardLeave(close, { close: true, held: false });
    expect(close).toHaveBeenCalledTimes(1);
    expect(askChoice).toHaveBeenCalledTimes(1);
  });
});

describe('unload guard', () => {
  const recording = {};
  const unload = () => {
    const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(e);
    return e;
  };
  afterEach(() => {
    holdUnload(recording, false);
    setCurrentDesktop(null);
  });

  it('lets the browser ask before the page is left only while a recording is held', () => {
    expect(unloadHeld()).toBe(false);
    expect(unload().defaultPrevented).toBe(false);

    holdUnload(recording, true);
    expect(unloadHeld()).toBe(true);
    expect(unload().defaultPrevented).toBe(true);

    holdUnload(recording, false);
    expect(unload().defaultPrevented).toBe(false);
  });

  it('never asks in the desktop app', () => {
    setCurrentDesktop({} as DesktopInfo);
    holdUnload(recording, true);
    expect(unload().defaultPrevented).toBe(false);
  });
});
