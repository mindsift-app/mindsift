import { describe, expect, it } from 'vitest';
import { LANGUAGES, resolveLanguage, resources } from '..';

// All keys of a namespace as "a.b.c", so languages can be compared
function keysOf(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
}

describe('locales', () => {
  const german = keysOf(resources.de).sort();

  it.each(LANGUAGES.map((l) => l.id))('%s has exactly the keys of the German texts', (id) => {
    expect(keysOf(resources[id]).sort()).toEqual(german);
  });

  it('keeps the placeholders of the German texts', () => {
    const placeholders = (s: unknown) => (String(s).match(/{{\w+}}/g) || []).sort();
    const get = (obj: unknown, path: string) => path.split('.').reduce((o: any, k) => o?.[k], obj);
    for (const { id } of LANGUAGES) {
      for (const key of german) expect(placeholders(get(resources[id], key)), `${id}: ${key}`).toEqual(placeholders(get(resources.de, key)));
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
  const get = (obj: unknown, path: string) => path.split('.').reduce((o: any, k) => o?.[k], obj);

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
    expect(resolveLanguage('', 'de', ['fr-FR', 'de-AT'])).toBe('de');
    expect(resolveLanguage(undefined, 'de', ['fr-FR'])).toBe('de');
    expect(resolveLanguage('xx', 'yy', [])).toBe('de');
  });
});
