import { describe, it, expect } from 'vitest';
import { LevelMeter, rmsOfBytes } from '../voiceLevel';

/** Feeds a constant RMS at 60 fps for the given seconds, returns all shown levels. */
function run(meter: LevelMeter, rms: number, seconds: number, start = 0): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds * 1000; t += 16) out.push(meter.push(rms, start + t));
  return out;
}

/** Speech-like: syllables of the given peak RMS with pauses in between. */
function speech(meter: LevelMeter, peak: number, seconds: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds * 1000; t += 16) {
    const env = Math.max(0, Math.sin((t / 1000) * Math.PI * 4)); // about 2 syllables a second with pauses
    out.push(meter.push(peak * env + 0.0005, t));
  }
  return out;
}

describe('LevelMeter', () => {
  it('rmsOfBytes: zero line is 0, full swing is 1', () => {
    expect(rmsOfBytes(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(rmsOfBytes(new Uint8Array([0, 255, 0, 255]))).toBeCloseTo(1, 1);
    expect(rmsOfBytes(new Uint8Array([]))).toBe(0);
  });

  it('shows quiet speech clearly (RMS 0.01, -40 dBFS)', () => {
    const levels = run(new LevelMeter(), 0.01, 0.5);
    expect(levels[levels.length - 1]).toBeGreaterThan(0.3);
  });

  it('shows speech-like input well at its peaks, from quiet to normal, and the pauses too', () => {
    for (const peak of [0.01, 0.03, 0.08]) {
      const levels = speech(new LevelMeter(), peak, 3);
      expect(Math.max(...levels)).toBeGreaterThan(0.5);
      expect(Math.min(...levels.slice(60))).toBeLessThan(0.3);
    }
  });

  it('keeps silence and room noise at 0', () => {
    expect(Math.max(...run(new LevelMeter(), 0, 2))).toBe(0);
    expect(Math.max(...run(new LevelMeter(), 0.0008, 2))).toBe(0); // -62 dBFS
  });

  it('saturates for loud input without jitter', () => {
    const levels = run(new LevelMeter(), 0.4, 1);
    const tail = levels.slice(10);
    expect(Math.min(...tail)).toBeGreaterThan(0.97);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.01);
  });

  it('attacks quickly and releases slowly', () => {
    const m = new LevelMeter();
    run(m, 0, 0.2);
    const up = m.push(0.1, 300);
    expect(up).toBeGreaterThan(0.3);
    const down = m.push(0, 316);
    expect(down).toBeGreaterThan(up * 0.8); // one frame of silence hardly moves it
  });
});
