import { api } from './api';

interface Piece {
  blob: Promise<Blob | null>;
  // null until the server answered for this piece
  text: string | null;
  task: Promise<void>;
  // Aborts the piece's request when the recording goes to the server as a whole (handOver)
  abort: AbortController | null;
}

/** One part of a recording with the text recognised for it so far (null: not yet). */
export interface RecordedPart {
  blob: Blob;
  text: string | null;
}

/**
 * The text of one recording sent to the own Whisper server in pieces (lib/useVoiceInput.ts cuts them while
 * speaking). Each piece is sent as soon as it is cut; result() waits for all and joins them in recording
 * order. A piece that fails keeps its audio, so retry() sends only the failed pieces again and nothing
 * spoken is lost. Used where a recording is handed on and transcribed in the background (dictation queue).
 * handOver() ends that and gives the parts with what is known of their text, for the server to finish
 * (features/capture/serverDictation.ts).
 */
export class SegmentedTranscription {
  private pieces: Piece[] = [];
  private discarded = false;

  /** progress: the text of the pieces done so far, in order (for a live preview while recording). */
  constructor(private progress?: (text: string) => void) {}

  add(blob: Promise<Blob | null>): void {
    const piece: Piece = { blob, text: null, task: Promise.resolve(), abort: null };
    piece.task = this.send(piece);
    this.pieces.push(piece);
  }

  private send(piece: Piece): Promise<void> {
    const abort = typeof AbortController === 'undefined' ? null : new AbortController();
    piece.abort = abort;
    const task = piece.blob
      .then((b) => (b && b.size > 0 ? api.transcribe(b, abort?.signal) : ''))
      .then((text) => {
        if (this.discarded) return;
        piece.text = text || '';
        this.progress?.(this.joined());
      });
    // Read by result(); without this an early failure would count as unhandled until then
    task.catch(() => {});
    return task;
  }

  private joined(): string {
    return this.pieces
      .map((p) => (p.text ?? '').trim())
      .filter(Boolean)
      .join(' ');
  }

  /** All pieces joined in recording order; rejects with the first failure (the audio stays for retry()). */
  async result(): Promise<string> {
    // A piece may be retried while this waits: wait until every piece has an answer or one failed
    for (;;) {
      const tasks = this.pieces.map((p) => p.task);
      await Promise.all(tasks);
      if (this.discarded) return '';
      if (this.pieces.every((p) => p.text !== null)) return this.joined();
    }
  }

  /** Sends the pieces again that have no text yet (their server request failed). */
  retry(): Promise<string> {
    for (const piece of this.pieces) {
      if (piece.text === null) piece.task = this.send(piece);
    }
    return this.result();
  }

  /**
   * Stops waiting for answers (requests still on their way are aborted, late answers ignored) and gives
   * every part that holds something, in order, with its text where it came already.
   */
  async handOver(): Promise<RecordedPart[]> {
    this.discard();
    for (const p of this.pieces) if (p.text === null) p.abort?.abort();
    const blobs = await Promise.all(this.pieces.map((p) => p.blob.catch(() => null)));
    const parts: RecordedPart[] = [];
    this.pieces.forEach((p, i) => {
      const blob = blobs[i];
      if (blob && blob.size > 0) parts.push({ blob, text: p.text });
    });
    return parts;
  }

  /** Answers that still arrive are ignored. */
  discard(): void {
    this.discarded = true;
    this.progress = undefined;
  }
}
