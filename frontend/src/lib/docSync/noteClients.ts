// Client ids of the sync engines of open notes. A live drawing that ends with "Fertig" hands the bullet's
// lease to the note of the person saving (DRAW_DONE carries this id), so the save is no conflict.
const clients = new Map<string, string>();

// Told when a note is no longer open anywhere here (the note list then drops its bullets)
const closedListeners = new Set<(docId: string) => void>();

export function registerNoteClient(docId: string, clientId: string): () => void {
  clients.set(docId, clientId);
  return () => {
    if (clients.get(docId) !== clientId) return;
    clients.delete(docId);
    closedListeners.forEach((listener) => listener(docId));
  };
}

export function noteClientId(docId: string): string | undefined {
  return clients.get(docId);
}

/** Calls the listener with the id of each note that closes; returns the function that stops it. */
export function onNoteClosed(listener: (docId: string) => void): () => void {
  closedListeners.add(listener);
  return () => {
    closedListeners.delete(listener);
  };
}
