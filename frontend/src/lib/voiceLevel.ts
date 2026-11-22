// Display level of the microphone for the voice waves: RMS in dB over a speech range, an automatic
// gain that follows the recent peak, and fast-attack/slow-release smoothing. A plain linear RMS stayed
// tiny at ordinary microphone levels (speech sits around -40..-20 dBFS, a linear scale shows that as a
// few percent). Dictation's silence detection does not use this, it reads the raw signal.

/** Below this the bars rest (dBFS); quieter than the room noise of a laptop microphone. */
const FLOOR_DB = -52;
/** The scale's top end adapts between these (dBFS): a quiet microphone still reaches the top, a loud one is not blown up. */
const CEILING_MIN_DB = -34;
const CEILING_MAX_DB = -12;
const CEILING_START_DB = -26;
/** Headroom above the recent peak, so the peak lands just below the top (dB). */
const HEADROOM_DB = 4;
/** How fast the top end sinks again once the voice gets quieter (dB per second). */
const CEILING_RELEASE_DB_PER_S = 6;
const ATTACK_MS = 40;
const RELEASE_MS = 220;

/** Root mean square of 8-bit time-domain samples (128 = zero line), 0..1. */
export function rmsOfBytes(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const v of samples) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  return Math.sqrt(sum / samples.length);
}

export class LevelMeter {
  private ceilingDb = CEILING_START_DB;
  private shown = 0;
  private at: number | null = null;

  /** Takes the current RMS (0..1) and the time in ms, returns the display level 0..1. */
  push(rms: number, now: number): number {
    const first = this.at === null;
    const dt = first ? 0 : Math.min(1000, Math.max(0, now - (this.at as number)));
    this.at = now;
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const wanted = db + HEADROOM_DB;
    if (wanted >= this.ceilingDb) {
      this.ceilingDb = Math.min(CEILING_MAX_DB, wanted);
    } else {
      this.ceilingDb = Math.max(Math.max(CEILING_MIN_DB, wanted), this.ceilingDb - (CEILING_RELEASE_DB_PER_S * dt) / 1000);
    }
    const target = Math.max(0, Math.min(1, (db - FLOOR_DB) / (this.ceilingDb - FLOOR_DB)));
    if (first) {
      this.shown = target;
    } else {
      const tau = target > this.shown ? ATTACK_MS : RELEASE_MS;
      this.shown += (target - this.shown) * (1 - Math.exp(-dt / tau));
    }
    return this.shown < 0.005 ? 0 : this.shown;
  }
}
