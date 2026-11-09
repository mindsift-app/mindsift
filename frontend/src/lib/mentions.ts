import { useSyncExternalStore } from 'react';
import { api } from './api';

// @-mentions: a text holds {{mention:<user id>}}; the app shows the person's current name, so renaming
// someone changes every mention of them. On public pages the server sends {{mention:hidden}}.
export const MENTION_REF_SOURCE = '\\{\\{mention:[A-Za-z0-9_]+\\}\\}';

export function mentionRef(userId: string): string {
  return `{{mention:${userId}}}`;
}

export function mentionIdOf(token: string): string | null {
  const m = token.match(/^\{\{mention:([A-Za-z0-9_]+)\}\}$/);
  return m ? m[1] : null;
}

// Mentions as "@Name" (copying to other apps, previews, notifications on the device)
export function readableMentions(text: string): string {
  if (!text.includes('{{mention:')) return text;
  return text.replace(new RegExp(MENTION_REF_SOURCE, 'g'), (tok) => `@${mentionName(mentionIdOf(tok) || '')}`);
}

// Names of the people one can see, loaded once from the directory and completed by every picker
const names = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let loading: Promise<void> | null = null;

export function rememberMentionNames(people: { id: string; displayName?: string; username?: string }[]) {
  let changed = false;
  for (const p of people) {
    const name = p.displayName || p.username || '';
    if (p.id && name && names.get(p.id) !== name) {
      names.set(p.id, name);
      changed = true;
    }
  }
  if (changed) {
    version++;
    listeners.forEach((l) => l());
  }
}

function loadNames() {
  if (!loading) {
    loading = api
      .getCollaborators()
      .then((people) => rememberMentionNames(people))
      .catch(() => {
        loading = null;
      });
  }
}

export function mentionName(userId: string): string {
  if (userId === 'hidden') return '…';
  return names.get(userId) || '?';
}

// The current name of a mentioned person; re-renders once the names are loaded
export function useMentionName(userId: string): string {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!names.has(userId) && userId !== 'hidden') loadNames();
      return () => listeners.delete(cb);
    },
    () => version
  );
  return mentionName(userId);
}

// The word being typed after "@" right before the caret, or null
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const m = text.slice(0, caret).match(/(^|[\s(])@([\p{L}\p{N}._-]{0,30})$/u);
  if (!m) return null;
  return { query: m[2], start: m.index! + m[1].length };
}
