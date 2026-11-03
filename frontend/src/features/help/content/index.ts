import { Language } from '../../../i18n';
import type { HelpContent } from './types';
import de from './de';
import en from './en';

// Help content per language; a language without its own file shows the German help
const CONTENT: Partial<Record<Language, HelpContent>> = { de, en };

export const helpContent = (lang: string): HelpContent => CONTENT[lang as Language] ?? de;
