import React from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '../../../lib/types';
import i18n, { languageName } from '../../../i18n';
import { browserRecognition, type EffectiveVoiceMode } from '../../../lib/voice';
import { voiceLanguageOptions } from '../../../lib/voiceLanguages';
import { SelectMenu } from '../../../components/SelectMenu';
import { InstantSaveToast, useInstantSave } from './InstantSave';

// Voice input: Whisper server or the browser (only offered with a Whisper server that allows the
// browser), and the language spoken into the microphone
export function useVoiceSetting(onUserUpdated: (u: User) => void) {
  const instant = useInstantSave(onUserUpdated);

  const handleChangeVoiceInput = (next: '' | 'browser') => instant.save({ voiceInput: next });
  const handleChangeVoiceLanguage = (next: string) => instant.save({ voiceLanguage: next });

  return { instant, voiceSaving: instant.saving, handleChangeVoiceInput, handleChangeVoiceLanguage };
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
  const { t } = useTranslation('settings');
  const { instant, voiceSaving, handleChangeVoiceInput, handleChangeVoiceLanguage } = voice;
  // Without recognition in this browser (e.g. the desktop app's WebKitGTK) the Whisper server does it, whatever was picked
  const browserMissing = !browserRecognition();
  const picked = browserMissing ? '' : currentUser.voiceInput || '';
  // Whisper does the recognition (only then "automatic" works)
  const whisper = choice ? picked === '' : mode === 'server';
  // No choice yet means automatic
  const spoken = currentUser.voiceLanguage || 'auto';
  const languages = voiceLanguageOptions();
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('voice.title')}</h2>
        <p className="text-muted mt-0.5">{t('voice.intro')}</p>
      </div>
      <InstantSaveToast save={instant} />
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
              text: t('voice.browserHint'),
              unavailable: browserMissing },
          ]).map((opt) => {
            const selected = picked === opt.value;
            const unavailable = 'unavailable' in opt && opt.unavailable;
            return (
              <button
                key={opt.value || 'server'}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={voiceSaving || unavailable}
                onClick={() => !selected && void handleChangeVoiceInput(opt.value)}
                className={`w-full text-left p-3 rounded-card border flex items-start gap-3 transition-colors disabled:opacity-60 ${
                  selected ? 'border-accent bg-accent/10' : 'border-border bg-canvas hover:bg-panel-hover'
                }`}
              >
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 ${selected ? 'border-accent bg-accent' : 'border-strong'}`}
                  aria-hidden="true"
                />
                <span className="space-y-0.5">
                  <span className="block font-semibold text-main">{opt.title}</span>
                  <span className="block text-muted leading-relaxed">{opt.text}</span>
                  {unavailable && <span className="block text-status-err leading-relaxed">{t('voice.browserUnavailable')}</span>}
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
