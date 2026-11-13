// Voice input for all places with a microphone button. The server decides how it works (STT_* in the
// environment, reported by /auth/status):
//   server   record with MediaRecorder, the own Whisper server turns it into text after stopping
//   browser  the browser's speech recognition (Chrome, Edge, Safari; text appears while speaking)
//   off      no voice input
// With a Whisper server everyone may pick the browser instead (account setting), unless the server
// forbids it (STT_ALLOW_BROWSER=false).
import { api } from './api';
import type { VoiceMode } from './types';
import { voiceLanguageTag } from './voiceLanguages';

export type EffectiveVoiceMode = VoiceMode | 'unsupported';

export interface VoiceConfig {
  mode: EffectiveVoiceMode;
  maxSeconds: number;
}

let configPromise: Promise<VoiceConfig> | null = null;
let loadedConfig: VoiceConfig | null = null;
let serverMode: VoiceMode | undefined;
let browserAllowed = true;
let preference: '' | 'browser' = '';
let spokenLanguage = '';

/** Fired when the effective mode changes (the account setting was loaded or changed). */
export const VOICE_CONFIG_EVENT = 'mindsift:voice-config';

function applyPreference(mode: VoiceMode | undefined): VoiceMode | undefined {
  return mode === 'server' && browserAllowed && preference === 'browser' ? 'browser' : mode;
}

/** The account's choice ('' = Whisper server, 'browser'); set when the user is loaded or changes it. */
export function setVoicePreference(next: '' | 'browser' | undefined): void {
  const value = next === 'browser' ? 'browser' : '';
  if (value === preference) return;
  preference = value;
  if (loadedConfig) {
    loadedConfig = { ...loadedConfig, mode: effectiveMode(applyPreference(serverMode)) };
    configPromise = Promise.resolve(loadedConfig);
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VOICE_CONFIG_EVENT));
}

/** The account's language for voice input ('' or 'auto' = Whisper detects it, 'app' = app language, else a code). */
export function setVoiceLanguage(next: string | undefined): void {
  spokenLanguage = next || '';
}

/** Language for the browser's recognition: the chosen one, else the app's (it cannot detect languages). */
export function browserVoiceLanguage(appLocale: string): string {
  return spokenLanguage && spokenLanguage !== 'auto' && spokenLanguage !== 'app' ? voiceLanguageTag(spokenLanguage) : appLocale;
}

/** Whether the account may choose between the Whisper server and the browser. */
export function voiceChoiceAvailable(): boolean {
  return serverMode === 'server' && browserAllowed;
}

/** The Web Speech API's recognizer, as far as MindSift uses it (TypeScript's DOM types do not have it). */
export interface BrowserRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}
export type BrowserRecognitionClass = new () => BrowserRecognition;

// Chrome and Safari still name the recognizer and the audio context with their prefix
type PrefixedWindow = Window & {
  SpeechRecognition?: BrowserRecognitionClass;
  webkitSpeechRecognition?: BrowserRecognitionClass;
  webkitAudioContext?: typeof AudioContext;
};

export function browserRecognition(): BrowserRecognitionClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as PrefixedWindow;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function canRecord(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** What this browser can actually do with the server's setting. */
export function effectiveMode(mode: VoiceMode | undefined): EffectiveVoiceMode {
  if (mode === 'off') return 'off';
  if (mode === 'server') return canRecord() ? 'server' : 'unsupported';
  return browserRecognition() ? 'browser' : 'unsupported';
}

/** Loaded once per page; the setting only changes with a server restart. */
export function loadVoiceConfig(): Promise<VoiceConfig> {
  if (!configPromise) {
    configPromise = api
      .getAuthStatus()
      .then((st) => {
        serverMode = st.voice?.mode;
        browserAllowed = st.voice?.browserAllowed !== false;
        loadedConfig = { mode: effectiveMode(applyPreference(serverMode)), maxSeconds: st.voice?.maxSeconds || 600 };
        return loadedConfig;
      })
      .catch(() => {
        configPromise = null; // offline at start: ask again next time
        return { mode: effectiveMode('browser'), maxSeconds: 600 };
      });
  }
  return configPromise;
}

/** The setting if already loaded; until then the browser's recognition (a button must react at once). */
export function currentVoiceConfig(): VoiceConfig {
  return loadedConfig ?? { mode: effectiveMode('browser'), maxSeconds: 600 };
}

/** For tests. */
export function resetVoiceConfig(): void {
  configPromise = null;
  loadedConfig = null;
  serverMode = undefined;
  browserAllowed = true;
  preference = '';
  spokenLanguage = '';
}

// Containers in order of preference; Safari only records MP4/AAC
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function recordingType(): string | undefined {
  const MR: typeof MediaRecorder | undefined = window.MediaRecorder;
  if (!MR?.isTypeSupported) return undefined;
  return RECORDING_TYPES.find((t) => MR.isTypeSupported(t));
}

/**
 * One recording from the microphone, with a live input level for wave animations. stop() resolves
 * with the audio; cancel() throws it away.
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array | null = null;
  private done: ((blob: Blob | null) => void) | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.startSegmentRecorder();
    try {
      const Ctx = window.AudioContext || (window as PrefixedWindow).webkitAudioContext;
      if (!Ctx) throw new Error('no AudioContext');
      this.audioCtx = new Ctx();
      const source = this.audioCtx!.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx!.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);
      this.samples = new Uint8Array(this.analyser.fftSize);
      void this.audioCtx!.resume?.();
    } catch {
      this.analyser = null; // no level, the recording still works
    }
  }

  private startSegmentRecorder(): void {
    if (!this.stream) return;
    const type = recordingType();
    const rec = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = chunks.length ? new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }) : null;
      this.release();
      this.done?.(blob);
      this.done = null;
    };
    this.recorder = rec;
    this.chunks = chunks;
    rec.start(1000);
  }

  /** Input level 0..1 (roughly loudness), or null when unknown. */
  level(): number | null {
    if (!this.analyser || !this.samples) return null;
    this.analyser.getByteTimeDomainData(this.samples as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (const v of this.samples) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        this.release();
        resolve(null);
        return;
      }
      this.done = resolve;
      this.recorder.stop();
    });
  }

  /**
   * Stops the current MediaRecorder segment and immediately starts a new one on the same MediaStream.
   * Resolves with the finished segment's audio Blob while recording continues seamlessly.
   */
  cutSegment(): Promise<Blob | null> {
    if (!this.stream || !this.recorder || this.recorder.state === 'inactive') {
      return Promise.resolve(null);
    }
    const oldRecorder = this.recorder;
    const oldChunks = this.chunks;

    this.startSegmentRecorder();

    return new Promise((resolve) => {
      oldRecorder.onstop = () => {
        const blob = oldChunks.length
          ? new Blob(oldChunks, { type: oldRecorder.mimeType || 'audio/webm' })
          : null;
        resolve(blob);
      };
      oldRecorder.stop();
    });
  }

  cancel(): void {
    this.done = null;
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = () => this.release();
      this.recorder.stop();
    } else {
      this.release();
    }
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audioCtx?.close?.().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
  }
}

/**
 * Text of one speech recognition session from its results. Desktop browsers deliver consecutive
 * pieces ("test 1 2 3", " and on"); Chrome on Android also keeps the growing interim states of
 * the same phrase as results of their own ("Test", "Test", "Test 1 2 3"). A result that only
 * continues the one before it therefore replaces it instead of being appended.
 */
export function joinSpeechResults(transcripts: string[]): string {
  const norm = (s: string) => s.trim().toLowerCase();
  let text = '';
  let last = '';
  for (const t of transcripts) {
    if (!t) continue;
    if (last && norm(t).startsWith(norm(last))) {
      text = text.slice(0, text.length - last.length) + t; // grown version of the same phrase
    } else if (last && norm(last).startsWith(norm(t))) {
      continue; // an earlier, shorter state of it
    } else {
      text += t;
    }
    last = t;
  }
  return text;
}
