import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Lock, Mic, Plus, Square, X } from 'lucide-react';
import { RailItemContent } from '../components/RailItemContent';
import { CountBadge } from '../components/CountBadge';
import { useHoldToDictate } from '../features/capture/useHoldToDictate';
import { useLatestRef } from '../lib/useLatestRef';
import { formatDue } from '../lib/due';
import { formatClock } from '../lib/format';
import type { DictationOutcome } from '../features/capture/captureDictation';

interface RailQuickDumpButtonProps {
  expanded: boolean;
  // Shortcut shown next to the expanded row
  shortcut: string;
  onQuickDump: () => void;
  // Saves dictated text into the inbox (the same as the phone's hold on the +); names a recognised date
  onDictated: (text: string) => Promise<DictationOutcome | void> | DictationOutcome | void;
}

// The Quick Dump's + in the desktop rail (app/NavRail.tsx): a click opens the window, holding it with the
// mouse dictates straight into the inbox (features/capture/useHoldToDictate.ts). Moving the mouse away while
// holding locks the recording: it goes on without holding, and a click on the + stops it. The circle shows
// the state: red with a stop symbol and a level ring while recording (a small × on its corner throws the
// recording away), a spinning ring while saving, a check mark when done. A date
// recognised in the dictation is named in the tip afterwards, with "Rückgängig" to keep the text as spoken.
// The + can be held again while earlier dictations are still being transcribed; a small counter on it says
// how many are waiting, and one that failed offers "Erneut versuchen" in the tip.
export function RailQuickDumpButton({ expanded, shortcut, onQuickDump, onDictated }: RailQuickDumpButtonProps) {
  const { t } = useTranslation('app');
  const { phase, pending, failed, failedError, retryFailed, locked, lockProgress, seconds, notice, saved, level, buttonRef, cancelRef, onPointerDown, clickTaken, cancel, undoSaved } =
    useHoldToDictate({ onSave: onDictated });
  const ringRef = useRef<HTMLSpanElement | null>(null);
  const levelRef = useLatestRef(level);

  // The ring grows with the voice (own server); without a level (browser recognition) it pulses in CSS.
  // Set on the element every frame, so React does not render 60 times a second.
  useEffect(() => {
    if (phase !== 'recording') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const level = levelRef.current();
      const el = ringRef.current;
      if (el && level !== null) {
        smooth = smooth * 0.7 + Math.min(1, level * 4) * 0.3;
        el.style.transform = `scale(${1 + smooth * 0.35})`;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [phase, levelRef]);

  const recording = phase === 'recording';
  let circle = 'bg-panel-elevated border border-border text-main group-hover:bg-panel-hover group-hover:border-strong';
  if (recording) circle = 'bg-status-err border border-status-err text-on-accent';
  else if (phase === 'saving') circle = 'bg-panel-elevated border border-border text-muted';
  else if (phase === 'done') circle = 'bg-status-ok border border-status-ok text-on-accent';

  let icon = <Plus className="w-[18px] h-[18px]" />;
  if (recording) icon = <Square className="w-3.5 h-3.5 fill-current" />;
  else if (phase === 'saving') icon = <Mic className="w-[18px] h-[18px]" />;
  else if (phase === 'done') icon = <Check className="w-[18px] h-[18px]" />;

  let status: string | null = notice;
  const showFailed = !recording && failed > 0;
  const time = formatClock(seconds);
  if (recording) status = locked ? t('rail.dictateLocked', { time }) : t('rail.dictateListening', { time });
  else if (showFailed) status = t('rail.dictateFailed', { count: failed, error: failedError ?? '' });
  else if (phase === 'saving') status = t('rail.dictateSaving', { count: Math.max(pending, 1) });
  else if (phase === 'done') status = saved ? t('rail.dictateSavedDue', { due: formatDue(saved.due) }) : t('rail.dictateSaved');
  const tipButtons = showFailed || (saved && phase === 'done');
  const cancelLabel = t('common:voice.cancelRecording');

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={onPointerDown}
        onContextMenu={(e) => {
          if (phase !== 'idle') e.preventDefault();
        }}
        // Keyboard, screen readers and short clicks end in a click; after a hold it is ignored, a locked
        // recording it stops. Dictations still in the queue do not block the window.
        onClick={() => {
          if (clickTaken()) return;
          onQuickDump();
        }}
        data-tour="capture"
        data-dictation={phase === 'idle' ? undefined : phase}
        data-locked={locked || undefined}
        className="rail-item rail-plus group select-none"
      >
        <RailItemContent
          icon={
            <span
              className={`relative w-9 h-9 -m-2 rounded-full flex items-center justify-center shadow-xs transition-colors ${circle}`}
            >
              {recording && (
                <span
                  ref={ringRef}
                  aria-hidden
                  data-testid="dictation-ring"
                  className="absolute -inset-1 rounded-full border-2 border-status-err/60 animate-pulse motion-reduce:animate-none transition-transform duration-75 pointer-events-none"
                />
              )}
              {phase === 'saving' && (
                <span
                  aria-hidden
                  data-testid="dictation-spinner"
                  className="absolute -inset-1 rounded-full border-2 border-accent border-t-transparent animate-spin pointer-events-none"
                />
              )}
              {icon}
              {/* Dictations handed in and not saved yet (failed ones in the accent colour); while recording
                  the × sits on that corner */}
              <CountBadge
                count={recording ? 0 : pending + failed}
                variant={failed > 0 ? 'accent' : 'muted'}
                position="corner"
              />
            </span>
          }
          label={t('rail.quickDump')}
          tip={t('rail.quickDumpTip')}
          hint={<kbd className="font-mono">{shortcut}</kbd>}
          expanded={expanded}
        />
      </button>
      {/* Throws the current recording away, held or locked (like an online dot on an avatar) */}
      {recording && (
        <button
          ref={cancelRef}
          type="button"
          onClick={cancel}
          title={cancelLabel}
          aria-label={cancelLabel}
          className="absolute left-[25px] -top-0.5 w-[18px] h-[18px] rounded-full bg-status-err text-on-accent border-2 border-panel flex items-center justify-center shadow-xs cursor-pointer hover:brightness-110"
        >
          <X className="w-2.5 h-2.5 stroke-[3]" />
        </button>
      )}
      {status && (
        <span
          role="status"
          aria-live="polite"
          className="rail-tip rail-tip-live flex items-center gap-2"
          // The buttons in it have to take clicks
          style={tipButtons ? { pointerEvents: 'auto' } : undefined}
        >
          {/* Moving away locks: the lock fills in on the way and stays once locked */}
          {recording && (
            <Lock
              aria-hidden
              data-testid="dictation-lock-hint"
              className={`w-3.5 h-3.5 shrink-0 ${locked ? 'text-status-err' : 'text-muted'}`}
              style={locked ? undefined : { opacity: 0.4 + lockProgress * 0.6 }}
            />
          )}
          {status}
          {showFailed && (
            <button type="button" onClick={retryFailed} className="font-semibold text-accent hover:underline cursor-pointer">
              {t('rail.dictateRetry')}
            </button>
          )}
          {!showFailed && saved && phase === 'done' && (
            <button
              type="button"
              onClick={() => void undoSaved()}
              title={t('rail.dictateUndoTitle')}
              className="font-semibold text-accent hover:underline cursor-pointer"
            >
              {t('triage:undo')}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
