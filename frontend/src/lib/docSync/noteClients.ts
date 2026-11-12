// Client ids of the sync engines of open notes. A live drawing that ends with "Fertig" hands the bullet's
// lease to the note of the person saving (DRAW_DONE carries this id), so the save is no conflict.
const clients = new Map<string, string>();

export function registerNoteClient(docId: string, clientId: string): () => void {
  clients.set(docId, clientId);
  return () => {
    if (clients.get(docId) === clientId) clients.delete(docId);
  };
}

export function noteClientId(docId: string): string | undefined {
  return clients.get(docId);
}
