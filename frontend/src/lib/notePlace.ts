// Where the user was in a note: the zoomed bullet and how far the note was scrolled (in that zoom).
// Remembered per device (localStorage) for the last notes opened, so switching to another tab or looking
// into another note for a moment comes back to the same spot. Not a history: one place per note.
const KEY = 'mindsift_note_place';
const MAX_NOTES = 20;

export interface NotePlace {
  zoom: string | null;
  scroll: number;
}

type Stored = Record<string, NotePlace & { at: number }>;

function readAll(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function readNotePlace(docId: string): NotePlace | null {
  const p = readAll()[docId];
  if (!p || typeof p !== 'object') return null;
  return { zoom: typeof p.zoom === 'string' ? p.zoom : null, scroll: Number(p.scroll) > 0 ? Number(p.scroll) : 0 };
}

export function writeNotePlace(docId: string, place: NotePlace) {
  const all = readAll();
  all[docId] = { zoom: place.zoom, scroll: Math.max(0, Math.round(place.scroll)), at: Date.now() };
  const ids = Object.keys(all);
  if (ids.length > MAX_NOTES) {
    ids
      .sort((a, b) => (all[b].at || 0) - (all[a].at || 0))
      .slice(MAX_NOTES)
      .forEach((id) => delete all[id]);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the note simply opens at the top
  }
}
