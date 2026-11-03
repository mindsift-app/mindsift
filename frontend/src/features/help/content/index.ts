import { Language } from '../../../i18n';
import type { HelpContent } from './types';
import de from './de';

// Help content per language; a language without its own file shows the German help
const CONTENT: Partial<Record<Language, HelpContent>> = { de };

export const helpContent = (lang: string): HelpContent => CONTENT[lang as Language] ?? de;
