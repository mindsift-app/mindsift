import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Square } from 'lucide-react';
import { useVoiceInput } from '../../lib/useVoiceInput';
import { VoiceWave } from '../../components/VoiceWave';
import { triggerHaptic } from '../../lib/api';
import { useTranslation } from 'react-i18next';

interface DictationBlockProps {
  onDone: (text: string) => void;
  onCancel: () => void;
}

function formatDuration(sec: number): string {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// What an empty bullet turns into after /diktat: listening starts right away, the whole bullet is one
// button with live text growing above the wave, mm:ss timer and a translucent "Stopp" on top. A tap ends
// it; the text lands in the bullet as plain text.
export const DictationBlock: React.FC<DictationBlockProps> = ({ onDone, onCancel }) => {
  const { t } = useTranslation('workspace');
  const [interim, setInterim] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const voice = useVoiceInput({
    live: true,
    continuous: true,
    onText: (text, final) => {
      if (!final) {
        setInterim(text);
        return;
      }
      if (doneRef.current) return;
      doneRef.current = true;
      if (text.trim()) onDone(text.trim());
      else onCancel();
    },
    onError: (message) => {
      setError(message);
      window.setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true;
          onCancel();
        }
      }, 2500);
    },
  });

  useEffect(() => {
    triggerHaptic([15, 60, 25]);
    void voice.start();
    buttonRef.current?.focus();
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
    // start once when the bullet turns into the dictation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transcribing = voice.state === 'transcribing';
  const chunkBusy = voice.pendingChunks > 0 || transcribing;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        if (voice.state === 'listening') {
          triggerHaptic(20);
          void voice.stop();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          doneRef.current = true;
          voice.cancel();
          onCancel();
        }
      }}
      disabled={transcribing || !!error}
      aria-label={t('dictation.stop')}
      className="relative w-full min-h-[56px] sm:min-h-[44px] my-1 px-4 py-2 rounded-3xl border border-accent bg-accent-dim overflow-hidden flex flex-col gap-1.5 text-left cursor-pointer disabled:cursor-default focus:outline-none"
    >
      {(interim || chunkBusy) && !error && (
        <div className="w-full text-sm text-main whitespace-pre-wrap break-words leading-relaxed pointer-events-none">
          {interim}
          {chunkBusy && <span className="text-muted animate-pulse">{interim ? ' …' : '…'}</span>}
        </div>
      )}
      <div className="relative w-full min-h-[32px] flex items-center justify-between gap-2">
        {/* Live wave across the bottom bar */}
        <VoiceWave getLevel={voice.level} bars={32} className="absolute inset-x-0 inset-y-0 justify-between h-auto text-accent opacity-60" />
        <span className="relative z-10 px-2 py-0.5 rounded-pill bg-panel/70 text-muted text-[11px] font-mono tabular-nums backdrop-blur-sm">
          {formatDuration(elapsedSec)}
        </span>
        {/* Floating stop label on top */}
        <span className="relative z-10 flex items-center gap-1.5 px-3 py-1 rounded-pill bg-panel/70 text-main text-xs font-semibold backdrop-blur-sm">
          {error ? (
            <span className="text-status-err font-normal">{error}</span>
          ) : transcribing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Wird erkannt…
            </>
          ) : (
            <>
              <Square className="w-3 h-3 fill-current" /> Stopp
            </>
          )}
        </span>
      </div>
    </button>
  );
};
