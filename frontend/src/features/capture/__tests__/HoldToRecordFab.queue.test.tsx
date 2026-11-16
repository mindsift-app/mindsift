import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { VoiceInputOptions } from '../../../lib/useVoiceInput';

// The phone's + with the own Whisper server: the voice service as a stand-in, the test decides what is
// recognised and when (HoldToRecordFab.test.tsx covers the browser's recognition)
const voice = vi.hoisted(() => ({
  options: null as VoiceInputOptions | null,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../../../lib/useVoiceInput', () => ({
  useVoiceInput: (options: VoiceInputOptions) => {
    voice.options = options;
    return {
      mode: 'server',
      available: true,
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

import { HoldToRecordFab } from '../HoldToRecordFab';

const deferred = () => {
  let resolve!: (t: string) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// The recording handed on at its end, transcribed in the background
const handOver = (text: () => Promise<string>, retry?: () => Promise<string>) => {
  act(() => {
    voice.options!.onRecorded!({ result: text, retry: retry ?? text, discard: vi.fn() } as never);
  });
};

function setup() {
  const onTap = vi.fn();
  const onTranscript = vi.fn().mockResolvedValue(undefined);
  render(<HoldToRecordFab onTap={onTap} onTranscript={onTranscript} />);
  const btn = screen.getByRole('button', { name: /gedrückt halten zum Sprechen/i });
  return { btn, onTap, onTranscript };
}

const hold = (btn: HTMLElement) => {
  fireEvent.pointerDown(btn, { clientY: 600, button: 0, pointerType: 'touch' });
  act(() => {
    vi.advanceTimersByTime(350);
  });
};
const release = (btn: HTMLElement) => {
  fireEvent.pointerUp(btn, { clientY: 600, pointerType: 'touch' });
  fireEvent.click(btn);
};

describe('HoldToRecordFab queue (own Whisper server)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    voice.options = null;
    voice.start.mockReset();
    voice.stop.mockReset();
    voice.cancel.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is free again right after the release, counts the waiting dictations and saves them in order', async () => {
    const { btn, onTap, onTranscript } = setup();
    const first = deferred();
    const second = deferred();

    hold(btn);
    voice.stop.mockImplementationOnce(() => handOver(() => first.promise));
    release(btn);
    expect(btn.getAttribute('data-dictation')).toBe('saving');
    expect(screen.getByLabelText('1')).toBeTruthy();

    hold(btn);
    expect(voice.start).toHaveBeenCalledTimes(2);
    expect(btn.getAttribute('data-dictation')).toBe('recording');
    voice.stop.mockImplementationOnce(() => handOver(() => second.promise));
    release(btn);
    expect(screen.getByLabelText('2')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('2 Diktate werden gespeichert');

    await act(async () => {
      second.resolve('Zweites Diktat');
    });
    expect(onTranscript).not.toHaveBeenCalled();
    await act(async () => {
      first.resolve('Erstes Diktat');
    });
    expect(onTranscript.mock.calls.map((c) => c[0])).toEqual(['Erstes Diktat', 'Zweites Diktat']);
    expect(screen.getByRole('status').textContent).toContain('Im Quick Dump gespeichert');
    expect(screen.queryByLabelText('1')).toBeNull();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('opens the capture sheet on a tap while dictations are still waiting', () => {
    const { btn, onTap } = setup();
    hold(btn);
    voice.stop.mockImplementationOnce(() => handOver(() => new Promise<string>(() => {})));
    release(btn);
    expect(onTap).not.toHaveBeenCalled();
    fireEvent.pointerDown(btn, { clientY: 600, button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(btn, { clientY: 600, pointerType: 'touch' });
    fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed dictation with "Erneut versuchen" only, and saves it on a tap there', async () => {
    const { btn, onTranscript } = setup();
    const retry = vi.fn(() => Promise.resolve('Zahnarzt anrufen'));
    hold(btn);
    voice.stop.mockImplementationOnce(() => handOver(() => Promise.reject(new Error('Spracherkennung hat zu lange gedauert')), retry));
    release(btn);
    await act(async () => {});

    expect(screen.getByRole('status').textContent).toContain('Diktat nicht gespeichert: Spracherkennung hat zu lange gedauert');
    expect(screen.getByLabelText('1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /verwerfen/i })).toBeNull();
    const retryBtn = screen.getByRole('button', { name: 'Erneut versuchen' });
    expect(retryBtn.className).toContain('min-h-[44px]');

    await act(async () => {
      fireEvent.click(retryBtn);
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith('Zahnarzt anrufen');
    expect(screen.queryByLabelText('1')).toBeNull();
  });

  it('throws a locked recording away with the ×: nothing is handed on or saved', async () => {
    const { btn, onTranscript } = setup();
    hold(btn);
    fireEvent.pointerMove(btn, { clientY: 520, pointerType: 'touch' });
    fireEvent.pointerUp(btn, { clientY: 520, pointerType: 'touch' });
    expect(btn.getAttribute('data-locked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Aufnahme verwerfen' }));
    expect(voice.cancel).toHaveBeenCalledTimes(1);
    expect(voice.stop).not.toHaveBeenCalled();
    await act(async () => {});
    expect(onTranscript).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('1')).toBeNull();
  });
});
