import { FALLBACK_LANGUAGE, isLanguage, type Language } from '../../../i18n';
import type { HelpContent } from './types';

// Help content per language, each a chunk of its own that loads when the help is first opened in that language
// (the service worker keeps them all for offline use). A new language needs its loader here.
const loaders: Record<Language, () => Promise<{ default: HelpContent }>> = {
  de: () => import('./de'),
  en: () => import('./en'),
  es: () => import('./es'),
  fr: () => import('./fr'),
  it: () => import('./it'),
};

const loaded: Partial<Record<Language, HelpContent>> = {};

const helpLanguage = (lang: string): Language => (isLanguage(lang) ? lang : FALLBACK_LANGUAGE);

// The help of a language if it has been loaded already, so a second visit shows it at once
export const loadedHelpContent = (lang: string): HelpContent | undefined => loaded[helpLanguage(lang)];

// Loads the help of a language once; when that fails, the German help (the language of the source texts)
export async function loadHelpContent(lang: string): Promise<HelpContent> {
  const id = helpLanguage(lang);
  const done = loaded[id];
  if (done) return done;
  try {
    return (loaded[id] = (await loaders[id]()).default);
  } catch (err) {
    if (id === FALLBACK_LANGUAGE) throw err;
    return loadHelpContent(FALLBACK_LANGUAGE);
  }
}
