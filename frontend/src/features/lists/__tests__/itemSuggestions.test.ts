import { describe, it, expect } from 'vitest';
import { matchItemSuggestions, suggestionKey, withRecordedUse } from '../itemSuggestions';
import { ListItemSuggestion } from '../../../lib/types';

const now = Date.parse('2026-11-15T12:00:00Z');
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
const s = (content: string, count: number, days: number, category = ''): ListItemSuggestion => ({ content, category, count, lastUsed: ago(days) });

const history = [
  s('Mineralwasser', 3, 1, 'Getränke'),
  s('Milch', 8, 2, 'Kühlregal'),
  s('Mehl', 20, 1),
  s('Hafermilch', 30, 1),
  s('Kokos-Milch', 1, 1),
  s('Mixer-Beutel', 9, 400),
];
const names = (list: ListItemSuggestion[]) => list.map((x) => x.content);

describe('matchItemSuggestions', () => {
  it('ranks starts-with before word-start before contains, then by frequency weighted by recency', () => {
    expect(names(matchItemSuggestions(history, 'mi', [], now))).toEqual(['Milch', 'Mineralwasser', 'Mixer-Beutel', 'Kokos-Milch', 'Hafermilch']);
  });

  it('waits for two letters and ignores case, spaces and typed hashtags', () => {
    expect(matchItemSuggestions(history, 'm', [], now)).toEqual([]);
    expect(names(matchItemSuggestions(history, '  MILCH #Kühlregal', [], now))).toEqual(['Milch', 'Kokos-Milch', 'Hafermilch']);
  });

  it('leaves out names open on the list already', () => {
    expect(names(matchItemSuggestions(history, 'mi', [{ content: 'milch' }, { content: 'Hafermilch #Kühlregal' }], now))).toEqual([
      'Mineralwasser',
      'Mixer-Beutel',
      'Kokos-Milch',
    ]);
  });

  it('shows at most six', () => {
    const many = Array.from({ length: 10 }, (_, i) => s(`Artikel ${i}`, i + 1, 1));
    expect(matchItemSuggestions(many, 'ar', [], now)).toHaveLength(6);
  });
});

describe('withRecordedUse', () => {
  it('counts a known name up, keeps its category when none was typed and adds new names', () => {
    const next = withRecordedUse(history, 'milch', undefined, new Date(now));
    const milk = next.find((x) => suggestionKey(x.content) === 'milch')!;
    expect(milk).toEqual({ content: 'milch', category: 'Kühlregal', count: 9, lastUsed: new Date(now).toISOString() });
    const added = withRecordedUse(history, 'Brot', '#Backwaren', new Date(now));
    expect(added[added.length - 1]).toMatchObject({ content: 'Brot', category: 'Backwaren', count: 1 });
    expect(history).toHaveLength(6); // not changed in place
  });
});
