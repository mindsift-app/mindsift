import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, LoaderCircle, MoveDiagonal2, RotateCcw, X } from 'lucide-react';
import { MIN_IMAGE_WIDTH, mediaObjectURL, parseMediaContent } from '../../lib/media';
import { useTranslation } from 'react-i18next';
import { IndentArrows, OVERLAY_ARROW_BUTTON, overlayArrowsClass } from './IndentArrows';

interface ImageBlockProps {
  content: string;
  canEdit: boolean;
  onCaptionChange: (caption: string) => void;
  /** New displayed width in px after dragging the corner; null = back to the default size */
  onWidthChange?: (width: number | null) => void;
  /** Moves the bullet (no text field here to press Tab in) */
  onIndent?: () => void;
  onOutdent?: () => void;
  canIndent?: boolean;
  canOutdent?: boolean;
  /** Someone else holds the bullet: arrows greyed out, caption read only, nothing moves (canEdit is false then) */
  locked?: boolean;
}

// Without a pointer that can hover, the first tap on the picture shows the arrows and the empty caption field,
// the next one opens it full screen
const canHover = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;

// Image block: the picture (click = full screen) and an optional caption below it.
export const ImageBlock: React.FC<ImageBlockProps> = ({
  content,
  canEdit,
  onCaptionChange,
  onWidthChange,
  onIndent,
  onOutdent,
  canIndent = false,
  canOutdent = false,
  locked = false,
}) => {
  const { t } = useTranslation('workspace');
  const figureRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Tapped on a touch screen: controls shown until a tap elsewhere
  const [active, setActive] = useState(false);
  const ref = parseMediaContent(content);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [caption, setCaption] = useState(ref?.caption || '');
  // Width while the corner is dragged (saved on release)
  const [dragWidth, setDragWidth] = useState<number | null>(null);

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

  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (!figureRef.current?.contains(e.target as Node)) setActive(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [active]);

  if (!ref) {
    return <div className="text-xs text-status-err py-1">{t('media.imageBroken', { content })}</div>;
  }

  const commitCaption = () => {
    if (caption.trim() !== ref.caption) onCaptionChange(caption.trim());
  };

  const editable = canEdit || locked;
  const sized = !!ref.width;
  const width = dragWidth ?? (ref.width ? Math.max(MIN_IMAGE_WIDTH, ref.width) : null);
  const resizable = canEdit && !!onWidthChange && !!src && !failed;

  // Dragging the bottom right corner changes the width; the height follows, so the picture keeps its
  // aspect ratio. Larger than the file is fine, up to the width of the note column.
  const onResizeDown = (e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!box || !figureRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = box.getBoundingClientRect().width;
    const maxW = Math.max(MIN_IMAGE_WIDTH, figureRef.current.clientWidth || startW);
    const target = e.currentTarget as Element;
    target.setPointerCapture?.(e.pointerId);
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.min(maxW, Math.max(MIN_IMAGE_WIDTH, startW + ev.clientX - startX));
      setDragWidth(w);
    };
    const up = () => {
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDragWidth(null);
      if (Math.abs(w - startW) > 1) onWidthChange?.(Math.round(w));
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const openImage = () => {
    if (editable && !active && !canHover()) {
      setActive(true);
      return;
    }
    setZoomed(true);
  };
  // An empty caption field shows only over the image or with the bullet active; it keeps its line, so the
  // bullets below do not move when it appears
  const hideEmptyCaption = !caption && !active;

  return (
    <figure ref={figureRef} className="group/image my-1 space-y-1">
      <div
        ref={boxRef}
        className="relative w-fit max-w-full"
        style={width && src && !failed ? { width } : undefined}
        // A tap on a missing or loading image shows the controls as well
        onClick={() => {
          if (editable && !canHover()) setActive(true);
        }}
      >
      {failed ? (
        <div className="flex items-center gap-2 h-24 px-3 rounded-card border border-border bg-panel text-xs text-muted">
          <ImageOff className="w-4 h-4" /> {t('media.imageUnavailable')}
        </div>
      ) : src ? (
        <button
          type="button"
          onClick={openImage}
          title={t('media.enlarge')}
          className={`block ${width ? 'w-full' : 'max-w-full'} rounded-card overflow-hidden border border-border bg-panel cursor-zoom-in`}
        >
          <img
            src={src}
            alt={ref.caption}
            draggable={false}
            className={width ? 'block w-full h-auto' : 'block max-w-full max-h-112 object-contain'}
          />
        </button>
      ) : (
        <div className="flex items-center justify-center w-48 h-32 rounded-card border border-border bg-panel">
          <LoaderCircle className="w-4 h-4 animate-spin text-muted" />
        </div>
      )}
      {editable && (onIndent || onOutdent) && (
        <div className={overlayArrowsClass(active, 'image')}>
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
      {editable && sized && src && !failed && (
        <div className={overlayArrowsClass(active, 'image', false, 'top-right')}>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (!locked) onWidthChange?.(null);
            }}
            disabled={locked || !onWidthChange}
            title={t('media.resetSize')}
            aria-label={t('media.resetSize')}
            className={`${OVERLAY_ARROW_BUTTON} cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:text-faint disabled:hover:border-transparent`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {resizable && (
        <div className={overlayArrowsClass(active || dragWidth !== null, 'image', false, 'bottom-right')}>
          <div
            role="presentation"
            title={t('media.resize')}
            style={{ touchAction: 'none' }}
            onPointerDown={onResizeDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`${OVERLAY_ARROW_BUTTON} cursor-nwse-resize`}
          >
            <MoveDiagonal2 className="w-3.5 h-3.5" />
          </div>
        </div>
      )}
      </div>

      {editable ? (
        <input
          type="text"
          value={caption}
          readOnly={locked}
          aria-label={t('media.caption')}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => {
            if (!locked) commitCaption();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={locked ? '' : t('media.caption')}
          className={`w-full bg-transparent border-0 p-0 text-xs text-muted placeholder-faint focus:outline-hidden focus:ring-0 transition-opacity ${
            hideEmptyCaption
              ? 'opacity-0 focus:opacity-100 [@media(hover:hover)]:group-hover/image:opacity-100'
              : ''
          }`}
        />
      ) : (
        ref.caption && <figcaption className="text-xs text-muted">{ref.caption}</figcaption>
      )}

      {zoomed &&
        src &&
        createPortal(
          <div
            role="dialog"
            aria-label={ref.caption || t('editor.kind.image')}
            onClick={() => setZoomed(false)}
            className="fixed inset-0 z-100 bg-black/85 flex flex-col items-center justify-center p-4 cursor-zoom-out"
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
