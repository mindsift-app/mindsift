import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, LoaderCircle, X } from 'lucide-react';
import { mediaObjectURL, parseMediaContent } from '../../lib/media';
import { useTranslation } from 'react-i18next';

interface ImageBlockProps {
  content: string;
  canEdit: boolean;
  onCaptionChange: (caption: string) => void;
}

// Image block: the picture (click = full screen) and an optional caption below it.
export const ImageBlock: React.FC<ImageBlockProps> = ({ content, canEdit, onCaptionChange }) => {
  const { t } = useTranslation('workspace');
  const ref = parseMediaContent(content);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [caption, setCaption] = useState(ref?.caption || '');

  useEffect(() => {
    // The caption field follows the stored caption (also from other devices)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaption(ref?.caption || '');
  }, [ref?.caption]);

  const mediaId = ref?.id;
  useEffect(() => {
    if (!mediaId) return;
    let alive = true;
    // Another image starts without the error of the previous one
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false);
    mediaObjectURL(mediaId)
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [mediaId]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoomed(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  if (!ref) {
    return <div className="text-xs text-status-err py-1">{t('media.imageBroken', { content })}</div>;
  }

  const commitCaption = () => {
    if (caption.trim() !== ref.caption) onCaptionChange(caption.trim());
  };

  return (
    <figure className="my-1 space-y-1">
      {failed ? (
        <div className="flex items-center gap-2 h-24 px-3 rounded-card border border-border bg-panel text-xs text-muted">
          <ImageOff className="w-4 h-4" /> {t('media.imageUnavailable')}
        </div>
      ) : src ? (
        <button
          type="button"
          onClick={() => setZoomed(true)}
          title={t('media.enlarge')}
          className="block max-w-full rounded-card overflow-hidden border border-border bg-panel cursor-zoom-in"
        >
          <img src={src} alt={ref.caption} className="block max-w-full max-h-[28rem] object-contain" />
        </button>
      ) : (
        <div className="flex items-center justify-center w-48 h-32 rounded-card border border-border bg-panel">
          <LoaderCircle className="w-4 h-4 animate-spin text-muted" />
        </div>
      )}

      {canEdit ? (
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={commitCaption}
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
        ref.caption && <figcaption className="text-xs text-muted">{ref.caption}</figcaption>
      )}

      {zoomed &&
        src &&
        createPortal(
          <div
            role="dialog"
            aria-label={ref.caption || 'Bild'}
            onClick={() => setZoomed(false)}
            className="fixed inset-0 z-[100] bg-black/85 flex flex-col items-center justify-center p-4 cursor-zoom-out"
          >
            <button
              type="button"
              onClick={() => setZoomed(false)}
              title={t('media.closeEsc')}
              className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-3 w-11 h-11 flex items-center justify-center rounded-full bg-black/50 text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <img src={src} alt={ref.caption} className="max-w-full max-h-[85vh] object-contain" />
            {ref.caption && <p className="mt-3 text-sm text-white/90 text-center max-w-2xl">{ref.caption}</p>}
          </div>,
          document.body
        )}
    </figure>
  );
};
