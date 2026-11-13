import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { useVoiceInput } from '../lib/useVoiceInput';
import { triggerHaptic } from '../lib/api';
import { VoiceWave } from './VoiceWave';

interface VoiceInputButtonProps {
  // The field's text; dictated words are appended to what was there when the recording started
  value: string;
  onChange: (text: string) => void;
  onError?: (message: string) => void;
  // Field to focus once the text is final
  focusRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  className?: string;
}

// Microphone inside an input row, like the one in Quick Dump (Doku/ui-patterns.md). Hidden when voice
// input is off or the browser cannot do it (e.g. Firefox without an own Whisper server).
export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({ value, onChange, onError, focusRef, className = '' }) => {
  const { t } = useTranslation();
  const baseRef = useRef('');
  const voice = useVoiceInput({
    onText: (text, final) => {
      const base = baseRef.current;
      if (text) onChange(base ? `${base} ${text}` : text);
      if (final) focusRef?.current?.focus();
    },
    onError,
  });
  if (!voice.available) return null;
  const listening = voice.state === 'listening';
  const transcribing = voice.state === 'transcribing';

  return (
    <span className={`inline-flex items-center gap-1 flex-shrink-0 ${className}`}>
      {listening && voice.mode === 'server' && <VoiceWave getLevel={voice.level} className="h-3.5 text-accent" />}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (voice.state === 'idle') {
            baseRef.current = value.trim();
            triggerHaptic(20);
          }
          voice.toggle();
        }}
        disabled={transcribing}
        title={listening ? t('voice.stop') : transcribing ? t('voice.transcribing') : t('voice.input')}
        aria-label={listening ? t('voice.stop') : transcribing ? t('voice.transcribing') : t('voice.input')}
        className={`w-9 h-9 sm:w-7 sm:h-7 rounded-full flex items-center justify-center transition-colors ${
          listening || transcribing ? 'bg-accent-dim text-accent' : 'text-muted hover:text-main hover:bg-panel-elevated'
        }`}
      >
        {transcribing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : listening ? (
          <MicOff className="w-3.5 h-3.5" />
        ) : (
          <Mic className="w-3.5 h-3.5" />
        )}
      </button>
    </span>
  );
};
