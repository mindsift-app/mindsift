// Dictations waiting for their text and their save, so the next one can be recorded right away
// (features/capture/useHoldToDictate.ts). Each recording is transcribed as soon as it is handed in, several
// at once if they overlap, but saved strictly one after another in the order they were recorded. One that
// fails stays in the queue with its audio or text until it is tried again or thrown away; the ones after it
// are saved meanwhile.
import { errorMessage } from '../../lib/errorMessage';
import { holdReload } from '../../lib/reloadHold';

export type DictationItemState = 'transcribing' | 'saving' | 'failed';

export interface DictationItem {
  id: number;
  state: DictationItemState;
  // Why it failed (state "failed")
  error?: string;
}

export interface DictationSource {
  /** The recognised text; may be asked again after a failure (sends only what is missing). */
  text: () => Promise<string>;
  /** Asked instead of text() to try again; defaults to text(). */
  retry?: () => Promise<string>;
  /** Thrown away: answers that still arrive are ignored. */
  discard?: () => void;
}

interface Entry {
  id: number;
  state: DictationItemState;
  error?: string;
  source: DictationSource;
  pending: Promise<string> | null;
  // Set once recognised, so a failed save is tried again without transcribing again
  text: string | null;
  discarded: boolean;
}

export interface DictationQueueOptions<R> {
  save: (text: string) => Promise<R> | R;
  /** The queue changed (an item was added, done, failed or thrown away). */
  onChange: (items: DictationItem[]) => void;
  onSaved?: (result: R, text: string) => void;
  /** A recording with nothing recognised in it (nothing is saved). */
  onNothing?: () => void;
  onFailed?: (message: string) => void;
  /** The message of an error without one of its own. */
  fallbackMessage: () => string;
}

export class DictationQueue<R = unknown> {
  private entries: Entry[] = [];
  private nextId = 1;
  // Saves run one after another in this chain, in the order the items joined it
  private tail: Promise<void> = Promise.resolve();

  constructor(private options: DictationQueueOptions<R>) {}

  items(): DictationItem[] {
    return this.entries.map(({ id, state, error }) => (error ? { id, state, error } : { id, state }));
  }

  /** Hands in a recording; its transcription starts at once. */
  add(source: DictationSource): number {
    const entry: Entry = { id: this.nextId++, state: 'transcribing', source, pending: null, text: null, discarded: false };
    entry.pending = this.request(source.text);
    this.entries.push(entry);
    this.changed();
    this.enqueue(entry);
    return entry.id;
  }

  /** Tries a failed item again (transcription or save, whichever failed); it is saved after the ones waiting now. */
  retry(id: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.state !== 'failed') return;
    entry.error = undefined;
    if (entry.text === null) {
      entry.state = 'transcribing';
      entry.pending = this.request(entry.source.retry ?? entry.source.text);
    } else {
      entry.state = 'saving';
    }
    this.changed();
    this.enqueue(entry);
  }

  retryFailed(): void {
    this.entries.filter((e) => e.state === 'failed').forEach((e) => this.retry(e.id));
  }

  /** Throws a failed item away for good. */
  discard(id: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.state !== 'failed') return;
    entry.discarded = true;
    entry.source.discard?.();
    this.remove(entry);
  }

  discardFailed(): void {
    this.entries.filter((e) => e.state === 'failed').forEach((e) => this.discard(e.id));
  }

  private request(get: () => Promise<string>): Promise<string> {
    let p: Promise<string>;
    try {
      p = Promise.resolve(get());
    } catch (err) {
      p = Promise.reject(err);
    }
    // Read in order later; until then a failure must not count as unhandled
    p.catch(() => {});
    return p;
  }

  private enqueue(entry: Entry): void {
    this.tail = this.tail.then(() => this.run(entry));
  }

  private async run(entry: Entry): Promise<void> {
    if (entry.discarded) return;
    if (entry.text === null) {
      try {
        entry.text = ((await entry.pending) ?? '').trim();
      } catch (err) {
        this.fail(entry, err);
        return;
      }
      if (entry.discarded) return;
      if (!entry.text) {
        this.remove(entry);
        this.options.onNothing?.();
        return;
      }
    }
    entry.state = 'saving';
    this.changed();
    try {
      const result = await this.options.save(entry.text);
      this.remove(entry);
      this.options.onSaved?.(result, entry.text);
    } catch (err) {
      this.fail(entry, err);
    }
  }

  private fail(entry: Entry, err: unknown): void {
    entry.state = 'failed';
    entry.error = errorMessage(err, this.options.fallbackMessage());
    this.changed();
    this.options.onFailed?.(entry.error);
  }

  private remove(entry: Entry): void {
    this.entries = this.entries.filter((e) => e !== entry);
    this.changed();
  }

  private changed(): void {
    // Dictations not saved yet (failed ones too): the app does not reload for a new version meanwhile
    holdReload(this, this.entries.length > 0);
    this.options.onChange(this.items());
  }
}
