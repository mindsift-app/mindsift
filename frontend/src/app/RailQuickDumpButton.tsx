import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Mic, Plus } from 'lucide-react';
import { RailItemContent } from '../components/RailItemContent';
import { useHoldToDictate } from '../features/capture/useHoldToDictate';
import { useLatestRef } from '../lib/useLatestRef';
import { formatDue } from '../lib/due';
import type { DictationOutcome } from '../features/capture/captureDictation';

interface RailQuickDumpButtonProps {
  expanded: boolean;
  // Shortcut shown next to the expanded row
  shortcut: string;
  onQuickDump: () => void;
  // Saves dictated text into the inbox (the same as the phone's hold on the +); names a recognised date
  onDictated: (text: string) => Promise<DictationOutcome | void> | DictationOutcome | void;
}

const pad = (n: number) => String(n).padStart(2, '0');

// The Quick Dump's + in the desktop rail (app/NavRail.tsx): a click opens the window, holding it with the
// mouse dictates straight into the inbox (features/capture/useHoldToDictate.ts). The circle shows the state:
// microphone with a level ring while recording, a spinning ring while saving, a check mark when done. A date
// recognised in the dictation is named in the tip afterwards, with "Rückgängig" to keep the text as spoken.
export function RailQuickDumpButton({ expanded, shortcut, onQuickDump, onDictated }: RailQuickDumpButtonProps) {
  const { t } = useTranslation('app');
  const { phase, outside, seconds, notice, saved, level, buttonRef, onPointerDown, consumeClick, undoSaved } = useHoldToDictate({
    onSave: onDictated,
  });
  const ringRef = useRef<HTMLSpanElement | null>(null);
  const levelRef = useLatestRef(level);

  // The ring grows with the voice (own server); without a level (browser recognition) it pulses in CSS.
  // Set on the element every frame, so React does not render 60 times a second.
  useEffect(() => {
    if (phase !== 'recording' || outside) return;
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
  }, [phase, outside, levelRef]);

  const recording = phase === 'recording';
  let circle = 'bg-panel-elevated border border-border text-main group-hover:bg-panel-hover group-hover:border-strong';
  if (recording) circle = outside ? 'bg-panel-elevated border border-status-err text-status-err' : 'bg-status-err border border-status-err text-on-accent';
  else if (phase === 'saving') circle = 'bg-panel-elevated border border-border text-muted';
  else if (phase === 'done') circle = 'bg-status-ok border border-status-ok text-on-accent';

  const icon = recording || phase === 'saving' ? <Mic className="w-[18px] h-[18px]" /> : phase === 'done' ? <Check className="w-[18px] h-[18px]" /> : <Plus className="w-[18px] h-[18px]" />;

  let status: string | null = notice;
  if (recording) status = outside ? t('rail.dictateCancel') : t('rail.dictateListening', { time: `${Math.floor(seconds / 60)}:${pad(seconds % 60)}` });
  else if (phase === 'saving') status = t('rail.dictateSaving');
  else if (phase === 'done') status = saved ? t('rail.dictateSavedDue', { due: formatDue(saved.due) }) : t('rail.dictateSaved');

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={onPointerDown}
        onContextMenu={(e) => {
          if (phase !== 'idle') e.preventDefault();
        }}
        // Keyboard, screen readers and short clicks end in a click; after a hold it is ignored
        onClick={() => {
          if (consumeClick()) return;
          if (phase === 'recording' || phase === 'saving') return;
          onQuickDump();
        }}
        data-tour="capture"
        data-dictation={phase === 'idle' ? undefined : phase}
        className="rail-item rail-plus group select-none"
      >
        <RailItemContent
          icon={
            <span
              className={`relative w-9 h-9 -m-2 rounded-full flex items-center justify-center shadow-xs transition-colors ${circle}`}
            >
              {recording && !outside && (
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
            </span>
          }
          label={t('rail.quickDump')}
          tip={t('rail.quickDumpTip')}
          hint={<kbd className="font-mono">{shortcut}</kbd>}
          expanded={expanded}
        />
      </button>
      {status && (
        <span
          role="status"
          aria-live="polite"
          className="rail-tip rail-tip-live flex items-center gap-2"
          // The undo button in it has to take clicks
          style={saved ? { pointerEvents: 'auto' } : undefined}
        >
          {status}
          {saved && phase === 'done' && (
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
