import { ListItem, ListItemSuggestion } from '../../lib/types';

// Suggestions while typing a new list item, from the list's history (GET /lists/{id}/suggestions, kept
// offline by the read cache). Ranked like the server (storage/list_suggestions.go): names starting with
// the typed text first, then names with a word starting with it, then names containing it; within each
// by how often they were added, weighted by how long ago. Pure functions.

const MIN_SUGGESTION_CHARS = 2;
const MAX_SUGGESTIONS = 6;

// The name as the history keys it: lower case, spaces collapsed, hashtags removed unless nothing is left
export function suggestionKey(text: string): string {
  let display = text.replace(/\s+/g, ' ').trim();
  if (display.includes('#')) {
    const cleaned = display.replace(/#([\p{L}\p{N}_-]+)/gu, '').replace(/\s+/g, ' ').trim();
    if (cleaned) display = cleaned;
  }
  return display.toLowerCase();
}

// How often, halved after 60 days without use
function suggestionScore(s: ListItemSuggestion, now: number): number {
  const t = Date.parse(s.lastUsed);
  const days = Number.isNaN(t) ? 0 : Math.max(0, (now - t) / 86_400_000);
  return s.count / (1 + days / 60);
}

// 0 starts with q, 1 a word starts with q, 2 contains q, -1 no match
function tier(key: string, q: string): number {
  if (key.startsWith(q)) return 0;
  if ((' ' + key.replace(/[()\-/,.]/g, ' ')).includes(' ' + q)) return 1;
  if (key.includes(q)) return 2;
  return -1;
}

// The best matches for the typed text, without names that are open on the list already
export function matchItemSuggestions(
  history: ListItemSuggestion[],
  typed: string,
  openItems: Pick<ListItem, 'content'>[],
  now = Date.now(),
  max = MAX_SUGGESTIONS
): ListItemSuggestion[] {
  const q = suggestionKey(typed);
  if (q.length < MIN_SUGGESTION_CHARS) return [];
  const open = new Set(openItems.map((i) => suggestionKey(i.content)));
  return history
    .map((s) => ({ s, key: suggestionKey(s.content), score: suggestionScore(s, now) }))
    .map((r) => ({ ...r, tier: open.has(r.key) ? -1 : tier(r.key, q) }))
    .filter((r) => r.tier >= 0)
    .sort((a, b) => a.tier - b.tier || b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, max)
    .map((r) => r.s);
}

// The history after the item was added here (the server counts it the same way), so the next suggestion
// knows it without loading again
export function withRecordedUse(history: ListItemSuggestion[], content: string, category: string | undefined, at = new Date()): ListItemSuggestion[] {
  const key = suggestionKey(content);
  if (!key) return history;
  const lastUsed = at.toISOString();
  const cat = (category || '').trim().replace(/^#/, '');
  const i = history.findIndex((s) => suggestionKey(s.content) === key);
  if (i < 0) return [...history, { content: content.trim(), category: cat, count: 1, lastUsed }];
  const prev = history[i];
  const next = [...history];
  next[i] = { content: content.trim(), category: cat || prev.category, count: prev.count + 1, lastUsed };
  return next;
}
