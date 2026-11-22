import type { SegmentedTranscription, RecordedPart } from '../../lib/voiceTranscription';
import { startInboxTranscription, waitForTranscription } from '../../lib/transcriptionJobs';
import { dateFromDictation, undoDictationDate, type DictationOutcome } from './captureDictation';
import { HandedOverError, type DictationSource } from './dictationQueue';
import i18n from '../../i18n';
import { errorMessage } from '../../lib/errorMessage';

/**
 * A dictation of the rail's or the phone's + with the own Whisper server, as an item of the dictation queue
 * (dictationQueue.ts): when it is handed in, its parts go to the server with the text recognised for them
 * while speaking (POST /voice/captures). From then on the recording is safe on the server, which
 * transcribes the rest and makes the inbox entry itself, also when the app is closed meanwhile
 * (lib/transcriptionJobs.ts). While the app is open the item waits for that; a date in the text then
 * becomes the entry's due date, read from when it was spoken, and can be taken back (undo).
 *
 * Until the upload worked the parts stay here, so "Erneut versuchen" sends them again. Once the server has
 * them, a failed transcription leaves the queue (HandedOverError): the recording waits above the Quick
 * Dump, which offers to try again, listen or discard, on every device.
 */
export function serverDictation(transcription: SegmentedTranscription): DictationSource<DictationOutcome | void> {
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
    let done;
    try {
      done = await waitForTranscription(jobId);
    } catch (err) {
      throw new HandedOverError(i18n.t('triage:voiceJobs.keptInInbox', { reason: errorMessage(err, i18n.t('common:voiceJobs.failed')) }));
    }
    thoughtId = done?.thoughtId ?? null;
    // Ended without a text this tab saw (nothing heard, or the entry was made while the event got lost)
    return done?.text ?? '';
  };

  return {
    text: finish,
    save: async (text) => {
      if (!thoughtId) return;
      const saved = await dateFromDictation(thoughtId, text, spokenAt).catch(() => null);
      if (!saved) return;
      return {
        due: saved.due,
        undo: async () => {
          await undoDictationDate(saved);
        },
      };
    },
  };
}
