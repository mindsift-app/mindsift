import { describe, it, expect } from 'vitest';
import { ListItem, SharedList } from '../../../lib/types';
import {
  canWriteList,
  collectHashtags,
  deduplicateItems,
  findHashtagQuery,
  getItemCategory,
  getItemDisplayContent,
  groupOpenItems,
  matchHashtags,
  parseListItemInput,
} from '../listItems';

const item = (id: string, content: string, i: Partial<ListItem> = {}) =>
  ({ id, listId: 'l', content, isCompleted: false, sortOrder: 0, createdAt: '', ...i }) as ListItem;

describe('list items', () => {
  it('reads content, category and quantity from the input', () => {
    expect(parseListItemInput('  Hafermilch #Kühlregal  ', ' 2x ')).toEqual({ content: 'Hafermilch', quantity: '2x', category: 'Kühlregal' });
    expect(parseListItemInput('Brot #Bäcker #Frühstück')).toEqual({ content: 'Brot', quantity: '', category: 'Bäcker' });
    expect(parseListItemInput('#Drogerie')).toEqual({ content: 'Drogerie', quantity: '', category: 'Drogerie' });
    expect(parseListItemInput('Äpfel')).toEqual({ content: 'Äpfel', quantity: '', category: undefined });
  });

  it('takes the category from the field, else from a hashtag in the text', () => {
    expect(getItemCategory(item('a', 'Milch', { category: ' #Kühlregal ' }))).toBe('Kühlregal');
    expect(getItemCategory(item('b', 'Milch #kühl'))).toBe('kühl');
    expect(getItemCategory(item('c', 'Milch'))).toBe('');
    expect(getItemDisplayContent(item('d', 'Milch #kühl  frisch'))).toBe('Milch frisch');
    expect(getItemDisplayContent(item('e', '#kühl'))).toBe('#kühl');
  });

  it('drops repeated entries', () => {
    expect(deduplicateItems([item('a', 'x'), item('a', 'y'), item('b', 'z')]).map((i) => i.content)).toEqual(['x', 'z']);
  });

  it('groups open entries by category, case-insensitive, sorted, uncategorized last', () => {
    const groups = groupOpenItems([
      item('1', 'Brot', { category: 'backwaren' }),
      item('2', 'Milch', { category: 'Kühlregal' }),
      item('3', 'Brötchen', { category: 'Backwaren' }),
      item('4', 'Batterien'),
      item('5', 'Äpfel', { category: 'obst' }),
    ]);
    expect(groups.map((g) => [g.category, g.name, g.label, g.items.map((i) => i.id)])).toEqual([
      ['backwaren', 'Backwaren', '#Backwaren', ['1', '3']],
      ['kühlregal', 'Kühlregal', '#Kühlregal', ['2']],
      ['obst', 'Obst', '#Obst', ['5']],
      ['', '', 'Allgemein', ['4']],
    ]);
    expect(groupOpenItems([item('4', 'Batterien')]).map((g) => g.label)).toEqual(['']);
  });

  it('collects hashtags from lists and the workspace, once each and sorted', () => {
    const lists = [
      { id: 'a', items: [item('1', 'Milch', { category: 'kühlregal' }), item('2', 'Brot #Bäcker #frühstück')] },
      { id: 'b', items: [item('3', 'Käse', { category: '#Kühlregal', isCompleted: true })] },
    ] as SharedList[];
    expect(collectHashtags(lists, ['#baumarkt', 'bäcker'])).toEqual(['Bäcker', 'Baumarkt', 'Frühstück', 'Kühlregal']);
  });

  it('finds the hashtag typed before the cursor', () => {
    expect(findHashtagQuery('Milch #Kü', 9)).toEqual({ query: 'Kü', matchIndex: 6, cursorPos: 9 });
    expect(findHashtagQuery('#', 1)).toEqual({ query: '', matchIndex: 0, cursorPos: 1 });
    expect(findHashtagQuery('Milch#Kü', 8)).toBeNull();
    expect(findHashtagQuery('Milch #Kü fertig', 16)).toBeNull();
  });

  it('suggests matches starting with the typed part first', () => {
    const tags = ['Backwaren', 'Kühlregal', 'Tiefkühl'];
    expect(matchHashtags('kühl', tags)).toEqual(['Kühlregal', 'Tiefkühl']);
    expect(matchHashtags('', tags)).toBe(tags);
    expect(matchHashtags('x', tags)).toEqual([]);
  });

  it('lets only owners and editors write', () => {
    expect(canWriteList({ isOwner: true, role: 'viewer' } as SharedList)).toBe(true);
    expect(canWriteList({ isOwner: false, role: 'editor' } as SharedList)).toBe(true);
    expect(canWriteList({ isOwner: false, role: 'viewer' } as SharedList)).toBe(false);
  });
});
