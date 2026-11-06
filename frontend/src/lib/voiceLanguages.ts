import { compareText } from './format';
import { currentLocale } from '../i18n';

// The languages Whisper recognizes (same list in internal/storage/voice_language.go). Their names come
// from the browser in the app's language, so they need no translation.
export const WHISPER_LANGUAGES = [
  'af', 'am', 'ar', 'as', 'az', 'ba', 'be', 'bg', 'bn', 'bo', 'br', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'es', 'et', 'eu', 'fa', 'fi', 'fo', 'fr', 'gl', 'gu', 'ha', 'haw', 'he', 'hi', 'hr', 'ht', 'hu', 'hy',
  'id', 'is', 'it', 'ja', 'jw', 'ka', 'kk', 'km', 'kn', 'ko', 'la', 'lb', 'ln', 'lo', 'lt', 'lv', 'mg', 'mi',
  'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'nn', 'no', 'oc', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru',
  'sa', 'sd', 'si', 'sk', 'sl', 'sn', 'so', 'sq', 'sr', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl',
  'tr', 'tt', 'uk', 'ur', 'uz', 'vi', 'yi', 'yo', 'yue', 'zh',
] as const;

/** Whisper's code as a BCP 47 tag (Whisper writes Javanese as "jw"). */
export const voiceLanguageTag = (code: string) => (code === 'jw' ? 'jv' : code);

export function voiceLanguageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([currentLocale()], { type: 'language' }).of(voiceLanguageTag(code));
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(currentLocale()) + name.slice(1);
  } catch {
    // older browsers: the code itself
  }
  return code;
}

/** All languages with their names, sorted by name. */
export const voiceLanguageOptions = () =>
  WHISPER_LANGUAGES.map((code) => ({ code, name: voiceLanguageName(code) })).sort((a, b) => compareText(a.name, b.name));
