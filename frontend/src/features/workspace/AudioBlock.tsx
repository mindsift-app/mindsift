import React, { useEffect, useRef, useState } from 'react';
import { FileHeadphone, LoaderCircle, WandSparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { mediaBlob, mediaObjectURL, parseMediaContent } from '../../lib/media';
import { loadVoiceConfig } from '../../lib/voice';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errorMessage';
import { IndentArrows, OVERLAY_ARROW_BUTTON } from './IndentArrows';

// The recording that is playing: starting another one pauses it, so two never play over each other
let playingAudio: HTMLAudioElement | null = null;

function onPlay(e: React.SyntheticEvent<HTMLAudioElement>) {
  const a = e.currentTarget;
  if (playingAudio && playingAudio !== a) playingAudio.pause();
  playingAudio = a;
}

interface AudioBlockProps {
  content: string;
  canEdit: boolean;
  onCaptionChange: (caption: string) => void;
  /** Moves the bullet (no text field here to press Tab in) */
  onIndent?: () => void;
  onOutdent?: () => void;
  canIndent?: boolean;
  canOutdent?: boolean;
  /** Someone else holds the bullet: arrows and transcribe greyed out, caption read only (canEdit is false then) */
  locked?: boolean;
}

// Audio block: player plus caption. With the own Whisper server the recording can be turned into text,
// which becomes the caption (and so searchable).
export const AudioBlock: React.FC<AudioBlockProps> = ({
  content,
  canEdit,
  onCaptionChange,
  onIndent,
  onOutdent,
  canIndent = false,
  canOutdent = false,
  locked = false,
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
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

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
    if (!src) return;
    setTranscribing(true);
    setError(null);
    try {
      const blob = await mediaBlob(ref.id);
      const text = await api.transcribe(blob);
      if (text) {
        setCaption(text);
        commitCaption(text);
      } else {
        setError(t('media.nothing'));
      }
    } catch (err) {
      setError(errorMessage(err, t('media.sttFailed')));
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <div className="group/audio my-1 space-y-1">
      {failed ? (
        <div className="flex items-center gap-2 h-12 px-4 rounded-full border border-border bg-panel text-xs text-muted">
          <FileHeadphone className="w-4 h-4" /> {t('media.audioUnavailable')}
        </div>
      ) : src ? (
        <div className="flex items-center gap-2">
          {editable && (onIndent || onOutdent) && (
            // Left of the player, like the code block's; on devices that can hover only while the pointer is
            // over the block (phones always show them)
            <div
              className={`flex items-center shrink-0 transition-opacity ${
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
          <audio ref={audioRef} controls preload="metadata" src={src} onPlay={onPlay} className="w-full max-w-md h-11" />
          {editable && canTranscribe && (
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
        </div>
      ) : (
        <div className="flex items-center h-12 px-4 rounded-full border border-border bg-panel w-64">
          <LoaderCircle className="w-4 h-4 animate-spin text-muted" />
        </div>
      )}

      {editable ? (
        <input
          type="text"
          value={caption}
          readOnly={locked}
          aria-label={t('media.caption')}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => {
            if (!locked) commitCaption(caption);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={locked ? '' : t('media.caption')}
          // An empty caption only shows while the pointer is over the block (phones always show it); its line
          // stays, so nothing below moves
          className={`w-full bg-transparent border-0 p-0 text-xs text-muted placeholder:text-faint focus:outline-hidden focus:ring-0 transition-opacity ${
            caption ? '' : '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/audio:opacity-100 focus:opacity-100'
          }`}
        />
      ) : (
        ref.caption && <p className="text-xs text-muted">{ref.caption}</p>
      )}
      {error && <p className="text-xs text-status-err">{error}</p>}
    </div>
  );
};
