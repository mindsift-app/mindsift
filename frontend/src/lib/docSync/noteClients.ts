// Client ids of the sync engines of open notes. A live drawing that ends with "Fertig" hands the bullet's
// lease to the note of the person saving (DRAW_DONE carries this id), so the save is no conflict. The
// drawing names its own engine (NoteClientContext); this registry is the fallback and tells whether a note
// is open at all. A note can be open in two places of the tab at once (two engines): it counts as open
// until the last of them closes.
const clients = new Map<string, string[]>();

// Told when a note is no longer open anywhere here (the note list then drops its bullets)
const closedListeners = new Set<(docId: string) => void>();

export function registerNoteClient(docId: string, clientId: string): () => void {
  clients.set(docId, [...(clients.get(docId) || []).filter((id) => id !== clientId), clientId]);
  return () => {
    const ids = clients.get(docId);
    if (!ids?.includes(clientId)) return;
    const rest = ids.filter((id) => id !== clientId);
    if (rest.length > 0) {
      clients.set(docId, rest);
      return;
    }
    clients.delete(docId);
    closedListeners.forEach((listener) => listener(docId));
  };
}

/** The engine of the note opened last here (undefined: the note is not open). */
export function noteClientId(docId: string): string | undefined {
  const ids = clients.get(docId);
  return ids?.[ids.length - 1];
}

/** Calls the listener with the id of each note that closes; returns the function that stops it. */
export function onNoteClosed(listener: (docId: string) => void): () => void {
  closedListeners.add(listener);
  return () => {
    closedListeners.delete(listener);
  };
}
