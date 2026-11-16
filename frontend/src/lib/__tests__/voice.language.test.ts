import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ api: {} }));

import { browserVoiceLanguage, resetVoiceConfig, setVoiceLanguage, speechRecognitionTag } from '../voice';

afterEach(() => resetVoiceConfig());

describe('language of the browser speech recognition', () => {
  it('turns the app languages into full tags (a bare "de" lets Chrome listen for English)', () => {
    expect(speechRecognitionTag('de', [])).toBe('de-DE');
    expect(speechRecognitionTag('en', [])).toBe('en-US');
    expect(speechRecognitionTag('es', [])).toBe('es-ES');
    expect(speechRecognitionTag('fr', [])).toBe('fr-FR');
    expect(speechRecognitionTag('it', [])).toBe('it-IT');
  });

  it("prefers the browser's own locale of the same language", () => {
    expect(speechRecognitionTag('de', ['en-US', 'de-AT', 'de'])).toBe('de-AT');
    expect(speechRecognitionTag('en', ['de-DE', 'en-GB'])).toBe('en-GB');
    // A browser locale of another language does not count
    expect(speechRecognitionTag('de', ['en-US'])).toBe('de-DE');
  });

  it('keeps a tag that already has a region and finds one for other languages', () => {
    expect(speechRecognitionTag('pt-BR', [])).toBe('pt-BR');
    expect(speechRecognitionTag('nl', [])).toBe('nl-NL');
    // Whisper writes Javanese as "jw"
    expect(speechRecognitionTag('jw', [])).toMatch(/^jv(-[A-Z]{2})?$/);
  });

  it('uses the app language without a chosen one, also with "Automatisch" and "Wie die App"', () => {
    expect(browserVoiceLanguage('de', [])).toBe('de-DE');
    setVoiceLanguage('auto');
    expect(browserVoiceLanguage('de', ['de-CH'])).toBe('de-CH');
    setVoiceLanguage('app');
    expect(browserVoiceLanguage('fr', [])).toBe('fr-FR');
  });

  it('uses the chosen spoken language as a full tag', () => {
    setVoiceLanguage('de');
    expect(browserVoiceLanguage('en', ['en-US'])).toBe('de-DE');
    setVoiceLanguage('it');
    expect(browserVoiceLanguage('de', ['it-CH'])).toBe('it-CH');
  });
});
