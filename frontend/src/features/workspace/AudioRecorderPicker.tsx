import React, { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, Upload, X } from 'lucide-react';
import { audioLimitMB, audioRecordingBitrate, audioUploadsAllowed, UploadedMedia, uploadMedia } from '../../lib/media';
import { canRecord, VoiceRecorder } from '../../lib/voice';
import { repairWebmBlob } from '../../lib/webmDuration';
import { VoiceWave } from '../../components/VoiceWave';
import { triggerHaptic } from '../../lib/api';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errorMessage';
import { useRecordingGuard } from '../../lib/leaveGuard';

interface AudioRecorderPickerProps {
  docId: string;
  onDone: (media: UploadedMedia) => void;
  onCancel: () => void;
}

const MAX_RECORDING_MS = 30 * 60 * 1000;

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Inline bubble an empty bullet turns into after /audio. Green button = start, red button = stop and
// save; the live wave runs left of the red button. An existing audio file can be uploaded instead.
export const AudioRecorderPicker: React.FC<AudioRecorderPickerProps> = ({ docId, onDone, onCancel }) => {
  const { t } = useTranslation('workspace');
  const [state, setState] = useState<'ready' | 'recording' | 'uploading'>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const startedRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // A recording not saved yet: switching the note asks first, reloading the page lets the browser ask, and
  // the app does not reload by itself for a new version
  useRecordingGuard(state !== 'ready');

  const stopTicking = () => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
  };

  useEffect(() => {
    boxRef.current?.focus();
    return () => {
      stopTicking();
      recorderRef.current?.cancel();
    };
  }, []);

  const upload = async (blob: Blob, name: string, source?: 'recording') => {
    setState('uploading');
    setError(null);
    try {
      onDone(await uploadMedia(docId, blob, name, source));
    } catch (err) {
      setError(errorMessage(err, t('media.uploadFailed')));
      setState('ready');
    }
  };

  const stop = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    stopTicking();
    triggerHaptic(20);
    // "Saving" right away: the browser may take a moment to hand over the end of the recording
    setState('uploading');
    const recorded = await rec.stop();
    // The file gets its length written in, which MediaRecorder leaves out (lib/webmDuration.ts)
    const blob = recorded && (await repairWebmBlob(recorded));
    if (!blob) {
      setError(t('media.emptyRecording'));
      setState('ready');
      return;
    }
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    await upload(blob, `sprachnotiz.${ext}`, 'recording');
  };

  const start = async () => {
    setError(null);
    // No MediaRecorder or getUserMedia: the browser cannot record at all, which is no missing permission.
    // Outside HTTPS browsers hide getUserMedia too; the microphone message names that case
    if (!canRecord()) {
      setError(t(window.isSecureContext === false ? 'media.noMic' : 'media.recordUnsupported'));
      return;
    }
    const rec = new VoiceRecorder(audioRecordingBitrate());
    try {
      await rec.start();
    } catch {
      setError(t('media.noMic'));
      return;
    }
    recorderRef.current = rec;
    startedRef.current = Date.now();
    setElapsed(0);
    setState('recording');
    triggerHaptic([15, 60, 25]);
    tickRef.current = window.setInterval(() => {
      const ms = Date.now() - startedRef.current;
      setElapsed(ms);
      // Stops in time before the server's limit for audio files (a little room for the last second)
      const full = (recorderRef.current?.recordedBytes() ?? 0) >= audioLimitMB() * 1024 * 1024 * 0.97;
      if (ms >= MAX_RECORDING_MS || full) void stop();
    }, 250);
  };

  const cancel = () => {
    stopTicking();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    onCancel();
  };

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      className="my-1 inline-flex max-w-full flex-col gap-2 rounded-3xl border border-border bg-panel-elevated px-4 py-2 focus:outline-hidden"
    >
      <div className="flex items-center gap-3">
        {state === 'recording' && (
          <>
            <span className="text-xs font-mono text-main tabular-nums">{formatTime(elapsed)}</span>
            <VoiceWave getLevel={() => recorderRef.current?.level() ?? null} bars={11} className="h-6 text-status-err" />
          </>
        )}
        {state === 'ready' && <span className="text-xs text-muted">{t('media.record')}</span>}
        {state === 'uploading' && (
          <span className="text-xs text-muted flex items-center gap-1.5">
            <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> {t('workspace:media.saving')}
          </span>
        )}

        {state === 'recording' ? (
          <button
            type="button"
            onClick={() => void stop()}
            title={t('media.stopSave')}
            aria-label={t('media.stopSave')}
            className="w-14 h-14 sm:w-10 sm:h-10 rounded-full bg-status-err text-on-accent flex items-center justify-center shadow-panel shrink-0"
          >
            <Square className="w-5 h-5 sm:w-4 sm:h-4 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={state === 'uploading'}
            title={t('media.start')}
            aria-label={t('media.start')}
            className="w-14 h-14 sm:w-10 sm:h-10 rounded-full bg-status-ok text-on-accent flex items-center justify-center shadow-panel shrink-0 disabled:opacity-40"
          >
            <Mic className="w-6 h-6 sm:w-5 sm:h-5" />
          </button>
        )}

        {state === 'ready' && audioUploadsAllowed() && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title={t('media.uploadAudio')}
            className="btn-secondary h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 shrink-0"
          >
            <Upload className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t('media.file')}</span>
          </button>
        )}
        <button
          type="button"
          onClick={cancel}
          disabled={state === 'uploading'}
          title={t('media.cancelEsc')}
          className="w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-full text-muted hover:text-main hover:bg-panel shrink-0 disabled:opacity-40"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {error && <p className="text-xs text-status-err">{error}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          // Checked here as well, so a large file is not sent only to be refused
          const maxMB = audioLimitMB();
          if (f.size > maxMB * 1024 * 1024) {
            setError(t('media.audioTooLarge', { mb: maxMB }));
            return;
          }
          void upload(f, f.name || 'audio');
        }}
      />
    </div>
  );
};
