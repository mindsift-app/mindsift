import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const getAuthStatus = vi.fn();
const transcribe = vi.fn();
vi.mock('../api', () => ({ api: { getAuthStatus: (...a: any[]) => getAuthStatus(...a), transcribe: (...a: any[]) => transcribe(...a) } }));

import { useVoiceInput } from '../useVoiceInput';
import { resetVoiceConfig } from '../voice';

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: any) {}
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();

beforeEach(() => {
  resetVoiceConfig();
  getAuthStatus.mockReset();
  transcribe.mockReset();
  stopTrack.mockReset();
  (window as any).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  });
});

afterEach(() => {
  delete (window as any).MediaRecorder;
  delete (window as any).SpeechRecognition;
  vi.useRealTimers();
});

describe('useVoiceInput', () => {
  it('server mode: records, sends the audio to the own server and returns its text', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'server', maxSeconds: 600 } });
    transcribe.mockResolvedValue('Milch kaufen');
    const onText = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onText }));
    await waitFor(() => expect(result.current.mode).toBe('server'));
    expect(result.current.available).toBe(true);

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('listening');

    await act(async () => {
      await result.current.stop();
    });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect((transcribe.mock.calls[0][0] as Blob).type).toBe('audio/webm;codecs=opus');
    expect(onText).toHaveBeenCalledWith('Milch kaufen', true);
    expect(result.current.state).toBe('idle');
    expect(stopTrack).toHaveBeenCalled(); // microphone released
  });

  it('server mode: cancel throws the recording away', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'server', maxSeconds: 600 } });
    const onText = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onText }));
    await waitFor(() => expect(result.current.mode).toBe('server'));
    await act(async () => {
      await result.current.start();
    });
    act(() => result.current.cancel());
    expect(transcribe).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('server mode: a failing server reports an error instead of text', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'server', maxSeconds: 600 } });
    transcribe.mockRejectedValue(new Error('Spracherkennung fehlgeschlagen'));
    const onText = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onText, onError }));
    await waitFor(() => expect(result.current.mode).toBe('server'));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(onError).toHaveBeenCalledWith('Spracherkennung fehlgeschlagen');
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('server mode: stops by itself after the maximum length', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'server', maxSeconds: 5 } });
    transcribe.mockResolvedValue('Zu lang');
    const onText = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onText }));
    await waitFor(() => expect(result.current.mode).toBe('server'));
    vi.useFakeTimers();
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    vi.useRealTimers();
    await waitFor(() => expect(onText).toHaveBeenCalledWith('Zu lang', true));
  });

  it('hides the microphone when switched off, and without browser recognition', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'off', maxSeconds: 600 } });
    const off = renderHook(() => useVoiceInput({ onText: vi.fn() }));
    await waitFor(() => expect(off.result.current.mode).toBe('off'));
    expect(off.result.current.available).toBe(false);

    resetVoiceConfig();
    getAuthStatus.mockResolvedValue({ voice: { mode: 'browser', maxSeconds: 600 } });
    const none = renderHook(() => useVoiceInput({ onText: vi.fn() }));
    await waitFor(() => expect(none.result.current.mode).toBe('unsupported'));
    expect(none.result.current.available).toBe(false);
  });

  it('browser mode with live=true: restarts on pause (onend), keeps base text, rate-limits restarts to 300ms, and sends final=true only on stop()', async () => {
    const instances: any[] = [];
    class FakeSpeechRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        instances.push(this);
      }
      start() {}
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    (window as any).SpeechRecognition = FakeSpeechRecognition;
    getAuthStatus.mockResolvedValue({ voice: { mode: 'browser', maxSeconds: 600 } });

    const onText = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onText, live: true }));
    await waitFor(() => expect(result.current.mode).toBe('browser'));

    vi.useFakeTimers();
    await act(async () => {
      await result.current.start();
    });
    expect(instances).toHaveLength(1);

    // First utterance before a pause
    act(() => {
      instances[0].onresult?.({ results: [[{ transcript: 'Erster Satz.' }]] });
    });
    expect(onText).toHaveBeenLastCalledWith('Erster Satz.', false);

    // Browser ends recognition on speech pause -> immediate restart (#2)
    act(() => {
      instances[0].onend?.();
    });
    expect(instances).toHaveLength(2);
    expect(onText).not.toHaveBeenCalledWith(expect.anything(), true);

    // Another immediate onend within <300ms waits until 300ms have passed
    act(() => {
      instances[1].onend?.();
    });
    expect(instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(instances).toHaveLength(3);

    // Second utterance appends to base text
    act(() => {
      instances[2].onresult?.({ results: [[{ transcript: 'Zweiter Satz.' }]] });
    });
    expect(onText).toHaveBeenLastCalledWith('Erster Satz. Zweiter Satz.', false);

    // Explicit stop() finishes with final=true
    await act(async () => {
      await result.current.stop();
    });
    expect(onText).toHaveBeenLastCalledWith('Erster Satz. Zweiter Satz.', true);
    expect(result.current.state).toBe('idle');
  });

  it('server mode: every microphone sends the recording in pieces by default, the text arrives while speaking', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'server', maxSeconds: 600 } });
    transcribe.mockResolvedValueOnce('Erster Teil').mockResolvedValueOnce('zweiter Teil');
    const onText = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onText }));
    await waitFor(() => expect(result.current.mode).toBe('server'));

    vi.useFakeTimers();
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenLastCalledWith('Erster Teil', false);
    expect(result.current.state).toBe('listening');

    await act(async () => {
      await result.current.stop();
    });
    vi.useRealTimers();
    await waitFor(() => expect(onText).toHaveBeenLastCalledWith('Erster Teil zweiter Teil', true));
  });

  it('server mode with live=true: cuts segments onto new MediaRecorders on the same stream, orders out-of-order responses by chunk index, and releases stream at the end', async () => {
    getAuthStatus.mockResolvedValue({ voice: { mode: 'server', maxSeconds: 600 } });

    const resolvers: Array<(text: string) => void> = [];
    transcribe.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        })
    );

    const onText = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onText, live: true }));
    await waitFor(() => expect(result.current.mode).toBe('server'));

    vi.useFakeTimers();
    await act(async () => {
      await result.current.start();
    });

    // Advance 8s -> segment 0 is cut and sent to transcribe, stream is NOT released yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(stopTrack).not.toHaveBeenCalled();

    // Advance 4s and stop -> segment 1 (final) is sent to transcribe, stream IS released now
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
      await result.current.stop();
    });
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(stopTrack).toHaveBeenCalledTimes(1);

    // Resolve chunk 1 BEFORE chunk 0 to verify index-based ordering
    await act(async () => {
      resolvers[1]('zweiter Teil');
    });
    expect(onText).toHaveBeenLastCalledWith('zweiter Teil', false);

    // Now resolve chunk 0 -> both chunks are done, ordered "Erster Teil zweiter Teil" with final=true
    await act(async () => {
      resolvers[0]('Erster Teil');
    });
    expect(onText).toHaveBeenLastCalledWith('Erster Teil zweiter Teil', true);
    expect(result.current.state).toBe('idle');
  });
});
