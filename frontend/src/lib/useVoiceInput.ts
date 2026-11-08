import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { browserRecognition, browserVoiceLanguage, currentVoiceConfig, EffectiveVoiceMode, joinSpeechResults, loadVoiceConfig, VOICE_CONFIG_EVENT, VoiceRecorder } from './voice';
import i18n, { currentLocale } from '../i18n';

export type VoiceState = 'idle' | 'listening' | 'transcribing';

export interface VoiceInputOptions {
  /** Text of the current recording; in browser mode repeatedly while speaking (final=false), always once at the end (final=true). */
  onText: (text: string, final: boolean) => void;
  onError?: (message: string) => void;
  /** Browser mode: keep listening through pauses (hold-to-record) instead of stopping after a sentence. */
  continuous?: boolean;
  /** Live dictation mode (/diktat): auto-restart browser speech recognition on pause, and chunk server recordings every ~8s or ~0.8s of silence. */
  live?: boolean;
  /** Server mode only: send the recording in chunks like live mode (every ~8 s or at a short pause), so the
   *  text arrives while speaking and a long dictation is not transcribed all at once at the end. Default on. */
  chunked?: boolean;
}

const LIVE_CHUNK_MS = 8000;
const LIVE_SILENCE_MS = 800;
const LIVE_TICK_MS = 200;
const LIVE_SPEECH_LEVEL = 0.02;
const MIN_RESTART_INTERVAL_MS = 300;
// Browser recognition on a tap: it stops only after this much silence, not at the first short pause
const BROWSER_SILENCE_STOP_MS = 5000;

/**
 * Microphone input for one button: start, stop (text arrives), cancel (nothing arrives). How the text
 * is made depends on the server setting, see lib/voice.ts. mode is null until known, "off" or
 * "unsupported" means: do not show a microphone.
 */
export function useVoiceInput({ onText, onError, continuous = false, live = false, chunked = true }: VoiceInputOptions) {
  const chunkServer = live || chunked;
  const [mode, setMode] = useState<EffectiveVoiceMode | null>(null);
  const [state, setState] = useState<VoiceState>('idle');
  const [pendingChunks, setPendingChunks] = useState(0);
  const maxSecondsRef = useRef(600);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const segmentTimerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const stoppedRef = useRef(false);
  const transcriptRef = useRef('');
  const baseTranscriptRef = useRef('');
  const lastRestartAtRef = useRef(0);
  const chunkIndexRef = useRef(0);
  const chunkResultsRef = useRef<Map<number, string>>(new Map());
  const inFlightChunksRef = useRef(0);
  const mountedRef = useRef(true);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const clearAllTimers = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (segmentTimerRef.current !== null) window.clearInterval(segmentTimerRef.current);
    segmentTimerRef.current = null;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    const load = () =>
      void loadVoiceConfig().then((cfg) => {
        if (!mountedRef.current) return;
        setMode(cfg.mode);
        maxSecondsRef.current = cfg.maxSeconds;
      });
    load();
    // The account setting (Whisper or browser) can change while this button is on screen
    window.addEventListener(VOICE_CONFIG_EVENT, load);
    return () => {
      window.removeEventListener(VOICE_CONFIG_EVENT, load);
      mountedRef.current = false;
      clearAllTimers();
      recorderRef.current?.cancel();
      try {
        recognitionRef.current?.abort?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const setStateSafe = (s: VoiceState) => {
    if (mountedRef.current) setState(s);
  };
  const setPendingChunksSafe = (n: number) => {
    if (mountedRef.current) setPendingChunks(n);
  };
  const fail = (message: string) => {
    setStateSafe('idle');
    setPendingChunksSafe(0);
    onErrorRef.current?.(message);
  };

  const joinedChunkText = () =>
    [...chunkResultsRef.current.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => t.trim())
      .filter(Boolean)
      .join(' ');

  const processSegmentPromise = (idx: number, blobPromise: Promise<Blob | null>) => {
    inFlightChunksRef.current += 1;
    setPendingChunksSafe(inFlightChunksRef.current);
    void blobPromise
      .then(async (blob) => {
        if (cancelledRef.current) return;
        if (!blob || blob.size === 0) {
          inFlightChunksRef.current = Math.max(0, inFlightChunksRef.current - 1);
          setPendingChunksSafe(inFlightChunksRef.current);
          if (stoppedRef.current && inFlightChunksRef.current === 0) {
            setStateSafe('idle');
            onTextRef.current(joinedChunkText(), true);
          }
          return;
        }
        const text = await api.transcribe(blob);
        if (cancelledRef.current) return;
        chunkResultsRef.current.set(idx, text || '');
        inFlightChunksRef.current = Math.max(0, inFlightChunksRef.current - 1);
        setPendingChunksSafe(inFlightChunksRef.current);
        const combined = joinedChunkText();
        transcriptRef.current = combined;
        if (stoppedRef.current && inFlightChunksRef.current === 0) {
          setStateSafe('idle');
          onTextRef.current(combined, true);
        } else {
          onTextRef.current(combined, false);
        }
      })
      .catch((err: any) => {
        if (cancelledRef.current) return;
        cancelledRef.current = true;
        inFlightChunksRef.current = 0;
        clearAllTimers();
        recorderRef.current?.cancel();
        recorderRef.current = null;
        fail(err?.message || i18n.t('common:voice.failed'));
      });
  };

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    clearAllTimers();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // onend still follows
      }
      return;
    }
    const rec = recorderRef.current;
    if (!rec) {
      if (chunkServer && state === 'listening') {
        setStateSafe('idle');
        onTextRef.current(transcriptRef.current, true);
      }
      return;
    }
    recorderRef.current = null;
    if (chunkServer) {
      const idx = chunkIndexRef.current++;
      setStateSafe('transcribing');
      processSegmentPromise(idx, rec.stop());
      return;
    }
    const blob = await rec.stop();
    if (cancelledRef.current) return;
    if (!blob) {
      setStateSafe('idle');
      onTextRef.current('', true);
      return;
    }
    setStateSafe('transcribing');
    try {
      const text = await api.transcribe(blob);
      setStateSafe('idle');
      onTextRef.current(text, true);
    } catch (err: any) {
      fail(err?.message || i18n.t('common:voice.failed'));
    }
    // fail only touches refs and state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkServer, state]);

  const startServer = async () => {
    const rec = new VoiceRecorder();
    recorderRef.current = rec;
    chunkIndexRef.current = 0;
    chunkResultsRef.current = new Map();
    inFlightChunksRef.current = 0;
    setPendingChunksSafe(0);
    setStateSafe('listening');
    try {
      await rec.start();
    } catch {
      recorderRef.current = null;
      fail(i18n.t('common:voice.noMic'));
      return;
    }
    if (cancelledRef.current || recorderRef.current !== rec) {
      rec.cancel();
      return;
    }
    timerRef.current = window.setTimeout(() => void stop(), maxSecondsRef.current * 1000);
    if (chunkServer) {
      let segmentMs = 0;
      let silentMs = 0;
      let hadSpeech = false;
      segmentTimerRef.current = window.setInterval(() => {
        if (cancelledRef.current || stoppedRef.current || recorderRef.current !== rec) return;
        const lvl = rec.level();
        if (lvl !== null) {
          if (lvl >= LIVE_SPEECH_LEVEL) {
            hadSpeech = true;
            silentMs = 0;
          } else if (hadSpeech) {
            silentMs += LIVE_TICK_MS;
          }
        }
        segmentMs += LIVE_TICK_MS;
        if (segmentMs >= LIVE_CHUNK_MS || (hadSpeech && silentMs >= LIVE_SILENCE_MS)) {
          segmentMs = 0;
          silentMs = 0;
          hadSpeech = false;
          const idx = chunkIndexRef.current++;
          processSegmentPromise(idx, rec.cutSegment());
        }
      }, LIVE_TICK_MS);
    }
  };

  const spawnBrowserRecognition = (Recognition: any, isRestart: boolean) => {
    const recognition = new Recognition();
    recognition.lang = browserVoiceLanguage(currentLocale());
    recognition.interimResults = true;
    // A tap (neither hold nor dictation) listens through short pauses and ends after 5 s of silence
    const stopOnSilence = !continuous && !live;
    recognition.continuous = continuous || live || stopOnSilence;
    const armSilenceStop = () => {
      if (!stopOnSilence) return;
      if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => void stop(), BROWSER_SILENCE_STOP_MS);
    };
    armSilenceStop();
    recognition.onresult = (event: any) => {
      armSilenceStop();
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i++) parts.push(event.results[i][0].transcript);
      const sessionText = joinSpeechResults(parts);
      if (live && baseTranscriptRef.current) {
        const base = baseTranscriptRef.current.trimEnd();
        const next = sessionText.trimStart();
        transcriptRef.current = next ? `${base} ${next}` : base;
      } else {
        transcriptRef.current = sessionText;
      }
      onTextRef.current(transcriptRef.current, false);
    };
    recognition.onerror = (event: any) => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        cancelledRef.current = true;
        clearAllTimers();
        recognitionRef.current = null;
        fail(i18n.t('common:voice.denied'));
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (cancelledRef.current) {
        clearAllTimers();
        return;
      }
      if (!live || stoppedRef.current) {
        clearAllTimers();
        setStateSafe('idle');
        onTextRef.current(transcriptRef.current, true);
        return;
      }
      baseTranscriptRef.current = transcriptRef.current;
      const now = Date.now();
      const elapsed = now - lastRestartAtRef.current;
      const doRestart = () => {
        if (cancelledRef.current || stoppedRef.current) return;
        lastRestartAtRef.current = Date.now();
        spawnBrowserRecognition(Recognition, true);
      };
      if (lastRestartAtRef.current === 0 || elapsed >= MIN_RESTART_INTERVAL_MS) {
        doRestart();
      } else {
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          doRestart();
        }, MIN_RESTART_INTERVAL_MS - elapsed);
      }
    };
    recognitionRef.current = recognition;
    if (!isRestart) setStateSafe('listening');
    try {
      recognition.start();
      if (!isRestart) {
        timerRef.current = window.setTimeout(() => void stop(), maxSecondsRef.current * 1000);
      }
    } catch {
      recognitionRef.current = null;
      if (!isRestart) {
        fail(i18n.t('common:voice.startFailed'));
      } else {
        clearAllTimers();
        setStateSafe('idle');
        onTextRef.current(transcriptRef.current, true);
      }
    }
  };

  const startBrowser = () => {
    const Recognition = browserRecognition();
    if (!Recognition) {
      fail(i18n.t('common:voice.unsupported'));
      return;
    }
    baseTranscriptRef.current = '';
    lastRestartAtRef.current = 0;
    spawnBrowserRecognition(Recognition, false);
  };

  const start = useCallback(async () => {
    if (recorderRef.current || recognitionRef.current) return;
    cancelledRef.current = false;
    stoppedRef.current = false;
    transcriptRef.current = '';
    baseTranscriptRef.current = '';
    lastRestartAtRef.current = 0;
    const current = mode ?? currentVoiceConfig().mode;
    if (current === 'server') await startServer();
    else if (current === 'browser') startBrowser();
    else fail(current === 'off' ? i18n.t('common:voice.off') : i18n.t('common:voice.unsupported'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, continuous, live, chunkServer]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stoppedRef.current = true;
    inFlightChunksRef.current = 0;
    setPendingChunksSafe(0);
    clearAllTimers();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    try {
      recognitionRef.current?.abort?.();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    setStateSafe('idle');
  }, []);

  const toggle = useCallback(() => {
    if (state === 'listening') void stop();
    else if (state === 'idle') void start();
  }, [state, start, stop]);

  /** Current input level 0..1 for waves (server mode), null when unknown. */
  const level = useCallback(() => recorderRef.current?.level() ?? null, []);

  return {
    mode,
    available: mode === 'server' || mode === 'browser',
    state,
    pendingChunks,
    start,
    stop,
    cancel,
    toggle,
    level,
  };
}
