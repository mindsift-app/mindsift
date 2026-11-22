import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface MediaCaptionProps {
  /** The caption as typed (the media block keeps it, a transcript can replace it) */
  value: string;
  /** Typing; without it the caption is read only (no rights, or someone else holds the bullet) */
  onChange?: (value: string) => void;
  /** The field is left: store what was typed */
  onCommit?: () => void;
  /** Enter: on in a new bullet below, like Enter at the end of a text bullet */
  onExitBelow?: () => void;
  /** Classes of the empty field (shown only over the block); its line stays, so nothing below moves */
  emptyClassName?: string;
  /** Read only and empty: keep the empty line anyway (held by someone else, so nothing moves) */
  keepLine?: boolean;
}

const TEXT = 'text-xs leading-4 text-muted wrap-break-word';

/**
 * Caption below an image or a recording. Captions are one line of text that wraps: while it is edited the
 * whole text shows; otherwise a long one is cut to two lines with "…", and "mehr" (or a click into it,
 * which starts editing where that is allowed) shows all of it. Enter goes on in a new bullet below,
 * Shift+Enter only leaves the caption.
 */
export const MediaCaption: React.FC<MediaCaptionProps> = ({ value, onChange, onCommit, onExitBelow, emptyClassName = '', keepLine = false }) => {
  const { t } = useTranslation('workspace');
  const editable = !!onChange;
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const showField = editable && (editing || !value);

  // The field grows with the text, so a long caption wraps instead of running out of it
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, showField]);

  // Clicked or tabbed into the shown text: edit it, with the cursor at the end
  useEffect(() => {
    if (!editing || !value) return;
    const el = fieldRef.current;
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when editing starts
  }, [editing]);

  // Whether the text is cut off at two lines (then "mehr" shows); measured again when the width changes
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, expanded, showField]);

  if (showField) {
    return (
      <textarea
        ref={fieldRef}
        rows={1}
        value={value}
        aria-label={t('media.caption')}
        placeholder={t('media.caption')}
        // One line of text: line breaks (pasted ones too) become spaces
        onChange={(e) => onChange?.(e.target.value.replace(/[\r\n]+/g, ' '))}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          onCommit?.();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (!e.shiftKey && onExitBelow) {
            onCommit?.();
            onExitBelow();
            return;
          }
          e.currentTarget.blur();
        }}
        className={`block w-full resize-none overflow-hidden bg-transparent border-0 p-0 ${TEXT} placeholder:text-faint focus:outline-hidden focus:ring-0 transition-opacity ${
          value ? '' : emptyClassName
        }`}
      />
    );
  }

  if (!value) return keepLine ? <div className="h-4" aria-hidden /> : null;

  return (
    <div>
      <div
        ref={textRef}
        // Editable: a click or Tab starts editing (the whole text shows then); read only: a click shows it all
        role={editable ? 'textbox' : undefined}
        aria-label={editable ? t('media.caption') : undefined}
        aria-readonly={editable ? undefined : true}
        tabIndex={editable ? 0 : undefined}
        onFocus={editable ? () => setEditing(true) : undefined}
        onClick={editable ? undefined : () => clamped && setExpanded(true)}
        className={`${TEXT} whitespace-pre-wrap ${editable ? 'cursor-text focus:outline-hidden' : ''} ${expanded ? '' : 'line-clamp-2'}`}
      >
        {value}
      </div>
      {(clamped || expanded) && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
          aria-expanded={expanded}
          // 44 px to tap on phones, without pushing the bullets below that far down
          className="min-h-11 -my-3 sm:min-h-0 sm:my-0 text-xs leading-4 text-faint hover:text-main cursor-pointer"
        >
          {expanded ? t('media.captionLess') : t('media.captionMore')}
        </button>
      )}
    </div>
  );
};
