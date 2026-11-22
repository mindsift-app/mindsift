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

describe('VoiceRecorder.level', () => {
  // The analyser hands out whatever the test puts into `next` (bytes, 128 = zero line)
  let next = 128;
  class FakeAudioContext {
    createMediaStreamSource() {
      return { connect: () => {} };
    }
    createAnalyser() {
      return {
        fftSize: 0,
        getByteTimeDomainData: (b: Uint8Array) => b.forEach((_, i) => (b[i] = i % 2 ? next : 256 - next)),
      };
    }
    resume() {
      return Promise.resolve();
    }
  }

  afterEach(() => {
    Reflect.deleteProperty(window, 'AudioContext');
    vi.restoreAllMocks();
  });

  it('überbrückt kurze Lücken ohne Signal (WebKitGTK), längere Stille zählt', async () => {
    Object.assign(window, { AudioContext: FakeAudioContext });
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const rec = new VoiceRecorder();
    await rec.start();
    next = 160;
    const loud = rec.level()!;
    expect(loud).toBeGreaterThan(0.5);
    next = 128; // a gap: the level stays
    now += 200;
    expect(rec.level()).toBe(loud);
    now += 200; // silent for longer than the hold: really silent
    expect(rec.level()).toBe(0);
  });
});
