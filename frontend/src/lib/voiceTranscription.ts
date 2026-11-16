import { api } from './api';

interface Piece {
  blob: Promise<Blob | null>;
  // null until the server answered for this piece
  text: string | null;
  task: Promise<void>;
}

/**
 * The text of one recording sent to the own Whisper server in pieces (lib/useVoiceInput.ts cuts them while
 * speaking). Each piece is sent as soon as it is cut; result() waits for all and joins them in recording
 * order. A piece that fails keeps its audio, so retry() sends only the failed pieces again and nothing
 * spoken is lost. Used where a recording is handed on and transcribed in the background (dictation queue).
 */
export class SegmentedTranscription {
  private pieces: Piece[] = [];
  private discarded = false;

  /** progress: the text of the pieces done so far, in order (for a live preview while recording). */
  constructor(private progress?: (text: string) => void) {}

  add(blob: Promise<Blob | null>): void {
    const piece: Piece = { blob, text: null, task: Promise.resolve() };
    piece.task = this.send(piece);
    this.pieces.push(piece);
  }

  private send(piece: Piece): Promise<void> {
    const task = piece.blob
      .then((b) => (b && b.size > 0 ? api.transcribe(b) : ''))
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

  /** Answers that still arrive are ignored. */
  discard(): void {
    this.discarded = true;
    this.progress = undefined;
  }
}
