import i18n from '../../i18n';
import { api } from '../../lib/api';
import { extractHashtags } from '../../lib/hashtags';
import { parseNaturalDate } from '../../lib/naturalDate';
import { Thought } from '../../lib/types';

/** What a dictation saved: the entry, the text as spoken and the due date taken from it ('' without one). */
export interface SavedDictation {
  thought: Thought;
  dictated: string;
  due: string;
}

/** What the hold-to-dictate buttons show after saving: the recognised date and how to take it back. */
export interface DictationOutcome {
  due: string;
  undo: () => Promise<void>;
}

/**
 * Text dictated by holding a + (the phone's floating button and the desktop rail) goes into the inbox:
 * source "voice", so the server tags it #diktat, normal priority. A date in it ("Zahnarzt morgen um 14 Uhr")
 * is read like in the capture bar (lib/naturalDate.ts, the app's language, from now) and becomes the due
 * date, its phrase taken out of the text; when nothing else would be left, the text stays as it is.
 */
export async function captureDictation(text: string, now: Date = new Date(), lang: string = i18n.language): Promise<SavedDictation> {
  const parsed = parseNaturalDate(text, lang, now);
  const content = parsed ? parsed.title : text;
  const due = parsed ? parsed.due : '';
  const thought = await api.captureThought(content, 'normal', 'voice', due, { target: 'inbox' });
  return { thought, dictated: text, due };
}

/**
 * Takes the recognised date back: the entry gets the text as dictated and no due date. Does nothing (null)
 * when it is gone, no longer in the inbox (sorted meanwhile) or its text was changed since.
 */
export async function undoDictationDate(saved: SavedDictation): Promise<Thought | null> {
  let current: Thought;
  try {
    current = await api.getThought(saved.thought.id);
  } catch {
    return null;
  }
  if (current.status !== 'inbox' || current.content !== saved.thought.content) return null;
  // A new text makes the server read its tags from it, which would drop #diktat
  const tags = Array.from(new Set([...(current.tags ?? []), ...extractHashtags(saved.dictated)]));
  return api.updateThought(current.id, { content: saved.dictated, dueDate: '', tags });
}
