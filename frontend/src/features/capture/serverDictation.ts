import type { SegmentedTranscription, RecordedPart } from '../../lib/voiceTranscription';
import { retryTranscription, startInboxTranscription, waitForTranscription } from '../../lib/transcriptionJobs';
import { dateFromDictation, undoDictationDate, type DictationOutcome } from './captureDictation';
import type { DictationSource } from './dictationQueue';

/**
 * A dictation of the rail's or the phone's + with the own Whisper server, as an item of the dictation queue
 * (dictationQueue.ts): when it is handed in, its parts go to the server with the text recognised for them
 * while speaking (POST /voice/captures). From then on the recording is safe on the server, which
 * transcribes the rest and makes the inbox entry itself, also when the app is closed meanwhile
 * (lib/transcriptionJobs.ts). While the app is open the item waits for that; a date in the text then
 * becomes the entry's due date, read from when it was spoken, and can be taken back (undo).
 *
 * Until the upload worked the parts stay here, so "Erneut versuchen" sends them again; after it, trying
 * again asks the server to (its job keeps the recording).
 */
export function serverDictation(transcription: SegmentedTranscription, onSaved?: () => void): DictationSource<DictationOutcome | void> {
  const spokenAt = new Date();
  const parts: Promise<RecordedPart[]> = transcription.handOver();
  let jobId: string | null = null;
  let thoughtId: string | null = null;

  const finish = async (): Promise<string> => {
    if (!jobId) {
      const recorded = await parts;
      if (recorded.length === 0) return '';
      // Recognised in full while speaking: the server only stores and saves it
      jobId = (await startInboxTranscription(recorded)).id;
    }
    const done = await waitForTranscription(jobId);
    thoughtId = done?.thoughtId ?? null;
    // Ended without a text this tab saw (nothing heard, or the entry was made while the event got lost)
    return done?.text ?? '';
  };

  return {
    text: finish,
    retry: async () => {
      if (jobId) await retryTranscription(jobId);
      return finish();
    },
    save: async (text) => {
      onSaved?.();
      if (!thoughtId) return;
      const saved = await dateFromDictation(thoughtId, text, spokenAt).catch(() => null);
      if (!saved) return;
      return {
        due: saved.due,
        undo: async () => {
          if (await undoDictationDate(saved)) onSaved?.();
        },
      };
    },
  };
}
