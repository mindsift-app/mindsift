import { describe, expect, it } from 'vitest';
import { CARD_TITLE_MAX, cardTitle } from '../cardTitle';

describe('cardTitle', () => {
  it('keeps short titles as they are', () => {
    expect(cardTitle('Hecke schneiden')).toBe('Hecke schneiden');
  });
  it('shortens long titles at a word with an ellipsis', () => {
    const long = 'Wort '.repeat(60);
    const out = cardTitle(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(CARD_TITLE_MAX + 1);
    expect(out.slice(0, -1).endsWith('Wort')).toBe(true);
  });
  it('cuts a single endless word too', () => {
    const out = cardTitle('x'.repeat(500));
    expect(out).toBe('x'.repeat(CARD_TITLE_MAX) + '…');
  });
});
