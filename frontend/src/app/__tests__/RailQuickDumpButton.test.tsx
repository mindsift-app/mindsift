import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { VoiceInputOptions } from '../../lib/useVoiceInput';

// The voice service as a stand-in: the test decides what is recognised and when
const voice = vi.hoisted(() => ({
  mode: 'browser' as string | null,
  options: null as VoiceInputOptions | null,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../../lib/useVoiceInput', () => ({
  useVoiceInput: (options: VoiceInputOptions) => {
    voice.options = options;
    return {
      mode: voice.mode,
      available: voice.mode === 'server' || voice.mode === 'browser',
      state: 'idle',
      pendingChunks: 0,
      start: voice.start,
      stop: voice.stop,
      cancel: voice.cancel,
      toggle: vi.fn(),
      level: () => null,
    };
  },
}));

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../components/ErrorNotice', () => ({ showError }));

import { RailQuickDumpButton } from '../RailQuickDumpButton';

const BUTTON_RECT = { left: 10, top: 100, right: 46, bottom: 136, width: 36, height: 36, x: 10, y: 100 };

function setup() {
  const onQuickDump = vi.fn();
  const onDictated = vi.fn().mockResolvedValue(undefined);
  render(<RailQuickDumpButton expanded={false} shortcut="C" onQuickDump={onQuickDump} onDictated={onDictated} />);
  const btn = screen.getByRole('button', { name: /Quick Dump/ });
  btn.getBoundingClientRect = () => ({ ...BUTTON_RECT, toJSON: () => ({}) }) as DOMRect;
  return { btn, onQuickDump, onDictated };
}

const press = (btn: HTMLElement) => fireEvent.pointerDown(btn, { button: 0, pointerType: 'mouse', clientX: 20, clientY: 110 });
const releaseAt = (x: number, y: number) => fireEvent.pointerUp(window, { clientX: x, clientY: y });
const hold = (btn: HTMLElement) => {
  press(btn);
  act(() => {
    vi.advanceTimersByTime(350);
  });
};

describe('RailQuickDumpButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    voice.mode = 'browser';
    voice.options = null;
    voice.start.mockReset();
    voice.stop.mockReset();
    voice.cancel.mockReset();
    showError.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says in its tip that holding it dictates', () => {
    setup();
    expect(screen.getByText(/Gedrückt halten zum Diktieren/)).toBeTruthy();
  });

  it('opens the Quick Dump window on a short click without recording', () => {
    const { btn, onQuickDump } = setup();
    press(btn);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    releaseAt(20, 110);
    fireEvent.click(btn);
    expect(onQuickDump).toHaveBeenCalledTimes(1);
    expect(voice.start).not.toHaveBeenCalled();
  });

  it('opens the window from the keyboard (click without a pointer)', () => {
    const { btn, onQuickDump } = setup();
    fireEvent.click(btn, { detail: 0 });
    expect(onQuickDump).toHaveBeenCalledTimes(1);
  });

  it('starts recording when held, saves to the inbox on release and shows the check mark', async () => {
    const { btn, onQuickDump, onDictated } = setup();
    hold(btn);
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('data-dictation')).toBe('recording');
    expect(screen.getByTestId('dictation-ring')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('status').textContent).toContain('0:02');

    releaseAt(20, 110);
    fireEvent.click(btn);
    expect(voice.stop).toHaveBeenCalledTimes(1);
    expect(onQuickDump).not.toHaveBeenCalled();
    expect(btn.getAttribute('data-dictation')).toBe('saving');
    expect(screen.getByTestId('dictation-spinner')).toBeTruthy();

    await act(async () => {
      voice.options!.onText('Zahnarzt anrufen', true);
    });
    expect(onDictated).toHaveBeenCalledWith('Zahnarzt anrufen');
    expect(btn.getAttribute('data-dictation')).toBe('done');
    expect(screen.getByRole('status').textContent).toContain('Im Quick Dump gespeichert');

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(btn.getAttribute('data-dictation')).toBeNull();
    // The next short click opens the window again
    fireEvent.click(btn, { detail: 0 });
    expect(onQuickDump).toHaveBeenCalledTimes(1);
  });

  it('throws the recording away when released beside the button', () => {
    const { btn, onQuickDump, onDictated } = setup();
    hold(btn);
    fireEvent.pointerMove(window, { clientX: 300, clientY: 110 });
    expect(screen.getByRole('status').textContent).toContain('Loslassen bricht ab');
    releaseAt(300, 110);
    expect(voice.cancel).toHaveBeenCalled();
    expect(voice.stop).not.toHaveBeenCalled();
    expect(onDictated).not.toHaveBeenCalled();
    expect(onQuickDump).not.toHaveBeenCalled();
    expect(btn.getAttribute('data-dictation')).toBeNull();
  });

  it('cancels with Escape while holding, and the release click opens nothing', () => {
    const { btn, onQuickDump, onDictated } = setup();
    hold(btn);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(voice.cancel).toHaveBeenCalled();
    releaseAt(20, 110);
    fireEvent.click(btn);
    expect(voice.stop).not.toHaveBeenCalled();
    expect(onDictated).not.toHaveBeenCalled();
    expect(onQuickDump).not.toHaveBeenCalled();
  });

  it('shows a hint and nothing else when the microphone is denied', () => {
    const { btn, onQuickDump, onDictated } = setup();
    hold(btn);
    act(() => {
      voice.options!.onError!('Mikrofon nicht freigegeben');
    });
    expect(showError).toHaveBeenCalledWith('Mikrofon nicht freigegeben');
    expect(btn.getAttribute('data-dictation')).toBeNull();
    releaseAt(20, 110);
    fireEvent.click(btn);
    expect(voice.stop).not.toHaveBeenCalled();
    expect(onDictated).not.toHaveBeenCalled();
    expect(onQuickDump).not.toHaveBeenCalled();
  });

  it('shows a hint without recording when voice input is switched off', () => {
    voice.mode = 'off';
    const { btn, onQuickDump } = setup();
    hold(btn);
    expect(voice.start).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('Spracheingabe ist ausgeschaltet');
    expect(btn.getAttribute('data-dictation')).toBeNull();
    releaseAt(20, 110);
    fireEvent.click(btn);
    expect(onQuickDump).not.toHaveBeenCalled();
  });

  it('saves nothing when nothing was recognised', async () => {
    const { btn, onDictated } = setup();
    hold(btn);
    releaseAt(20, 110);
    await act(async () => {
      voice.options!.onText('  ', true);
    });
    expect(onDictated).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Nichts erkannt');
  });

  it('ignores touch presses (they only click)', () => {
    const { btn, onQuickDump } = setup();
    fireEvent.pointerDown(btn, { button: 0, pointerType: 'touch', clientX: 20, clientY: 110 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(voice.start).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(onQuickDump).toHaveBeenCalledTimes(1);
  });
});
