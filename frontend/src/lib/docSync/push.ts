// Push notifications for note sync: the server sends DOC_SEQ into the note's room whenever the note, its
// leases or its presence change. Delivery uses the app-wide realtime connection (WebSocket, else SSE, else
// long polling).
import { createRealtimeConnection, getRealtimeTransport, isRealtimeConnected } from '../api';

export type PushKind = 'ws' | 'sse' | 'poll' | 'none';

export interface PushChannel {
  /** Calls onPoke for changes of docId and onStatus whenever the channel goes up or down. */
  subscribe(docId: string, onPoke: () => void, onStatus: (kind: PushKind) => void): () => void;
}

export const realtimePush: PushChannel = {
  subscribe(docId, onPoke, onStatus) {
    const current = (): PushKind => (isRealtimeConnected() ? (getRealtimeTransport() as PushKind) : 'none');
    const conn = createRealtimeConnection({
      docId,
      onMessage: (msg) => {
        if (msg?.event === 'DOC_SEQ' && (msg.payload as { docId?: string } | undefined)?.docId === docId) onPoke();
      },
      onStatusChange: () => onStatus(current()),
    });
    onStatus(current());
    return () => conn.close();
  },
};
