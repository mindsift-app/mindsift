import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '../../../lib/types';
import { api } from '../../../lib/api';
import { LANGUAGES, languageName } from '../../../i18n';

// Language of the app: own choice or the browser's ('' = browser, then the server's default)
export function useLanguageSetting(onUserUpdated: (u: User) => void) {
  const [languageSaving, setLanguageSaving] = useState(false);

  const handleChangeLanguage = async (next: string) => {
    setLanguageSaving(true);
    try {
      onUserUpdated(await api.updateSettings({ language: next }));
    } finally {
      setLanguageSaving(false);
    }
  };

  return { languageSaving, handleChangeLanguage };
}

// Kontoeinstellungen → Sprache
export function LanguageSection({
  language,
  currentUser,
  serverDefault,
}: {
  language: ReturnType<typeof useLanguageSetting>;
  currentUser: User;
  serverDefault?: string;
}) {
  const { t } = useTranslation('settings');
  const { languageSaving, handleChangeLanguage } = language;
  const options = [
    { value: '', title: t('common:languageAuto'), text: t('language.autoHint', { fallback: languageName(serverDefault || 'de') }) },
    ...LANGUAGES.map((l) => ({ value: l.id as string, title: l.name, text: '' })),
  ];
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('language.title')}</h2>
        <p className="text-muted mt-0.5">{t('language.intro')}</p>
      </div>
      <div className="space-y-2" role="radiogroup" aria-label={t('language.title')}>
        {options.map((opt) => {
          const selected = (currentUser.language || '') === opt.value;
          return (
            <button
              key={opt.value || 'auto'}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={languageSaving}
              onClick={() => !selected && void handleChangeLanguage(opt.value)}
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
                {opt.text && <span className="block text-muted leading-relaxed">{opt.text}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-muted">{t('language.more')}</p>
    </div>
  );
}
