import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../../../i18n';
import { loadedHelpContent, loadHelpContent } from '../content';

describe('help content', () => {
  it.each(LANGUAGES.map((l) => l.id))('%s has the same cards and shortcut count as the German help', async (id) => {
    const german = await loadHelpContent('de');
    const content = await loadHelpContent(id);
    expect(content.cards.map((c) => [c.id, c.category])).toEqual(german.cards.map((c) => [c.id, c.category]));
    expect(content.shortcuts).toHaveLength(german.shortcuts.length);
  });

  it('keeps a loaded language and shows German for a language without help', async () => {
    const english = await loadHelpContent('en');
    expect(loadedHelpContent('en')).toBe(english);
    expect(await loadHelpContent('xx')).toBe(await loadHelpContent('de'));
  });
});
