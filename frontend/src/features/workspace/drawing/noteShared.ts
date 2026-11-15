import { createContext } from 'react';

// Whether the open note is shared with someone (the sync engine's `shared`): only then may a drawing in it
// start a live session ("Gemeinsam zeichnen"), as only then could anyone else join
export const NoteSharedContext = createContext(false);

// Client id of the sync engine of the note the drawing is in. "Fertig" in a live session hands the bullet's
// lease to that engine (DRAW_DONE), so its save is no conflict: with the same note open twice in this tab
// (two engines) the registry's last one may be the other engine (noteClients.ts)
export const NoteClientContext = createContext<string | undefined>(undefined);
