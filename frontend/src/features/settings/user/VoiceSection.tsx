import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '../../../lib/types';
import { api } from '../../../lib/api';

// Voice input: Whisper server or the browser (only offered with a Whisper server that allows the browser)
export function useVoiceSetting(onUserUpdated: (u: User) => void) {
  const [voiceSaving, setVoiceSaving] = useState(false);

  const handleChangeVoiceInput = async (next: '' | 'browser') => {
    setVoiceSaving(true);
    try {
      onUserUpdated(await api.updateSettings({ voiceInput: next }));
    } finally {
      setVoiceSaving(false);
    }
  };

  return { voiceSaving, handleChangeVoiceInput };
}

// Kontoeinstellungen → Spracheingabe
export function VoiceSection({ voice, currentUser }: { voice: ReturnType<typeof useVoiceSetting>; currentUser: User }) {
  const { t } = useTranslation('settings');
  const { voiceSaving, handleChangeVoiceInput } = voice;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('voice.title')}</h2>
        <p className="text-muted mt-0.5">{t('voice.intro')}</p>
      </div>
      <div className="space-y-2" role="radiogroup" aria-label={t('voice.title')}>
        {([
          {
            value: '' as const,
            title: t('voice.server'),
            text: t('voice.serverHint') },
          {
            value: 'browser' as const,
            title: t('voice.browser'),
            text: t('voice.browserHint') },
        ]).map((opt) => {
          const selected = (currentUser.voiceInput || '') === opt.value;
          return (
            <button
              key={opt.value || 'server'}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={voiceSaving}
              onClick={() => !selected && void handleChangeVoiceInput(opt.value)}
              className={`w-full text-left p-3 rounded-card border flex items-start gap-3 transition-colors disabled:opacity-60 ${
                selected ? 'border-accent bg-accent/10' : 'border-border bg-canvas hover:bg-panel-hover'
              }`}
            >
              <span
                className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 ${selected ? 'border-accent bg-accent' : 'border-strong'}`}
                aria-hidden="true"
              />
              <span className="space-y-0.5">
                <span className="block font-semibold text-main">{opt.title}</span>
                <span className="block text-muted leading-relaxed">{opt.text}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
