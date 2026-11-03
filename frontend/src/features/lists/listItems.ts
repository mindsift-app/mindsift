import { ListItem, SharedList } from '../../lib/types';

// How the shopping lists read and group their entries. Pure functions.

// "Hafermilch #Kühlregal" → content "Hafermilch", category "Kühlregal" (the first hashtag); only a hashtag
// becomes the content itself
export function parseListItemInput(rawText: string, defaultQty?: string): {
  content: string;
  quantity: string;
  category?: string;
} {
  let text = rawText.trim();
  const hashtagRegex = /#([a-zA-Z0-9äöüÄÖÜß_-]+)/g;
  const matches = Array.from(text.matchAll(hashtagRegex));

  let category: string | undefined = undefined;
  if (matches.length > 0) {
    category = matches[0][1];
    text = text.replace(hashtagRegex, '').replace(/\s+/g, ' ').trim();
  }

  if (!text && matches.length > 0) {
    text = matches[0][1];
  }

  return {
    content: text,
    quantity: defaultQty?.trim() || '',
    category,
  };
}

export function getItemCategory(item: ListItem): string {
  if (item.category && item.category.trim()) {
    return item.category.trim().replace(/^#/, '');
  }
  const match = item.content.match(/#([a-zA-Z0-9äöüÄÖÜß_-]+)/);
  if (match) {
    return match[1];
  }
  return '';
}

export function getItemDisplayContent(item: ListItem): string {
  if (item.content.includes('#')) {
    const cleaned = item.content.replace(/#([a-zA-Z0-9äöüÄÖÜß_-]+)/g, '').replace(/\s+/g, ' ').trim();
    if (cleaned) return cleaned;
  }
  return item.content;
}

export function deduplicateItems(items: ListItem[]): ListItem[] {
  const seen = new Set<string>();
  const result: ListItem[] = [];
  for (const item of items) {
    if (item && item.id && !seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

// Viewers of a shared list can only read it
export const canWriteList = (lst: SharedList) => lst.isOwner || lst.role !== 'viewer';

export type ItemGroup = { category: string; label: string; items: ListItem[] };

// Open entries by category: case-insensitive (key in lower case), the label written with a capital letter
// unless one entry writes it that way, sorted by label; entries without a category last ("Allgemein" when
// there are categories too)
export function groupOpenItems(openItems: ListItem[]): ItemGroup[] {
  const groupsMap = new Map<string, ListItem[]>();
  const canonicalMap = new Map<string, string>();
  const uncategorized: ListItem[] = [];

  for (const item of openItems) {
    const cat = getItemCategory(item);
    if (!cat) {
      uncategorized.push(item);
    } else {
      const key = cat.toLowerCase();
      const list = groupsMap.get(key) || [];
      list.push(item);
      groupsMap.set(key, list);

      const currentCanonical = canonicalMap.get(key);
      if (!currentCanonical) {
        const formatted = cat.charAt(0).toUpperCase() + cat.slice(1);
        canonicalMap.set(key, formatted);
      } else if (cat[0] === cat[0].toUpperCase() && currentCanonical[0] === currentCanonical[0].toLowerCase()) {
        canonicalMap.set(key, cat);
      }
    }
  }

  const sortedKeys = Array.from(groupsMap.keys()).sort((a, b) => {
    const labelA = canonicalMap.get(a) || a;
    const labelB = canonicalMap.get(b) || b;
    return labelA.localeCompare(labelB, 'de', { sensitivity: 'base' });
  });

  const result: ItemGroup[] = [];

  for (const key of sortedKeys) {
    const displayLabel = canonicalMap.get(key) || key;
    result.push({
      category: key,
      label: `#${displayLabel}`,
      items: groupsMap.get(key)!,
    });
  }

  if (uncategorized.length > 0) {
    result.push({
      category: '',
      label: result.length > 0 ? 'Allgemein' : '',
      items: uncategorized,
    });
  }

  return result;
}

// Every hashtag of all lists (categories and hashtags in the text) and of the workspace, once each
// (case-insensitive, with a capital letter unless an entry writes it that way), sorted
export function collectHashtags(lists: SharedList[], workspaceTags: string[]): string[] {
  const tagMap = new Map<string, string>();

  // 1. Collect from all lists and items (open and completed)
  for (const l of lists) {
    for (const item of l.items) {
      if (item.category && item.category.trim()) {
        const raw = item.category.trim().replace(/^#/, '');
        if (raw) {
          const lower = raw.toLowerCase();
          const existing = tagMap.get(lower);
          const formatted = raw.charAt(0).toUpperCase() + raw.slice(1);
          if (!existing || (raw[0] === raw[0].toUpperCase() && existing[0] === existing[0].toLowerCase())) {
            tagMap.set(lower, formatted);
          }
        }
      }
      if (item.content && item.content.includes('#')) {
        const matches = item.content.matchAll(/#([a-zA-Z0-9äöüÄÖÜß_-]+)/g);
        for (const m of matches) {
          const raw = m[1];
          const lower = raw.toLowerCase();
          const existing = tagMap.get(lower);
          const formatted = raw.charAt(0).toUpperCase() + raw.slice(1);
          if (!existing || (raw[0] === raw[0].toUpperCase() && existing[0] === existing[0].toLowerCase())) {
            tagMap.set(lower, formatted);
          }
        }
      }
    }
  }

  // 2. Also incorporate workspace tags
  for (const t of workspaceTags) {
    const raw = t.trim().replace(/^#/, '');
    if (raw) {
      const lower = raw.toLowerCase();
      if (!tagMap.has(lower)) {
        tagMap.set(lower, raw.charAt(0).toUpperCase() + raw.slice(1));
      }
    }
  }

  return Array.from(tagMap.values()).sort((a, b) =>
    a.localeCompare(b, 'de', { sensitivity: 'base' })
  );
}

// The hashtag being typed right before the cursor ("#Kü"): its text, where its "#" stands, the cursor
export function findHashtagQuery(text: string, pos: number): { query: string; matchIndex: number; cursorPos: number } | null {
  const textBefore = text.slice(0, pos);
  const match = textBefore.match(/(?:^|\s)#([a-zA-Z0-9äöüÄÖÜß_-]*)$/);
  if (!match) return null;
  return {
    query: match[1],
    matchIndex: match.index! + (match[0].startsWith(' ') ? 1 : 0),
    cursorPos: pos,
  };
}

// Suggestions for the typed part: the ones starting with it first, then the ones containing it; all for "#"
export function matchHashtags(query: string, allAvailableHashtags: string[]): string[] {
  const q = query.toLowerCase();
  if (!q) {
    return allAvailableHashtags;
  }
  const startsWithMatches: string[] = [];
  const containsMatches: string[] = [];
  for (const tag of allAvailableHashtags) {
    const lower = tag.toLowerCase();
    if (lower.startsWith(q)) {
      startsWithMatches.push(tag);
    } else if (lower.includes(q)) {
      containsMatches.push(tag);
    }
  }
  return [...startsWithMatches, ...containsMatches];
}
