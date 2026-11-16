import React, { useEffect, useRef, useState } from 'react';
import i18n from '../../i18n';
import { triggerHaptic } from '../../lib/api';
import { useVoiceInput } from '../../lib/useVoiceInput';
import { useLatestRef } from '../../lib/useLatestRef';
import { showError } from '../../components/ErrorNotice';
import type { DictationOutcome } from './captureDictation';
import { DictationQueue, type DictationItem } from './dictationQueue';

/** recording: the button is held or locked; saving: earlier dictations are being transcribed or saved (the +
 *  can be held again meanwhile), or the browser's recognition is finishing; done: the last one was saved. */
export type DictationPhase = 'idle' | 'recording' | 'saving' | 'done';
// What the microphone does: stopping = released, the browser's recognition is still sending its last words
type MicPhase = 'idle' | 'recording' | 'stopping';

interface HoldToDictateOptions {
  /**
   * Saves the recognised text (the inbox). With a date recognised in it, the answer names it and how to take
   * it back; the done state then lasts long enough to do so.
   */
  onSave: (text: string) => Promise<DictationOutcome | void> | DictationOutcome | void;
  /** Phone (features/capture/HoldToRecordFab.tsx): touch holds too, the phone vibrates, and errors are shown
   *  as the button's notice instead of the app's error message. */
  touch?: boolean;
  /** Voice input is switched off or not supported, or failed while still held: do this instead (the phone
   *  opens the capture sheet). */
  fallback?: () => void;
}

const HOLD_DELAY_MS = 350;
/** Moved this far from where it was pressed while held, the recording locks and goes on without holding. */
export const LOCK_DISTANCE_PX = 56;
// The browser's recognition sometimes never reports its end: save what was heard after this
const STOP_TIMEOUT_MS = 1500;
const DONE_MS = 800;
// The phone shows "saved" as a hint, which needs a little longer to read
const TOUCH_DONE_MS = 2500;
// A saved date stays on screen this long with "Rückgängig"
const UNDO_MS = 7000;
const NOTICE_MS = 2000;

/**
 * Press and hold a button to dictate (the desktop rail's + with the mouse, the phone's floating + with a
 * finger): recording starts after a moment, releasing stops it and saves. Moving the pointer away from where
 * it was pressed (LOCK_DISTANCE_PX, like WhatsApp) locks the recording: it goes on without holding, and a
 * click on the button stops it. cancel() (the small × on the button, releasing a hold on it, or Escape)
 * throws the current recording away without asking. A short click stays a click: clickTaken() says whether
 * a click belongs to the dictation and must not open anything. The keyboard only clicks.
 *
 * Released dictations go into a queue (dictationQueue.ts): with the own Whisper server the button can be
 * held again while earlier ones are still being transcribed; they are saved in the order they were spoken.
 * One that fails waits with its audio until it is tried again (retryFailed); a reload loses it.
 */
export function useHoldToDictate({ onSave, touch = false, fallback }: HoldToDictateOptions) {
  const [mic, setMicState] = useState<MicPhase>('idle');
  const [items, setItems] = useState<DictationItem[]>([]);
  const [done, setDone] = useState(false);
  const [locked, setLockedState] = useState(false);
  // How far the held pointer is on its way to locking, 0..1 (for the hint)
  const [lockProgress, setLockProgress] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // The text recognised so far while recording (preview)
  const [transcript, setTranscript] = useState('');
  // The date recognised in the last dictation and its undo, while the done state shows it
  const [saved, setSaved] = useState<DictationOutcome | null>(null);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const phaseRef = useRef<MicPhase>('idle');
  const lockedRef = useRef(false);
  const pressedRef = useRef(false);
  // Moved away before the hold began: the press does not become a recording
  const movedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const finalizedRef = useRef(false);
  const transcriptRef = useRef('');
  const holdTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const doneTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const detachKeyRef = useRef<(() => void) | null>(null);
  const fallbackRef = useLatestRef(fallback);

  const haptic = (pattern: number | number[]) => {
    if (touch) triggerHaptic(pattern);
  };
  const setPhase = (next: MicPhase) => {
    phaseRef.current = next;
    setMicState(next);
    if (next === 'recording') return;
    if (tickTimerRef.current !== null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    detachKeyRef.current?.();
    detachKeyRef.current = null;
  };
  const setLocked = (next: boolean) => {
    if (lockedRef.current === next) return;
    lockedRef.current = next;
    setLockedState(next);
  };
  const clearTimer = (ref: React.MutableRefObject<number | null>) => {
    if (ref.current !== null) window.clearTimeout(ref.current);
    ref.current = null;
  };
  const flashNotice = (text: string) => {
    clearTimer(noticeTimerRef);
    setNotice(text);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, NOTICE_MS);
  };
  // An error: the phone shows it at its button, the desktop as the app's error message
  const report = (message: string) => {
    if (touch) flashNotice(message);
    else showError(message);
  };
  const detach = () => {
    detachRef.current?.();
    detachRef.current = null;
  };

  const onSaveRef = useLatestRef(onSave);
  // One queue for the button's lifetime, made at the first dictation (only event handlers use it)
  const queueRef = useRef<DictationQueue<DictationOutcome | void> | null>(null);
  const queue = () =>
    (queueRef.current ??= new DictationQueue<DictationOutcome | void>({
      save: (text) => onSaveRef.current(text),
      onChange: setItems,
      onSaved: (outcome) => {
        const withDate = outcome && outcome.due ? outcome : null;
        haptic(25);
        clearTimer(doneTimerRef);
        setSaved(withDate);
        setDone(true);
        doneTimerRef.current = window.setTimeout(() => {
          doneTimerRef.current = null;
          setSaved(null);
          setDone(false);
        }, withDate ? UNDO_MS : touch ? TOUCH_DONE_MS : DONE_MS);
      },
      onNothing: () => flashNotice(i18n.t('app:rail.dictateNothing')),
      // The phone names it in its hint with "Erneut versuchen"; the desktop's tip only shows on hover
      onFailed: (message) => {
        if (!touch) showError(message);
      },
      fallbackMessage: () => i18n.t('triage:fab.saveFailed'),
    }));

  // The browser's recognition delivers the text itself: it joins the queue, so saves keep their order
  const finalize = (text: string) => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    clearTimer(stopTimerRef);
    // Also when the recognition ended by itself while held or locked
    setLocked(false);
    setPhase('idle');
    setTranscript('');
    const trimmed = text.trim();
    if (!trimmed) {
      flashNotice(i18n.t('app:rail.dictateNothing'));
      return;
    }
    queue().add({ text: () => Promise.resolve(trimmed) });
  };

  // Own Whisper server in chunks, or the browser's recognition
  const voice = useVoiceInput({
    continuous: true,
    onText: (text, final) => {
      transcriptRef.current = text;
      if (final) finalize(text);
      else if (phaseRef.current === 'recording') setTranscript(text);
    },
    // Own server: the recording is handed on while it is still being transcribed, the + is free at once
    onRecorded: (transcription) => {
      finalizedRef.current = true;
      clearTimer(stopTimerRef);
      setLocked(false);
      setPhase('idle');
      setTranscript('');
      queue().add({ text: () => transcription.result(), retry: () => transcription.retry() });
    },
    onError: (message) => {
      clearTimer(stopTimerRef);
      finalizedRef.current = true;
      const held = pressedRef.current && phaseRef.current === 'recording';
      setLocked(false);
      if (phaseRef.current !== 'idle') setPhase('idle');
      setTranscript('');
      report(message);
      // Could not record while still held: do the button's other thing instead
      if (held) fallbackRef.current?.();
    },
  });

  useEffect(
    () => () => {
      detachRef.current?.();
      detachKeyRef.current?.();
      [holdTimerRef, stopTimerRef, doneTimerRef, noticeTimerRef].forEach((ref) => {
        if (ref.current !== null) window.clearTimeout(ref.current);
      });
      if (tickTimerRef.current !== null) window.clearInterval(tickTimerRef.current);
    },
    []
  );

  const isOn = (el: HTMLElement | null, x: number, y: number) => {
    const rect = el?.getBoundingClientRect();
    if (!rect) return false;
    // Not laid out (tests): counts as on it
    if (rect.width === 0 && rect.height === 0) return true;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  /** Throws the current recording away (nothing is saved). */
  const cancelRecording = () => {
    if (phaseRef.current !== 'recording') return;
    finalizedRef.current = true;
    clearTimer(stopTimerRef);
    voice.cancel();
    setLocked(false);
    setLockProgress(0);
    setPhase('idle');
    setTranscript('');
    haptic(15);
  };

  /** Ends the current recording; its text goes into the queue. */
  const stopRecording = () => {
    if (phaseRef.current !== 'recording') return;
    setLocked(false);
    setLockProgress(0);
    setPhase('stopping');
    if (voice.mode !== 'server') {
      stopTimerRef.current = window.setTimeout(() => {
        stopTimerRef.current = null;
        voice.cancel();
        finalize(transcriptRef.current);
      }, STOP_TIMEOUT_MS);
    }
    void voice.stop();
  };

  const startRecording = () => {
    if (voice.mode === 'off' || voice.mode === 'unsupported') {
      const off = voice.mode === 'off';
      // With a fallback, switched off needs no words: the other thing simply happens
      if (!off || !fallbackRef.current) report(i18n.t(off ? 'common:voice.off' : 'common:voice.unsupported'));
      fallbackRef.current?.();
      return;
    }
    transcriptRef.current = '';
    finalizedRef.current = false;
    clearTimer(doneTimerRef);
    clearTimer(noticeTimerRef);
    setNotice(null);
    setSaved(null);
    setDone(false);
    setTranscript('');
    setLocked(false);
    setLockProgress(0);
    const startedAt = Date.now();
    setSeconds(0);
    setPhase('recording');
    tickTimerRef.current = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    // Escape throws the recording away, held or locked
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || phaseRef.current !== 'recording') return;
      // Before the rail and open windows see it
      ev.preventDefault();
      ev.stopPropagation();
      cancelRecording();
    };
    window.addEventListener('keydown', onKey, true);
    detachKeyRef.current = () => window.removeEventListener('keydown', onKey, true);
    haptic([15, 60, 25]);
    void voice.start();
  };

  const release = (e: PointerEvent) => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    clearTimer(holdTimerRef);
    detach();
    setLockProgress(0);
    // Released beside the button: the browser sends no click to it, so the next one must count again
    if (buttonRef.current && !isOn(buttonRef.current, e.clientX, e.clientY)) suppressClickRef.current = false;
    // Locked: it goes on, a click on the button ends it
    if (phaseRef.current !== 'recording' || lockedRef.current) return;
    // Released on the ×: thrown away (only where it is laid out; tests use the × itself)
    const cancelRect = cancelRef.current?.getBoundingClientRect();
    if (cancelRect && cancelRect.width > 0 && isOn(cancelRef.current, e.clientX, e.clientY)) {
      cancelRecording();
      return;
    }
    stopRecording();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'touch' && !touch) return;
    if (e.button !== 0) return;
    // A new press: a click left over from the last one has come or will not come any more
    suppressClickRef.current = false;
    // Locked: the click that follows stops it. Earlier dictations still in the queue do not block a new one
    if (phaseRef.current !== 'idle') return;
    detach();
    clearTimer(holdTimerRef);
    pressedRef.current = true;
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    setLockProgress(0);

    const onMove = (ev: PointerEvent) => {
      if (!pressedRef.current) return;
      const dist = Math.hypot(ev.clientX - startRef.current.x, ev.clientY - startRef.current.y);
      if (phaseRef.current !== 'recording') {
        if (dist >= LOCK_DISTANCE_PX) movedRef.current = true;
        return;
      }
      if (lockedRef.current) return;
      if (dist >= LOCK_DISTANCE_PX) {
        setLocked(true);
        setLockProgress(0);
        haptic(10);
        return;
      }
      // In steps, so a move does not render on every pixel
      setLockProgress(Math.round((dist / LOCK_DISTANCE_PX) * 10) / 10);
    };
    const onUp = (ev: PointerEvent) => release(ev);
    const onCancel = () => {
      if (!pressedRef.current) return;
      pressedRef.current = false;
      clearTimer(holdTimerRef);
      detach();
      suppressClickRef.current = false;
      setLockProgress(0);
      // The browser took the pointer: a locked recording goes on, a held one is thrown away
      if (!lockedRef.current) cancelRecording();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    detachRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      if (!pressedRef.current || movedRef.current) return;
      // From here the press is a hold: the click that follows the release is not a click on the +
      suppressClickRef.current = true;
      startRecording();
    }, HOLD_DELAY_MS);
  };

  /**
   * Call first in the button's click handler: true when the click belongs to the dictation and must not open
   * anything (it ends a hold, stops a locked recording, or the browser's recognition is still finishing).
   */
  const clickTaken = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    if (phaseRef.current === 'recording') {
      if (lockedRef.current) stopRecording();
      return true;
    }
    return phaseRef.current !== 'idle';
  };

  /** Takes the recognised date of the last dictation back (text as dictated, no due date). */
  const undoSaved = async () => {
    const current = saved;
    if (!current) return;
    clearTimer(doneTimerRef);
    setSaved(null);
    setDone(false);
    try {
      await current.undo();
    } catch {
      report(i18n.t('triage:fab.saveFailed'));
    }
  };

  const failed = items.filter((i) => i.state === 'failed');
  const pending = items.length - failed.length;
  let phase: DictationPhase = 'idle';
  if (mic === 'recording') phase = 'recording';
  else if (mic === 'stopping' || (pending > 0 && !saved)) phase = 'saving';
  else if (done) phase = 'done';

  return {
    phase,
    // Dictations handed in and not saved yet, and the ones of them that failed (with the last reason)
    pending,
    failed: failed.length,
    failedError: failed.length ? failed[failed.length - 1].error ?? null : null,
    retryFailed: () => queue().retryFailed(),
    locked,
    lockProgress,
    seconds,
    notice,
    saved,
    transcript,
    mode: voice.mode,
    level: voice.level,
    buttonRef,
    // The small × on the button; releasing a held recording on it throws the recording away too
    cancelRef,
    onPointerDown,
    clickTaken,
    cancel: cancelRecording,
    undoSaved,
  };
}
