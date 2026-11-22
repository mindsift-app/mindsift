import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STOP_GRACE_MS, VoiceRecorder } from '../voice';

// A recorder like the WebKitGTK of the desktop app at its slowest: after stop() the last piece comes
// through requestData(), but the stop event only much later (or never)
class SlowMediaRecorder {
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
  static last: SlowMediaRecorder | null = null;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    SlowMediaRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  requestData() {
    this.ondataavailable?.({ data: new Blob(['ende'], { type: this.mimeType }) });
  }
  stop() {
    this.state = 'inactive';
  }
}

const stopTrack = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  stopTrack.mockReset();
  Object.assign(window, { MediaRecorder: SlowMediaRecorder });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'MediaRecorder');
  vi.useRealTimers();
});

describe('VoiceRecorder.stop', () => {
  it('hängt nicht, wenn der Browser das Ende der Aufnahme nicht meldet', async () => {
    const rec = new VoiceRecorder();
    await rec.start();
    SlowMediaRecorder.last!.ondataavailable?.({ data: new Blob(['anfang'], { type: 'audio/webm;codecs=opus' }) });
    let blob: Blob | null | undefined;
    void rec.stop().then((b) => (blob = b));
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 1);
    expect(blob).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(blob).toBeInstanceOf(Blob);
    expect(stopTrack).toHaveBeenCalled(); // microphone released
    // A late stop event changes nothing any more
    SlowMediaRecorder.last!.onstop?.();
    vi.useRealTimers(); // jsdom's FileReader runs on timers
    expect(new TextDecoder().decode(await blob!.arrayBuffer())).toBe('anfangende');
  });

  it('nimmt das Ergebnis des Browsers, wenn er rechtzeitig fertig wird', async () => {
    const rec = new VoiceRecorder();
    await rec.start();
    const done = rec.stop();
    SlowMediaRecorder.last!.onstop?.();
    const blob = await done;
    vi.useRealTimers();
    expect(new TextDecoder().decode(await blob!.arrayBuffer())).toBe('ende');
  });
});
