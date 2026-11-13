import { describe, expect, it } from 'vitest';
import { LANGUAGES, resolveLanguage, resources } from '..';
import en from '../../locales/en';
import es from '../../locales/es';
import fr from '../../locales/fr';
import itLocale from '../../locales/it';

// Every language's texts, loaded directly (the app loads all but German on demand)
const ALL: Record<string, unknown> = { de: resources.de, en, es, fr, it: itLocale };

// All keys of a namespace as "a.b.c", so languages can be compared
function keysOf(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
}

// Plural forms differ by language (key_one, key_other, key_few …); keys are compared without them
const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKey = (k: string) => k.replace(PLURAL, '');
const get = (obj: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
// Placeholders of a key over all its plural forms
function placeholdersByBase(texts: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const k of keysOf(texts)) {
    const set = out.get(baseKey(k)) ?? new Set<string>();
    for (const p of String(get(texts, k)).match(/{{\w+}}/g) || []) set.add(p);
    out.set(baseKey(k), set);
  }
  return out;
}

describe('locales', () => {
  const german = placeholdersByBase(resources.de);

  it('loads every language of the list', () => {
    expect(Object.keys(ALL).sort()).toEqual(LANGUAGES.map((l) => l.id).sort());
  });

  it.each(LANGUAGES.map((l) => l.id))('%s has exactly the keys of the German texts', (id) => {
    expect([...placeholdersByBase(ALL[id]).keys()].sort()).toEqual([...german.keys()].sort());
  });

  it.each(LANGUAGES.map((l) => l.id))('%s keeps the placeholders of the German texts', (id) => {
    const own = placeholdersByBase(ALL[id]);
    for (const [key, de] of german) {
      const mine = own.get(key) ?? new Set<string>();
      // {{count}} may be left out where the language says "one task" instead of "1 task"
      const required = [...de].filter((p) => p !== '{{count}}');
      for (const p of required) expect(mine.has(p), `${id}: ${key} lacks ${p}`).toBe(true);
      for (const p of mine) expect(de.has(p) || p === '{{count}}', `${id}: ${key} has unknown ${p}`).toBe(true);
    }
  });
});

// The project compiles without strictNullChecks, where i18next cannot type its keys; this test does the
// check instead: every t('key') in a file using react-i18next exists in the German texts of its namespace
describe('keys in the code', () => {
  const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/__tests__/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  it('finds every key in the German texts', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const [file, code] of Object.entries(sources)) {
      if (!code.includes("from 'react-i18next'")) continue;
      const ns = code.match(/useTranslation\('(\w+)'\)/)?.[1] ?? 'common';
      for (const [, key] of code.matchAll(/\bt\('([^']+)'/g)) {
        const [keyNs, path] = key.includes(':') ? key.split(':') : [ns, key];
        checked++;
        const nsTexts = (resources.de as Record<string, unknown>)[keyNs];
        // Plural keys exist as key_one / key_other (i18next picks one by count)
        const found = [path, `${path}_one`, `${path}_other`].some((k) => typeof get(nsTexts, k) === 'string');
        if (!found) missing.push(`${file}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe('resolveLanguage', () => {
  it('takes the own choice first', () => {
    expect(resolveLanguage('de', 'de', ['fr-FR'])).toBe('de');
  });

  it('falls back to the browser, then the server default, then German', () => {
    expect(resolveLanguage('', 'de', ['it-IT'])).toBe('it');
    expect(resolveLanguage('', 'de', ['nl-NL', 'de-AT'])).toBe('de');
    expect(resolveLanguage(undefined, 'de', ['nl-NL'])).toBe('de');
    expect(resolveLanguage('xx', 'yy', [])).toBe('de');
  });
});
