import React, { useEffect, useRef, useState } from 'react';
import i18n from '../../i18n';
import { useVoiceInput } from '../../lib/useVoiceInput';
import { showError } from '../../components/ErrorNotice';
import type { DictationOutcome } from './captureDictation';

export type DictationPhase = 'idle' | 'recording' | 'saving' | 'done';

interface HoldToDictateOptions {
  /**
   * Saves the recognised text (the inbox, like the phone's hold on the +). With a date recognised in it, the
   * answer names it and how to take it back; the done state then lasts long enough to do so.
   */
  onSave: (text: string) => Promise<DictationOutcome | void> | DictationOutcome | void;
}

const HOLD_DELAY_MS = 350;
// The browser's recognition sometimes never reports its end: save what was heard after this
const STOP_TIMEOUT_MS = 1500;
const DONE_MS = 800;
// A saved date stays on screen this long with "Rückgängig"
const UNDO_MS = 7000;
const NOTICE_MS = 2000;

/**
 * Press and hold a button (mouse or pen) to dictate, as the phone's floating + does
 * (features/capture/HoldToRecordFab.tsx): recording starts after a moment, releasing on the button saves,
 * releasing beside it or Escape throws the recording away. A short click stays a click (consumeClick()
 * says whether the browser's click after a hold has to be ignored). Touch and keyboard only click.
 */
export function useHoldToDictate({ onSave }: HoldToDictateOptions) {
  const [phase, setPhaseState] = useState<DictationPhase>('idle');
  const [outside, setOutsideState] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // The date recognised in the last dictation and its undo, while the done state shows it
  const [saved, setSaved] = useState<DictationOutcome | null>(null);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const phaseRef = useRef<DictationPhase>('idle');
  const outsideRef = useRef(false);
  const pressedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const finalizedRef = useRef(false);
  const transcriptRef = useRef('');
  const holdTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const doneTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const setPhase = (next: DictationPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
    if (next !== 'recording' && tickTimerRef.current !== null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  };
  const setOutside = (next: boolean) => {
    if (outsideRef.current === next) return;
    outsideRef.current = next;
    setOutsideState(next);
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
  const detach = () => {
    detachRef.current?.();
    detachRef.current = null;
  };

  const finalize = async (text: string) => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    clearTimer(stopTimerRef);
    const trimmed = text.trim();
    if (!trimmed) {
      setPhase('idle');
      flashNotice(i18n.t('app:rail.dictateNothing'));
      return;
    }
    setPhase('saving');
    try {
      const outcome = await onSave(trimmed);
      const withDate = outcome && outcome.due ? outcome : null;
      setSaved(withDate);
      setPhase('done');
      doneTimerRef.current = window.setTimeout(() => {
        doneTimerRef.current = null;
        setSaved(null);
        setPhase('idle');
      }, withDate ? UNDO_MS : DONE_MS);
    } catch {
      setPhase('idle');
      showError(i18n.t('triage:fab.saveFailed'));
    }
  };

  // Same settings as the phone's hold: own Whisper server in chunks, or the browser's recognition
  const voice = useVoiceInput({
    continuous: true,
    onText: (text, final) => {
      transcriptRef.current = text;
      if (final) void finalize(text);
    },
    onError: (message) => {
      clearTimer(stopTimerRef);
      finalizedRef.current = true;
      if (phaseRef.current === 'recording' || phaseRef.current === 'saving') setPhase('idle');
      setOutside(false);
      showError(message);
    },
  });

  useEffect(
    () => () => {
      detach();
      [holdTimerRef, stopTimerRef, doneTimerRef, noticeTimerRef].forEach((ref) => {
        if (ref.current !== null) window.clearTimeout(ref.current);
      });
      if (tickTimerRef.current !== null) window.clearInterval(tickTimerRef.current);
    },
    []
  );

  const isInside = (x: number, y: number) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return true;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  const cancelRecording = () => {
    finalizedRef.current = true;
    clearTimer(stopTimerRef);
    voice.cancel();
    setOutside(false);
    setPhase('idle');
  };

  const startRecording = () => {
    if (voice.mode === 'off' || voice.mode === 'unsupported') {
      showError(i18n.t(voice.mode === 'off' ? 'common:voice.off' : 'common:voice.unsupported'));
      return;
    }
    transcriptRef.current = '';
    finalizedRef.current = false;
    clearTimer(doneTimerRef);
    clearTimer(noticeTimerRef);
    setNotice(null);
    setSaved(null);
    const startedAt = Date.now();
    setSeconds(0);
    setPhase('recording');
    tickTimerRef.current = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    void voice.start();
  };

  const release = (e: PointerEvent) => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    clearTimer(holdTimerRef);
    detach();
    const inside = isInside(e.clientX, e.clientY);
    // Released beside the button: the browser sends no click to it, so the next one must count again
    if (!inside) suppressClickRef.current = false;
    if (phaseRef.current !== 'recording') return;
    if (!inside) {
      cancelRecording();
      return;
    }
    setOutside(false);
    setPhase('saving');
    if (voice.mode !== 'server') {
      stopTimerRef.current = window.setTimeout(() => {
        stopTimerRef.current = null;
        voice.cancel();
        void finalize(transcriptRef.current);
      }, STOP_TIMEOUT_MS);
    }
    void voice.stop();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    if (phaseRef.current === 'recording' || phaseRef.current === 'saving') return;
    detach();
    clearTimer(holdTimerRef);
    pressedRef.current = true;
    suppressClickRef.current = false;
    setOutside(false);

    const onMove = (ev: PointerEvent) => {
      if (!pressedRef.current) return;
      setOutside(!isInside(ev.clientX, ev.clientY));
    };
    const onUp = (ev: PointerEvent) => release(ev);
    const onCancel = () => {
      if (!pressedRef.current) return;
      pressedRef.current = false;
      clearTimer(holdTimerRef);
      detach();
      suppressClickRef.current = false;
      if (phaseRef.current === 'recording') cancelRecording();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || phaseRef.current !== 'recording') return;
      // Before the rail and open windows see it
      ev.preventDefault();
      ev.stopPropagation();
      cancelRecording();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    detachRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
    };

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      if (!pressedRef.current || outsideRef.current) return;
      // From here the press is a hold: the click that follows the release is not a click on the +
      suppressClickRef.current = true;
      startRecording();
    }, HOLD_DELAY_MS);
  };

  /** True when the click that just arrived ends a hold and must not open anything. */
  const consumeClick = () => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  };

  /** Takes the recognised date of the last dictation back (text as dictated, no due date). */
  const undoSaved = async () => {
    const current = saved;
    if (!current) return;
    clearTimer(doneTimerRef);
    setSaved(null);
    setPhase('idle');
    try {
      await current.undo();
    } catch {
      showError(i18n.t('triage:fab.saveFailed'));
    }
  };

  return { phase, outside, seconds, notice, saved, level: voice.level, buttonRef, onPointerDown, consumeClick, undoSaved };
}
