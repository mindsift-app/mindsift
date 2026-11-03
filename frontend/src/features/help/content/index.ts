import { Language } from '../../../i18n';
import type { HelpContent } from './types';
import de from './de';
import en from './en';
import es from './es';
import fr from './fr';
import it from './it';

// Help content per language; a language without its own file shows the German help
const CONTENT: Partial<Record<Language, HelpContent>> = { de, en, es, fr, it };

export const helpContent = (lang: string): HelpContent => CONTENT[lang as Language] ?? de;
