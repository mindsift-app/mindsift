import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../../../i18n';
import { helpContent } from '../content';

describe('help content', () => {
  const german = helpContent('de');

  it.each(LANGUAGES.map((l) => l.id))('%s has the same cards and shortcut count as the German help', (id) => {
    const content = helpContent(id);
    expect(content.cards.map((c) => [c.id, c.category])).toEqual(german.cards.map((c) => [c.id, c.category]));
    expect(content.shortcuts).toHaveLength(german.shortcuts.length);
  });
});
