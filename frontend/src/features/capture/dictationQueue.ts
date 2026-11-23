// Dictations waiting for their text and their save, so the next one can be recorded right away
// (features/capture/useHoldToDictate.ts). Each recording is transcribed as soon as it is handed in, several
// at once if they overlap, but saved strictly one after another in the order they were recorded. One that
// fails stays in the queue with its audio or text until it is tried again; the ones after it are saved
// meanwhile. Failed ones do not hold the reload for a new version and are lost with it, unless their
// recording is on the server already (serverDictation.ts): the server finishes those by itself.
import { errorMessage } from '../../lib/errorMessage';
import { holdReload } from '../../lib/reloadHold';
import { holdUnload } from '../../lib/leaveGuard';

export type DictationItemState = 'transcribing' | 'saving' | 'failed';

export interface DictationItem {
  id: number;
  state: DictationItemState;
  // Why it failed (state "failed")
  error?: string;
}

export interface DictationSource<R = unknown> {
  /** The recognised text; may be asked again after a failure (sends only what is missing). */
  text: () => Promise<string>;
  /** Asked instead of text() to try again; defaults to text(). */
  retry?: () => Promise<string>;
  /** Saves the text instead of the queue's save (the server saved it already, serverDictation.ts). */
  save?: (text: string) => Promise<R> | R;
}

interface Entry<R> {
  id: number;
  state: DictationItemState;
  error?: string;
  source: DictationSource<R>;
  pending: Promise<string> | null;
  // Set once recognised, so a failed save is tried again without transcribing again
  text: string | null;
}

export interface DictationQueueOptions<R> {
  save: (text: string) => Promise<R> | R;
  /** The queue changed (an item was added, done or failed). */
  onChange: (items: DictationItem[]) => void;
  onSaved?: (result: R, text: string) => void;
  /** A recording with nothing recognised in it (nothing is saved). */
  onNothing?: () => void;
  onFailed?: (message: string) => void;
  /** A recording that failed but is kept elsewhere (HandedOverError): it leaves the queue with this message. */
  onHandedOver?: (message: string) => void;
  /** The message of an error without one of its own. */
  fallbackMessage: () => string;
}

/**
 * Thrown by a source whose recording failed to be transcribed but is safe elsewhere (on the server, shown
 * above the Quick Dump with "Erneut versuchen"): the queue lets it go instead of keeping a second retry.
 */
export class HandedOverError extends Error {}

export class DictationQueue<R = unknown> {
  private entries: Entry<R>[] = [];
  private nextId = 1;
  // Saves run one after another in this chain, in the order the items joined it
  private tail: Promise<void> = Promise.resolve();

  constructor(private options: DictationQueueOptions<R>) {}

  items(): DictationItem[] {
    return this.entries.map(({ id, state, error }) => (error ? { id, state, error } : { id, state }));
  }

  /** Hands in a recording; its transcription starts at once. */
  add(source: DictationSource<R>): number {
    const entry: Entry<R> = { id: this.nextId++, state: 'transcribing', source, pending: null, text: null };
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

  private enqueue(entry: Entry<R>): void {
    this.tail = this.tail.then(() => this.run(entry));
  }

  private async run(entry: Entry<R>): Promise<void> {
    if (entry.text === null) {
      try {
        entry.text = ((await entry.pending) ?? '').trim();
      } catch (err) {
        if (err instanceof HandedOverError) {
          // Kept elsewhere (the server holds the recording, the Quick Dump offers to try again): not here
          this.remove(entry);
          this.options.onHandedOver?.(errorMessage(err, this.options.fallbackMessage()));
          return;
        }
        this.fail(entry, err);
        return;
      }
      if (!entry.text) {
        this.remove(entry);
        this.options.onNothing?.();
        return;
      }
    }
    entry.state = 'saving';
    this.changed();
    try {
      const result = await (entry.source.save ?? this.options.save)(entry.text);
      this.remove(entry);
      this.options.onSaved?.(result, entry.text);
    } catch (err) {
      this.fail(entry, err);
    }
  }

  private fail(entry: Entry<R>, err: unknown): void {
    entry.state = 'failed';
    entry.error = errorMessage(err, this.options.fallbackMessage());
    this.changed();
    this.options.onFailed?.(entry.error);
  }

  private remove(entry: Entry<R>): void {
    this.entries = this.entries.filter((e) => e !== entry);
    this.changed();
  }

  private changed(): void {
    // Dictations still being transcribed or saved: the app does not reload for a new version meanwhile.
    // Failed ones wait for "Erneut versuchen" and do not hold it (a reload loses them).
    holdReload(this, this.entries.some((e) => e.state !== 'failed'));
    // Reloading or closing the page by hand loses all of them, failed ones too: the browser asks first
    holdUnload(this, this.entries.length > 0);
    this.options.onChange(this.items());
  }
}
