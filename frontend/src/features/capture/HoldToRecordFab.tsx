import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, Lock, Plus, Square, X } from 'lucide-react';
import { VoiceWave } from '../../components/VoiceWave';
import { CountBadge } from '../../components/CountBadge';
import { Toast, toastObstacleRef } from '../../components/Toast';
import { formatDue } from '../../lib/due';
import { useHoldToDictate } from './useHoldToDictate';
import type { DictationOutcome } from './captureDictation';

export interface HoldToRecordFabProps {
  onTap: () => void;
  // Saves the text; with a date recognised in it, the answer names it and how to take it back
  onTranscript: (text: string) => Promise<DictationOutcome | void> | DictationOutcome | void;
}

const HINT_CLASS =
  'fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 w-max max-w-[calc(100vw-1.5rem)] bg-panel-elevated border shadow-panel text-center';

// The phone's floating + in the bottom bar (app/MobileNav.tsx): a tap opens the capture sheet, holding it
// dictates straight into the inbox, as the desktop rail's + does (features/capture/useHoldToDictate.ts).
// Sliding the finger up (or away) while holding locks the recording, a tap on the red button then stops it,
// and the small × on its corner throws it away. The + is free again right after the release: earlier
// dictations are transcribed and saved in a queue, a counter on it says how many wait, and one that failed
// offers "Erneut versuchen" in the hint above.
export const HoldToRecordFab: React.FC<HoldToRecordFabProps> = ({ onTap, onTranscript }) => {
  const { t } = useTranslation('triage');
  const { phase, pending, failed, failedError, retryFailed, locked, lockProgress, notice, saved, transcript, mode, level, buttonRef, cancelRef, onPointerDown, clickTaken, cancel, undoSaved } =
    useHoldToDictate({ onSave: onTranscript, touch: true, fallback: onTap });
  const recording = phase === 'recording';
  const displayedTranscript = transcript.length > 180 ? `…${transcript.slice(-180)}` : transcript;

  let status: string | null = notice;
  const showFailed = !recording && failed > 0;
  if (showFailed) status = t('app:rail.dictateFailed', { count: failed, error: failedError ?? '' });
  else if (phase === 'saving') status = t('app:rail.dictateSaving', { count: Math.max(pending, 1) });
  else if (phase === 'done') status = saved ? t('app:rail.dictateSavedDue', { due: formatDue(saved.due) }) : t('app:rail.dictateSaved');
  const showUndo = !showFailed && !!saved && phase === 'done';
  const cancelLabel = t('common:voice.cancelRecording');

  return (
    <>
      {recording && (
        <div ref={toastObstacleRef} className={`${HINT_CLASS} rounded-card px-4 py-2.5 border-border text-main pointer-events-none`}>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-main flex items-center justify-center gap-2">
              {locked ? (
                <Lock aria-hidden className="w-3.5 h-3.5 text-status-err" />
              ) : (
                mode === 'server' && <VoiceWave getLevel={level} bars={7} className="h-4 text-accent" />
              )}
              {locked ? t('fab.locked') : t('fab.listening')}
            </div>
            {displayedTranscript && <div className="text-xs text-muted wrap-break-word max-w-[calc(100vw-3rem)]">{displayedTranscript}</div>}
            {/* Slide up to lock: the lock comes up with the finger */}
            {!locked && (
              <div data-testid="dictation-lock-hint" className="text-[11px] text-faint flex items-center justify-center gap-1">
                <span
                  aria-hidden
                  className="inline-flex flex-col items-center"
                  style={{ transform: `translateY(${-lockProgress * 6}px)`, opacity: 0.5 + lockProgress * 0.5 }}
                >
                  <ChevronUp className="w-3 h-3 -mb-1" />
                  <Lock className="w-3.5 h-3.5" />
                </span>
                {t('fab.slideLock')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* After the recording: saving, saved (with a recognised date it can take it back) or failed, as a
          notice in the shared stack (components/Toast.tsx) */}
      {!recording && status && (
        <Toast
          text={status}
          actions={
            showFailed
              ? [{ label: t('app:rail.dictateRetry'), run: retryFailed }]
              : showUndo
              ? [{ label: t('undo'), title: t('app:rail.dictateUndoTitle'), run: () => void undoSaved() }]
              : []
          }
        />
      )}

      <span className="relative -mt-6 inline-flex">
        <button
          ref={buttonRef}
          type="button"
          onPointerDown={onPointerDown}
          onContextMenu={(e) => e.preventDefault()}
          // Taps, keyboard, screen readers and switch control all end in a click; after a hold it is ignored,
          // a locked recording it stops
          onClick={() => {
            if (clickTaken()) return;
            onTap();
          }}
          className={
            recording
              ? 'w-14 h-14 rounded-full bg-status-err text-on-accent shadow-lg flex items-center justify-center transition-transform border-4 border-panel cursor-pointer touch-none select-none animate-pulse motion-reduce:animate-none'
              : 'w-14 h-14 rounded-full bg-accent text-on-accent shadow-lg flex items-center justify-center active:scale-90 transition-transform border-4 border-panel cursor-pointer touch-none select-none'
          }
          title={locked ? t('common:voice.stop') : t('fab.title')}
          aria-label={locked ? t('common:voice.stop') : t('fab.label')}
          data-tour="capture"
          data-dictation={phase === 'idle' ? undefined : phase}
          data-locked={locked || undefined}
        >
          {recording ? <Square className="w-6 h-6 fill-current" /> : <Plus className="w-7 h-7 stroke-[2.5]" />}
        </button>
        {/* Dictations handed in and not saved yet (failed ones in the accent colour) */}
        {!recording && <CountBadge count={pending + failed} variant={failed > 0 ? 'accent' : 'muted'} position="corner" />}
        {/* Throws the current recording away, held or locked: a dot on the corner, 44 px to tap */}
        {recording && (
          <button
            ref={cancelRef}
            type="button"
            onClick={cancel}
            title={cancelLabel}
            aria-label={cancelLabel}
            className="absolute -top-4 left-7 w-11 h-11 flex items-center justify-center cursor-pointer touch-none select-none"
          >
            <span className="w-6 h-6 rounded-full bg-status-err text-on-accent border-2 border-panel shadow-xs flex items-center justify-center">
              <X className="w-3.5 h-3.5 stroke-[3]" />
            </span>
          </button>
        )}
      </span>
    </>
  );
};
