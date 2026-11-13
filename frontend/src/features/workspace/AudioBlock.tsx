import React, { useEffect, useRef, useState } from 'react';
import { FileHeadphone, LoaderCircle, WandSparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { mediaBlob, mediaObjectURL, parseMediaContent } from '../../lib/media';
import { loadVoiceConfig } from '../../lib/voice';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errorMessage';

interface AudioBlockProps {
  content: string;
  canEdit: boolean;
  onCaptionChange: (caption: string) => void;
}

// Audio block: player plus caption. With the own Whisper server the recording can be turned into text,
// which becomes the caption (and so searchable).
export const AudioBlock: React.FC<AudioBlockProps> = ({ content, canEdit, onCaptionChange }) => {
  const { t } = useTranslation('workspace');
  const ref = parseMediaContent(content);
  const mediaId = ref?.id;
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [caption, setCaption] = useState(ref?.caption || '');
  const [canTranscribe, setCanTranscribe] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Recordings from Chrome (WebM) carry no length: jump to the end once so the browser measures it,
  // otherwise the player shows no total time and seeking does not work
  const fixDuration = () => {
    const a = audioRef.current;
    if (!a || Number.isFinite(a.duration)) return;
    const reset = () => {
      a.removeEventListener('timeupdate', reset);
      a.currentTime = 0;
    };
    a.addEventListener('timeupdate', reset);
    a.currentTime = 1e101;
  };

  useEffect(() => {
    setCaption(ref?.caption || '');
  }, [ref?.caption]);

  useEffect(() => {
    if (!mediaId) return;
    let alive = true;
    setFailed(false);
    mediaObjectURL(mediaId)
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [mediaId]);

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
    <div className="my-1 space-y-1">
      {failed ? (
        <div className="flex items-center gap-2 h-12 px-4 rounded-full border border-border bg-panel text-xs text-muted">
          <FileHeadphone className="w-4 h-4" /> {t('media.audioUnavailable')}
        </div>
      ) : src ? (
        <div className="flex items-center gap-2">
          <audio ref={audioRef} controls preload="metadata" src={src} onLoadedMetadata={fixDuration} className="w-full max-w-md h-11" />
          {canEdit && canTranscribe && (
            <button
              type="button"
              onClick={() => void transcribe()}
              disabled={transcribing}
              title={t('media.transcribeTitle')}
              className="btn-secondary !rounded-full h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
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

      {canEdit ? (
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => commitCaption(caption)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={t('media.caption')}
          className="w-full bg-transparent border-0 p-0 text-xs text-muted placeholder-faint focus:outline-none focus:ring-0"
        />
      ) : (
        ref.caption && <p className="text-xs text-muted">{ref.caption}</p>
      )}
      {error && <p className="text-xs text-status-err">{error}</p>}
    </div>
  );
};
