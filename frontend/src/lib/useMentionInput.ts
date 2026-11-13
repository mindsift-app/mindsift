import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { MentionCandidate } from './types';
import { mentionQueryAt, mentionRef, rememberMentionNames } from './mentions';

// Where a mention is written: who may be mentioned depends on who can see it
export interface MentionPlace {
  docId?: string;
  taskId?: string;
  taskListId?: string;
}

const MAX_ITEMS = 8;
// Candidates per place, kept a minute so every keystroke does not ask again
const cache = new Map<string, { at: number; people: Promise<MentionCandidate[]> }>();

function candidatesFor(place: MentionPlace): Promise<MentionCandidate[]> {
  const key = JSON.stringify(place);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.people;
  const people = api.getMentionCandidates(place).then((list) => {
    rememberMentionNames(list);
    return list;
  });
  people.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), people });
  return people;
}

function matches(c: MentionCandidate, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const words = [...(c.displayName || '').toLowerCase().split(/\s+/), (c.username || '').toLowerCase()];
  return words.some((w) => w.startsWith(q)) || (c.displayName || '').toLowerCase().startsWith(q);
}

// "@" in a text field opens a picker of people (keyboard: arrows, Enter or Tab, Escape); picking one writes
// {{mention:<id>}}. People without access to the place are listed greyed out and cannot be picked. The
// field reports its text and caret (update) and gets the new text and caret back (apply).
export function useMentionInput(place: MentionPlace | null) {
  const [match, setMatch] = useState<{ query: string; start: number; caret: number } | null>(null);
  const [people, setPeople] = useState<MentionCandidate[] | null>(null);
  const [index, setIndex] = useState(0);
  const placeKey = place ? JSON.stringify(place) : '';

  // Loaded when the picker opens for a place
  const opened = !!match;
  useEffect(() => {
    if (!opened || !placeKey) return;
    let cancelled = false;
    candidatesFor(JSON.parse(placeKey) as MentionPlace)
      .then((list) => {
        if (!cancelled) setPeople(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [opened, placeKey]);

  const items = useMemo(
    () => (match && people ? people.filter((c) => matches(c, match.query)).slice(0, MAX_ITEMS) : []),
    [match, people]
  );
  const firstPickable = useCallback((from: number, step: 1 | -1) => {
    for (let n = 0; n < items.length; n++) {
      const i = (from + step * n + items.length * 2) % items.length;
      if (items[i]?.hasAccess) return i;
    }
    return -1;
  }, [items]);
  useEffect(() => {
    // New suggestions mark the first one that can be picked
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIndex(firstPickable(0, 1));
  }, [items, firstPickable]);

  const update = useCallback(
    (text: string, caret: number) => {
      if (!placeKey) return;
      const m = mentionQueryAt(text, caret);
      setMatch(m ? { ...m, caret } : null);
    },
    [placeKey]
  );
  const close = useCallback(() => setMatch(null), []);

  const pick = useCallback(
    (c: MentionCandidate, text: string, apply: (next: string, caret: number) => void) => {
      if (!match || !c.hasAccess) return;
      const ref = mentionRef(c.id) + ' ';
      const next = text.slice(0, match.start) + ref + text.slice(match.caret);
      rememberMentionNames([c]);
      setMatch(null);
      apply(next, match.start + ref.length);
    },
    [match]
  );

  // For the field's onKeyDown: true when the picker used the key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, text: string, apply: (next: string, caret: number) => void): boolean => {
      if (!match || items.length === 0) return false;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMatch(null);
        return true;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setIndex((i) => firstPickable((i < 0 ? 0 : i) + step, step));
        return true;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && index >= 0 && items[index]) {
        e.preventDefault();
        e.stopPropagation();
        pick(items[index], text, apply);
        return true;
      }
      return false;
    },
    [match, items, index, firstPickable, pick]
  );

  return { open: !!match && items.length > 0, items, index, setIndex, update, close, pick, handleKeyDown };
}

export type MentionInput = ReturnType<typeof useMentionInput>;
