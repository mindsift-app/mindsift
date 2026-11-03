import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from '../locales/de';

// The languages of the app, each named in itself. Keep in step with Supported in internal/i18n/i18n.go;
// a new language needs its files in locales/<code>/, an entry in resources and one here.
export const LANGUAGES = [{ id: 'de', name: 'Deutsch', locale: 'de-DE' }] as const;
export type Language = (typeof LANGUAGES)[number]['id'];
// German is the language of the source texts: whatever is missing elsewhere shows in German
export const FALLBACK_LANGUAGE: Language = 'de';
export const resources: Record<Language, typeof de> = { de };

void i18n.use(initReactI18next).init({
  resources,
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  ns: Object.keys(de),
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React escapes on its own
});

export const isLanguage = (v?: string | null): v is Language => LANGUAGES.some((l) => l.id === v);

// The first of the browser's languages the app speaks, or '' when there is none
export function browserLanguage(tags: readonly string[] = navigator.languages ?? [navigator.language]): Language | '' {
  for (const tag of tags) {
    const code = (tag || '').toLowerCase().split(/[-_]/)[0];
    if (isLanguage(code)) return code;
  }
  return '';
}

// Which language the app shows: the person's own choice, else the browser's, else the server's default
export function resolveLanguage(own?: string, serverDefault?: string, tags?: readonly string[]): Language {
  if (isLanguage(own)) return own;
  const fromBrowser = browserLanguage(tags);
  if (fromBrowser) return fromBrowser;
  return isLanguage(serverDefault) ? serverDefault : FALLBACK_LANGUAGE;
}

export function applyLanguage(lang: Language) {
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

// Locale for dates, numbers and sorting (lib/format.ts)
export const currentLocale = (): string => LANGUAGES.find((l) => l.id === i18n.language)?.locale ?? 'de-DE';

export const languageName = (id?: string) => LANGUAGES.find((l) => l.id === id)?.name ?? id ?? '';

export default i18n;
