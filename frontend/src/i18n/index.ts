import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type de from '../locales/de';

// The languages of the app, each named in itself. Keep in step with Supported in internal/i18n/i18n.go;
// a new language needs its files in locales/<code>/, a loader below, an entry here and its help
// with its loader (features/help/content).
export const LANGUAGES = [
  { id: 'de', name: 'Deutsch', locale: 'de-DE' },
  { id: 'en', name: 'English', locale: 'en-US' },
  { id: 'es', name: 'Español', locale: 'es-ES' },
  { id: 'fr', name: 'Français', locale: 'fr-FR' },
  { id: 'it', name: 'Italiano', locale: 'it-IT' },
] as const;
export type Language = (typeof LANGUAGES)[number]['id'];
// German is the language of the source texts: whatever is missing elsewhere shows in German
export const FALLBACK_LANGUAGE = 'de' satisfies Language;
// The areas (namespaces) of the texts, as in locales/de/index.ts (a test compares them)
export const NAMESPACES = [
  'common',
  'app',
  'auth',
  'settings',
  'triage',
  'tasks',
  'lists',
  'groups',
  'workspace',
  'help',
  'public',
  'tour',
  'desktop',
] as const satisfies readonly (keyof typeof de)[];
// Every language is a chunk of its own, German included: the start chunk holds no texts. Every language has
// all keys (a test checks), so a start loads only its own; German comes only when that one fails. The page
// preloads the chunk of the language it is served in (vite.config.ts, preloadStartTexts) and the service
// worker keeps them all.
const loaders: Record<Language, () => Promise<{ default: Record<string, object> }>> = {
  de: () => import('../locales/de'),
  en: () => import('../locales/en'),
  es: () => import('../locales/es'),
  fr: () => import('../locales/fr'),
  it: () => import('../locales/it'),
};

// Synchronous and still without texts: they come with startI18n before the first render
void i18n.use(initReactI18next).init({
  initAsync: false,
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  ns: [...NAMESPACES],
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

// Adds the texts of a language (all areas); the tests add German this way without a chunk. Taken as they
// are, neither copied nor merged (i18next would copy them through JSON by default): a language comes whole
// and is never changed, and copying it would cost the start time the separate chunk saves.
export function addTexts(lang: Language, texts: Record<string, object>): void {
  for (const [ns, bundle] of Object.entries(texts)) i18n.addResourceBundle(lang, ns, bundle, false, false, { skipCopy: true });
}

// Loads the texts of a language once
export async function loadLanguage(lang: Language): Promise<void> {
  if (i18n.hasResourceBundle(lang, 'common')) return;
  addTexts(lang, (await loaders[lang]()).default);
}

// The language shown last on this device, so the next start begins in it before the account is known
const LAST_LANGUAGE_KEY = 'mindsift:language';

export async function applyLanguage(lang: Language): Promise<void> {
  await loadLanguage(lang).catch(() => {});
  // Without its texts (offline, chunk missing) the language stays as it is rather than showing German
  if (i18n.language !== lang && i18n.hasResourceBundle(lang, 'common')) await i18n.changeLanguage(lang);
  document.documentElement.lang = i18n.language;
  try {
    localStorage.setItem(LAST_LANGUAGE_KEY, i18n.language);
  } catch {
    // storage blocked: the next start guesses from the browser again
  }
}

// The language the app starts in before the server has answered. With a stored session the one shown
// last on this device (normally the account's); otherwise, and on the first start, what the sign-in page
// will resolve to: the browser's, else the page's (the server sets <html lang> to the browser's or its
// default language). When the account or the server's default says otherwise, App switches on their answer.
export function startLanguage(signedIn: boolean): Language {
  let last: string | null = null;
  try {
    if (signedIn) last = localStorage.getItem(LAST_LANGUAGE_KEY);
  } catch {
    // storage blocked
  }
  return isLanguage(last) ? last : resolveLanguage(undefined, document.documentElement.lang);
}

// Before the first render (main.tsx): the start language is loaded before anything shows, so no raw keys
// flash up. Should its chunk fail, German instead, so the app still has texts. Resolves even when both fail
// (the app then shows what it has).
export async function startI18n(lang: Language): Promise<void> {
  await loadLanguage(lang).catch(() => {});
  if (!i18n.hasResourceBundle(lang, 'common')) await loadLanguage(FALLBACK_LANGUAGE).catch(() => {});
  if (i18n.hasResourceBundle(lang, 'common')) await i18n.changeLanguage(lang);
  document.documentElement.lang = i18n.language;
}

// Texts the app writes into content (a placeholder in a note) are in the person's message language, the
// server's rule for the texts it writes (MessageLanguage in internal/storage/language.go): their own choice,
// else the server's default, never the browser's. So a placeholder reads the same whoever wrote it.
export function messageLanguage(own?: string, serverDefault?: string): Language {
  if (isLanguage(own)) return own;
  return isLanguage(serverDefault) ? serverDefault : FALLBACK_LANGUAGE;
}

let currentMessageLanguage: Language | '' = '';

// App sets it once the account and the server's default are known; its texts are loaded with it
export function setMessageLanguage(lang: Language): void {
  currentMessageLanguage = lang;
  void loadLanguage(lang).catch(() => {});
}

// A text in the message language (the app's language until that is known or its texts are loaded)
export function messageText(key: string): string {
  const [ns] = key.split(':');
  const lng = currentMessageLanguage && i18n.hasResourceBundle(currentMessageLanguage, ns) ? currentMessageLanguage : i18n.language;
  return i18n.t(key, { lng });
}

// Locale for dates, numbers and sorting (lib/format.ts)
export const currentLocale = (): string => LANGUAGES.find((l) => l.id === i18n.language)?.locale ?? 'de-DE';

export const languageName = (id?: string) => LANGUAGES.find((l) => l.id === id)?.name ?? id ?? '';

export default i18n;
