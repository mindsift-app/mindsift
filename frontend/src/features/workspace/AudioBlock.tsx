import React, { useEffect, useRef, useState } from 'react';
import { FileHeadphone, LoaderCircle, WandSparkles, X } from 'lucide-react';
import { mediaObjectURL, parseMediaContent } from '../../lib/media';
import { loadVoiceConfig } from '../../lib/voice';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errorMessage';
import { discardTranscription, startBlockTranscription, transcriptionError, useBlockTranscription, waitForTranscription } from '../../lib/transcriptionJobs';
import { IndentArrows, OVERLAY_ARROW_BUTTON } from './IndentArrows';
import { MediaCaption } from './MediaCaption';

// The recording that is playing: starting another one pauses it, so two never play over each other
let playingAudio: HTMLAudioElement | null = null;

function onPlay(e: React.SyntheticEvent<HTMLAudioElement>) {
  const a = e.currentTarget;
  if (playingAudio && playingAudio !== a) playingAudio.pause();
  playingAudio = a;
}

interface AudioBlockProps {
  content: string;
  /** The note and bullet: a transcription runs on the server and writes the caption itself */
  docId?: string;
  blockId?: string;
  canEdit: boolean;
  onCaptionChange: (caption: string) => void;
  /** Moves the bullet (no text field here to press Tab in) */
  onIndent?: () => void;
  onOutdent?: () => void;
  canIndent?: boolean;
  canOutdent?: boolean;
  /** Someone else holds the bullet: arrows and transcribe greyed out, caption read only (canEdit is false then) */
  locked?: boolean;
  /** Enter in the caption: leave it for a new bullet below, like Enter at the end of a text bullet */
  onExitBelow?: () => void;
  /** Focus entered or left the block (caption, player, buttons): it counts as the bullet being edited, so
   * the bar above the phone keyboard (MobileOutlineBar) indents and moves this bullet */
  onFocusChange?: (focused: boolean) => void;
}

// Audio block: player plus caption. With the own Whisper server the recording can be turned into text,
// which becomes the caption (and so searchable). The server does that as a job (lib/transcriptionJobs.ts):
// leaving the note does not stop it, the caption arrives through the note's sync, and the bullet shows
// "Wird erkannt…" wherever the note is open, also after a reload.
export const AudioBlock: React.FC<AudioBlockProps> = ({
  content,
  docId,
  blockId,
  canEdit,
  onCaptionChange,
  onIndent,
  onOutdent,
  canIndent = false,
  canOutdent = false,
  locked = false,
  onExitBelow,
  onFocusChange,
}) => {
  const { t } = useTranslation('workspace');
  const ref = parseMediaContent(content);
  const mediaId = ref?.id;
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Editable, or held by someone else: the controls stay in place (greyed out) so the layout does not jump
  const editable = canEdit || locked;
  const [caption, setCaption] = useState(ref?.caption || '');
  const [canTranscribe, setCanTranscribe] = useState(false);
  // Asking the server to start (the job itself is `job` once it is there)
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const mountedRef = useRef(true);
  // A failed job was let go: its end is no "nothing recognised"
  const discardedRef = useRef(false);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );
  // Only where the bullet can be edited: readers (and public pages, without a login) do not ask for jobs
  const job = useBlockTranscription(docId, blockId, editable && !!mediaId);
  const transcribing = starting || job?.status === 'queued' || job?.status === 'running';
  const jobFailed = job?.status === 'failed';

  useEffect(() => {
    // The caption field follows the stored caption (also from other devices)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaption(ref?.caption || '');
  }, [ref?.caption]);

  useEffect(() => {
    if (!mediaId) return;
    let alive = true;
    // Another recording starts without the error of the previous one
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false);
    // WebM recordings get their length (and an index) written into the file first, see lib/webmDuration.ts
    mediaObjectURL(mediaId, 'audio')
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [mediaId]);

  useEffect(() => {
    if (!src) return;
    const a = audioRef.current;
    return () => {
      // Leaving the note (or another file): stop and let go of the file. WebKitGTK (desktop app) otherwise
      // went on playing the removed player, and a second one started alongside it
      if (!a) return;
      a.pause();
      if (playingAudio === a) playingAudio = null;
      if (a.getAttribute('src') === src) {
        a.removeAttribute('src');
        a.load();
      }
    };
  }, [src]);

  useEffect(() => {
    void loadVoiceConfig().then((cfg) => setCanTranscribe(cfg.mode === 'server'));
  }, []);

  if (!ref) {
    return <div className="text-xs text-status-err py-1">{t('media.audioBroken', { content })}</div>;
  }

  const commitCaption = (value: string) => {
    if (value.trim() !== ref.caption) onCaptionChange(value.trim());
  };

  const transcribe = async () => {
    if (!src || !docId || !blockId) return;
    // A caption typed and not stored yet goes first, so the server sees it (and keeps it)
    commitCaption(caption);
    setStarting(true);
    setError(null);
    discardedRef.current = false;
    let started;
    try {
      started = await startBlockTranscription(docId, blockId);
    } catch (err) {
      setError(errorMessage(err, t('media.sttFailed')));
      return;
    } finally {
      setStarting(false);
    }
    // The text comes with the note's sync; here only "nothing recognised" is worth a word
    waitForTranscription(started.id)
      .then((done) => {
        if (mountedRef.current && !done && !discardedRef.current) setError(t('media.nothing'));
      })
      .catch(() => {
        // a failed job shows its error through `job`
      });
  };

  return (
    <div
      className="group/audio my-1 space-y-1"
      onFocus={() => onFocusChange?.(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusChange?.(false);
      }}
    >
      {failed ? (
        <div className="flex items-center gap-2 h-12 px-4 rounded-full border border-border bg-panel text-xs text-muted">
          <FileHeadphone className="w-4 h-4" /> {t('media.audioUnavailable')}
        </div>
      ) : src ? (
        <div className="flex items-center gap-2">
          <audio ref={audioRef} controls preload="metadata" src={src} onPlay={onPlay} className="w-full max-w-md h-11" />
          {editable && (canTranscribe || transcribing) && (
            <button
              type="button"
              onClick={() => void transcribe()}
              disabled={transcribing || locked}
              title={t('media.transcribeTitle')}
              className="btn-secondary rounded-full! h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
            >
              {transcribing ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <WandSparkles className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{transcribing ? t('media.transcribing') : t('media.transcribe')}</span>
            </button>
          )}
          {editable && (onIndent || onOutdent) && (
            // Right of the player and the transcribe button, so nothing stands between the bullet and the
            // player; on devices that can hover only while the pointer is over the block. Phones have none
            // (they would squeeze the player's time bar): there the bar above the keyboard indents, like
            // for the code block
            <div
              className={`hidden sm:flex items-center gap-0.5 shrink-0 transition-opacity ${
                locked ? '' : '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/audio:opacity-100 focus-within:opacity-100'
              }`}
            >
              <IndentArrows
                onIndent={onIndent}
                onOutdent={onOutdent}
                canIndent={canIndent}
                canOutdent={canOutdent}
                locked={locked}
                buttonClassName={OVERLAY_ARROW_BUTTON}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center h-12 px-4 rounded-full border border-border bg-panel w-64">
          <LoaderCircle className="w-4 h-4 animate-spin text-muted" />
        </div>
      )}

      {editable ? (
        <MediaCaption
          value={caption}
          onChange={locked ? undefined : setCaption}
          onCommit={() => commitCaption(caption)}
          onExitBelow={onExitBelow}
          keepLine={locked}
          // An empty caption only shows while the pointer is over the block (phones always show it)
          emptyClassName="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/audio:opacity-100 focus:opacity-100"
        />
      ) : (
        <MediaCaption value={ref.caption} />
      )}
      {error && !transcribing && !jobFailed && <p className="text-xs text-status-err">{error}</p>}
      {jobFailed && job && (
        // Failed on the server (after its own retries): "Transkribieren" tries again, × lets it be
        <p className="flex items-center gap-1 text-xs text-status-err">
          {transcriptionError(job)}
          {!locked && (
            <button
              type="button"
              onClick={() => {
                discardedRef.current = true;
                void discardTranscription(job.id).catch(() => {});
              }}
              title={t('media.transcribeDismiss')}
              aria-label={t('media.transcribeDismiss')}
              className="h-11 w-11 sm:h-5 sm:w-5 -my-3 sm:my-0 flex items-center justify-center rounded-btn text-faint hover:text-main"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </p>
      )}
    </div>
  );
};
