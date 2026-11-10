import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '../../../lib/types';
import { api } from '../../../lib/api';
import { languageName } from '../../../i18n';
import type { EffectiveVoiceMode } from '../../../lib/voice';
import { voiceLanguageOptions } from '../../../lib/voiceLanguages';
import { SelectMenu } from '../../../components/SelectMenu';

// Voice input: Whisper server or the browser (only offered with a Whisper server that allows the
// browser), and the language spoken into the microphone
export function useVoiceSetting(onUserUpdated: (u: User) => void) {
  const [voiceSaving, setVoiceSaving] = useState(false);

  const save = async (settings: { voiceInput?: '' | 'browser'; voiceLanguage?: string }) => {
    setVoiceSaving(true);
    try {
      onUserUpdated(await api.updateSettings(settings));
    } finally {
      setVoiceSaving(false);
    }
  };

  const handleChangeVoiceInput = (next: '' | 'browser') => save({ voiceInput: next });
  const handleChangeVoiceLanguage = (next: string) => save({ voiceLanguage: next });

  return { voiceSaving, handleChangeVoiceInput, handleChangeVoiceLanguage };
}

// Kontoeinstellungen → Spracheingabe
export function VoiceSection({
  voice,
  currentUser,
  choice,
  mode,
}: {
  voice: ReturnType<typeof useVoiceSetting>;
  currentUser: User;
  choice: boolean;
  mode?: EffectiveVoiceMode;
}) {
  const { t, i18n } = useTranslation('settings');
  const { voiceSaving, handleChangeVoiceInput, handleChangeVoiceLanguage } = voice;
  // Whisper does the recognition (only then "automatic" works)
  const whisper = choice ? (currentUser.voiceInput || '') === '' : mode === 'server';
  // No choice yet means automatic
  const spoken = currentUser.voiceLanguage || 'auto';
  const languages = voiceLanguageOptions();
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('voice.title')}</h2>
        <p className="text-muted mt-0.5">{t('voice.intro')}</p>
      </div>
      {choice && (
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
      )}
      <div className="space-y-1.5">
        <p className="block font-semibold text-main">
          {t('voice.languageTitle')}
        </p>
        <p className="text-muted leading-relaxed">{t('voice.languageIntro')}</p>
        <div className="w-full sm:max-w-sm">
          <SelectMenu
            ariaLabel={t('voice.languageTitle')}
            value={spoken}
            disabled={voiceSaving}
            onChange={(code) => void handleChangeVoiceLanguage(code)}
            options={[
              { value: 'auto', label: t('voice.languageAuto') },
              { value: 'app', label: t('voice.languageApp', { name: languageName(i18n.language) }) },
              ...languages.map((l) => ({ value: l.code, label: l.name })),
            ]}
          />
        </div>
        {spoken === 'auto' && (
          <p className="text-muted leading-relaxed">{whisper ? t('voice.languageAutoHint') : t('voice.languageAutoBrowser')}</p>
        )}
      </div>
    </div>
  );
}
