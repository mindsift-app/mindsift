import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { Mic, Plus } from 'lucide-react';
import { triggerHaptic } from '../../lib/api';
import { useVoiceInput } from '../../lib/useVoiceInput';
import { VoiceWave } from '../../components/VoiceWave';

export interface HoldToRecordFabProps {
  onTap: () => void;
  onTranscript: (text: string) => Promise<void> | void;
}

const HOLD_DELAY_MS = 350;
const CANCEL_DRAG_PX = 60;
const STOP_TIMEOUT_MS = 1500;
const TOAST_DURATION_MS = 2500;

export const HoldToRecordFab: React.FC<HoldToRecordFabProps> = ({ onTap, onTranscript }) => {
  const { t } = useTranslation('triage');
  const [isRecording, setIsRecording] = useState(false);
  const [isCancelZone, setIsCancelZone] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const isPressedRef = useRef(false);
  // A press that turned into a hold must not also count as a tap when the browser sends its click
  const suppressClickRef = useRef(false);
  const didEnterHoldRef = useRef(false);
  const fallbackHandledRef = useRef(false);
  const isCancelZoneRef = useRef(false);
  const finalizedRef = useRef(false);
  const startYRef = useRef(0);
  const transcriptRef = useRef('');

  const holdTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const clearStopTimer = () => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  };

  const showToast = (msg: string, sticky = false) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(msg);
    if (sticky) return;
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION_MS);
  };

  const finalizeRecording = async (text: string) => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    clearStopTimer();
    setLiveTranscript('');
    const trimmed = text.trim();
    if (!trimmed) {
      showToast(i18n.t('triage:fab.nothing'));
      return;
    }
    try {
      await onTranscript(trimmed);
      triggerHaptic(25);
      showToast(i18n.t('triage:fab.saved'));
    } catch {
      showToast(i18n.t('triage:fab.saveFailed'));
    }
  };

  // Own Whisper server (text in chunks while speaking) or the browser's recognition (text while speaking)
  const voice = useVoiceInput({
    continuous: true,
    onText: (text, final) => {
      transcriptRef.current = text;
      if (!final) {
        setLiveTranscript(text);
        return;
      }
      void finalizeRecording(text);
    },
    onError: (message) => {
      clearStopTimer();
      setIsRecording(false);
      setIsCancelZone(false);
      setLiveTranscript('');
      if (didEnterHoldRef.current && isPressedRef.current && !fallbackHandledRef.current) {
        // Recording could not start: open the normal capture sheet instead
        fallbackHandledRef.current = true;
        showToast(message);
        onTap();
        return;
      }
      finalizedRef.current = true;
      showToast(message);
    },
  });

  useEffect(() => {
    return () => {
      clearHoldTimer();
      clearStopTimer();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (voice.state === 'transcribing') showToast(i18n.t('app:capture.transcribing'), true);
  }, [voice.state]);

  const startVoiceRecording = () => {
    if (voice.mode === 'off' || voice.mode === 'unsupported') {
      fallbackHandledRef.current = true;
      if (voice.mode === 'unsupported') showToast(i18n.t('triage:fab.unsupported'));
      onTap();
      return;
    }
    transcriptRef.current = '';
    finalizedRef.current = false;
    isCancelZoneRef.current = false;
    setLiveTranscript('');
    setIsCancelZone(false);
    setIsRecording(true);
    triggerHaptic([15, 60, 25]);
    void voice.start();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore if unsupported in environment
    }

    clearHoldTimer();
    clearStopTimer();

    isPressedRef.current = true;
    suppressClickRef.current = false;
    didEnterHoldRef.current = false;
    fallbackHandledRef.current = false;
    isCancelZoneRef.current = false;
    startYRef.current = e.clientY;

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      if (!isPressedRef.current) return;
      didEnterHoldRef.current = true;
      suppressClickRef.current = true;
      startVoiceRecording();
    }, HOLD_DELAY_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isPressedRef.current || !didEnterHoldRef.current || fallbackHandledRef.current) return;
    const deltaUp = startYRef.current - e.clientY;
    const inCancel = deltaUp > CANCEL_DRAG_PX;
    if (inCancel !== isCancelZoneRef.current) {
      isCancelZoneRef.current = inCancel;
      setIsCancelZone(inCancel);
      triggerHaptic(10);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    if (!isPressedRef.current) return;
    isPressedRef.current = false;
    clearHoldTimer();

    if (!didEnterHoldRef.current) {
      // A short tap opens on the click that follows. Opening here already would let that click land
      // on the freshly opened sheet's backdrop and close it again at once.
      return;
    }

    if (fallbackHandledRef.current) {
      return;
    }

    setIsRecording(false);
    setIsCancelZone(false);

    if (isCancelZoneRef.current) {
      finalizedRef.current = true;
      clearStopTimer();
      setLiveTranscript('');
      triggerHaptic(15);
      voice.cancel();
      return;
    }

    // The browser's recognition sometimes never reports its end: save what was heard after a moment.
    // The own server answers when it is done (with its own time limit).
    if (voice.mode !== 'server') {
      stopTimerRef.current = window.setTimeout(() => {
        voice.cancel();
        void finalizeRecording(transcriptRef.current);
      }, STOP_TIMEOUT_MS);
    }
    void voice.stop();
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    if (!isPressedRef.current) return;
    isPressedRef.current = false;
    clearHoldTimer();
    clearStopTimer();

    if (didEnterHoldRef.current && !fallbackHandledRef.current) {
      finalizedRef.current = true;
      setIsRecording(false);
      setIsCancelZone(false);
      setLiveTranscript('');
      voice.cancel();
    }
  };

  const displayedTranscript =
    liveTranscript.length > 180 ? `…${liveTranscript.slice(-180)}` : liveTranscript;

  return (
    <>
      {isRecording && (
        <div
          className={
            isCancelZone
              ? 'fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 w-max max-w-[calc(100vw-1.5rem)] px-4 py-2.5 rounded-card bg-panel-elevated border border-status-err text-status-err shadow-panel pointer-events-none text-center'
              : 'fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 w-max max-w-[calc(100vw-1.5rem)] px-4 py-2.5 rounded-card bg-panel-elevated border border-border text-main shadow-panel pointer-events-none text-center'
          }
        >
          {isCancelZone ? (
            <div className="text-xs font-semibold">{t('fab.releaseCancel')}</div>
          ) : (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-main flex items-center justify-center gap-2">
                {voice.mode === 'server' && <VoiceWave getLevel={voice.level} bars={7} className="h-4 text-accent" />}
                {t('fab.listening')}
              </div>
              {displayedTranscript ? (
                <div className="text-xs text-muted break-words max-w-[calc(100vw-3rem)]">
                  {displayedTranscript}
                </div>
              ) : (
                <div className="text-[11px] text-faint">{t('fab.dragCancel')}</div>
              )}
            </div>
          )}
        </div>
      )}

      {!isRecording && toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 w-max max-w-[calc(100vw-1.5rem)] px-4 py-2 rounded-pill bg-panel-elevated border border-border text-main text-xs font-medium shadow-panel pointer-events-none text-center"
        >
          {toastMessage}
        </div>
      )}

      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        // Taps, keyboard, screen readers and switch control all end in a click; after a hold it is ignored
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onTap();
        }}
        className={
          isRecording
            ? 'w-14 h-14 -mt-6 rounded-full bg-status-err text-on-accent shadow-lg flex items-center justify-center transition-transform border-4 border-panel cursor-pointer touch-none select-none animate-pulse'
            : 'w-14 h-14 -mt-6 rounded-full bg-accent text-on-accent shadow-lg flex items-center justify-center active:scale-90 transition-transform border-4 border-panel cursor-pointer touch-none select-none'
        }
        title={t('fab.title')}
        aria-label={t('fab.label')}
      >
        {isRecording ? (
          <Mic className="w-7 h-7 stroke-[2.5]" />
        ) : (
          <Plus className="w-7 h-7 stroke-[2.5]" />
        )}
      </button>
    </>
  );
};
