import { createContext } from 'react';

// Whether the open note is shared with someone (the sync engine's `shared`): only then may a drawing in it
// start a live session ("Gemeinsam zeichnen"), as only then could anyone else join
export const NoteSharedContext = createContext(false);
