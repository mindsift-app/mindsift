import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Headphones, LoaderCircle, Mic, RotateCcw, Trash } from 'lucide-react';
import type { TranscriptionJob } from '../../lib/types';
import { discardTranscription, retryTranscription, transcriptionError, useInboxTranscriptions } from '../../lib/transcriptionJobs';
import { authorizedAudioURL } from '../../lib/media';
import { askConfirm } from '../../components/askConfirm';
import { showError } from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errorMessage';

// The parts of a stored recording as players (to listen to one whose transcription failed)
const JobAudio: React.FC<{ job: TranscriptionJob }> = ({ job }) => {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const n = Math.max(1, job.pieces ?? 1);
    // Recordings get their length written in (lib/webmDuration.ts), as in a note
    Promise.all(Array.from({ length: n }, (_, i) => authorizedAudioURL(`/api/v1/voice/jobs/${encodeURIComponent(job.id)}/audio/${i}`)))
      .then((loaded) => alive && setUrls(loaded))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [job.id, job.pieces]);
  const { t } = useTranslation('triage');
  if (failed) return <p className="text-xs text-status-err">{t('voiceJobs.audioFailed')}</p>;
  if (!urls) return <LoaderCircle className="w-4 h-4 animate-spin text-muted" />;
  return (
    <div className="space-y-1">
      {urls.map((u) => (
        // preload "auto": the file is in memory already; with "metadata" WebKitGTK's player kept its spinner
        <audio key={u} controls preload="auto" src={u} className="w-full max-w-md h-11" />
      ))}
    </div>
  );
};

const JobRow: React.FC<{ job: TranscriptionJob }> = ({ job }) => {
  const { t } = useTranslation('triage');
  const [listen, setListen] = useState(false);
  const [busy, setBusy] = useState(false);
  const failed = job.status === 'failed';
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      showError(errorMessage(err, t('voiceJobs.actionFailed')));
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    const ok = await askConfirm({ message: t('voiceJobs.discardConfirm'), confirmLabel: t('voiceJobs.discard'), danger: true });
    if (ok) await run(() => discardTranscription(job.id));
  };

  return (
    <li className="px-3 py-2.5 space-y-2" data-transcription={job.status}>
      <div className="flex items-center gap-2 min-w-0">
        {failed ? <Mic className="w-4 h-4 text-status-err shrink-0" /> : <LoaderCircle className="w-4 h-4 animate-spin text-accent shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm sm:text-xs font-medium text-main">{failed ? t('voiceJobs.failed') : t('voiceJobs.pending')}</p>
          {(failed || job.error) && (
            <p className={`text-xs ${failed ? 'text-status-err' : 'text-muted'}`}>
              {failed ? transcriptionError(job) : t('voiceJobs.retrying')}
            </p>
          )}
        </div>
        {failed && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" disabled={busy} onClick={() => void run(() => retryTranscription(job.id))} className="btn-action h-11 sm:h-8 px-3 text-xs">
              <RotateCcw className="w-3.5 h-3.5 text-accent" />
              {t('voiceJobs.retry')}
            </button>
            <button
              type="button"
              onClick={() => setListen((v) => !v)}
              aria-expanded={listen}
              title={t('voiceJobs.listen')}
              aria-label={t('voiceJobs.listen')}
              className="btn-action tool-ghost h-11 w-11 sm:h-8 sm:w-8 justify-center"
            >
              <Headphones className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void discard()}
              title={t('voiceJobs.discard')}
              aria-label={t('voiceJobs.discard')}
              className="btn-action tool-ghost h-11 w-11 sm:h-8 sm:w-8 justify-center"
            >
              <Trash className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {failed && listen && <JobAudio job={job} />}
    </li>
  );
};

/**
 * Recordings dictated into the inbox that the server is still transcribing, or failed to (with the own
 * Whisper server, lib/transcriptionJobs.ts): they show above the inbox until their entry is there, also
 * after a reload and on other devices. A failed one keeps its recording: try again, listen, or discard.
 */
export const VoiceCaptureJobs: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { t } = useTranslation('triage');
  const jobs = useInboxTranscriptions();
  if (jobs.length === 0) return null;
  return (
    <section aria-label={t('voiceJobs.title')} className={`panel-surface overflow-hidden ${className}`}>
      <ul className="divide-y divide-border">
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </ul>
    </section>
  );
};
