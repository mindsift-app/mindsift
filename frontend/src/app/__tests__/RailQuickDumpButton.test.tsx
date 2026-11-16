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

  it('names a recognised date in the tip, keeps it there with Rückgängig and takes the date back on click', async () => {
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
    const undo = vi.fn().mockResolvedValue(undefined);
    const { btn, onDictated, onQuickDump } = setup();
    onDictated.mockResolvedValue({ due: '2026-11-17T14:00', undo });
    hold(btn);
    releaseAt(20, 110);
    fireEvent.click(btn);
    await act(async () => {
      voice.options!.onText('Zahnarzt morgen um 14 Uhr', true);
    });
    expect(onDictated).toHaveBeenCalledWith('Zahnarzt morgen um 14 Uhr');
    expect(screen.getByRole('status').textContent).toContain('Im Quick Dump gespeichert · Fällig: Morgen, 14:00');

    // Still there after the check mark would have gone, and the + opens the window meanwhile
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(btn, { detail: 0 });
    expect(onQuickDump).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
    expect(btn.getAttribute('data-dictation')).toBeNull();
  });

  it('lets the date hint go by itself after a few seconds', async () => {
    const undo = vi.fn();
    const { btn, onDictated } = setup();
    onDictated.mockResolvedValue({ due: '2026-11-17', undo });
    hold(btn);
    releaseAt(20, 110);
    await act(async () => {
      voice.options!.onText('Zahnarzt morgen', true);
    });
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(undo).not.toHaveBeenCalled();
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

  // The own Whisper server: a released recording is handed on (onRecorded) and transcribed in the background
  const handOver = (text: () => Promise<string>, retry?: () => Promise<string>) => {
    act(() => {
      voice.options!.onRecorded!({ result: text, retry: retry ?? text, discard: vi.fn() } as never);
    });
  };
  const deferred = () => {
    let resolve!: (t: string) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('can be held again while the last dictation is still transcribed, and saves both in order', async () => {
    voice.mode = 'server';
    const { btn, onDictated, onQuickDump } = setup();
    const first = deferred();
    const second = deferred();

    hold(btn);
    voice.stop.mockImplementationOnce(() => handOver(() => first.promise));
    releaseAt(20, 110);
    fireEvent.click(btn);
    expect(btn.getAttribute('data-dictation')).toBe('saving');
    expect(screen.getByLabelText('1')).toBeTruthy();

    // Held again right away: a second recording starts
    hold(btn);
    expect(voice.start).toHaveBeenCalledTimes(2);
    expect(btn.getAttribute('data-dictation')).toBe('recording');
    voice.stop.mockImplementationOnce(() => handOver(() => second.promise));
    releaseAt(20, 110);
    fireEvent.click(btn);
    expect(screen.getByLabelText('2')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('2 Diktate werden gespeichert');

    await act(async () => {
      second.resolve('Zweites Diktat');
    });
    expect(onDictated).not.toHaveBeenCalled();
    await act(async () => {
      first.resolve('Erstes Diktat');
    });
    expect(onDictated.mock.calls.map((c) => c[0])).toEqual(['Erstes Diktat', 'Zweites Diktat']);
    expect(btn.getAttribute('data-dictation')).toBe('done');
    expect(screen.queryByLabelText('1')).toBeNull();
    expect(onQuickDump).not.toHaveBeenCalled();
  });

  it('opens the window on a click while dictations are still waiting', () => {
    voice.mode = 'server';
    const { btn, onQuickDump } = setup();
    hold(btn);
    voice.stop.mockImplementationOnce(() => handOver(() => new Promise<string>(() => {})));
    releaseAt(20, 110);
    fireEvent.click(btn);
    expect(onQuickDump).not.toHaveBeenCalled();
    fireEvent.click(btn, { detail: 0 });
    expect(onQuickDump).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed dictation, saves the next one and saves the failed one on "Erneut versuchen"', async () => {
    voice.mode = 'server';
    const { btn, onDictated } = setup();
    const retry = vi.fn(() => Promise.resolve('Zahnarzt anrufen'));

    hold(btn);
    voice.stop.mockImplementationOnce(() => handOver(() => Promise.reject(new Error('Spracherkennung hat zu lange gedauert')), retry));
    releaseAt(20, 110);
    hold(btn);
    voice.stop.mockImplementationOnce(() => handOver(() => Promise.resolve('Milch kaufen')));
    releaseAt(20, 110);
    await act(async () => {});

    expect(showError).toHaveBeenCalledWith('Spracherkennung hat zu lange gedauert');
    expect(onDictated.mock.calls.map((c) => c[0])).toEqual(['Milch kaufen']);
    expect(screen.getByRole('status').textContent).toContain('Diktat nicht gespeichert: Spracherkennung hat zu lange gedauert');
    expect(screen.getByLabelText('1')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onDictated.mock.calls.map((c) => c[0])).toEqual(['Milch kaufen', 'Zahnarzt anrufen']);
    expect(screen.queryByLabelText('1')).toBeNull();
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
