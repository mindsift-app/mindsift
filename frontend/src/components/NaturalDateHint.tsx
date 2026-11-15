import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, X } from 'lucide-react';
import { DateSpan, NaturalDate, parseNaturalDate, phraseOf } from '../lib/naturalDate';
import { formatDue } from '../lib/due';

// Due dates typed into a one-line capture (lib/naturalDate.ts): the field marks the phrase, a chip shows the
// date with an × to ignore it. Only what the chip shows is applied on saving, so the text never changes
// without the person having seen it.

/**
 * The date recognised in text, unless off (a date picked by hand wins, a target without due dates) or
 * dismissed with the ×. Dismissing holds for that phrase; another phrase shows a chip again.
 */
export function useNaturalDate(text: string, enabled: boolean) {
  const { i18n } = useTranslation();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const parsed = useMemo(
    () => (enabled ? parseNaturalDate(text, i18n.language, new Date()) : null),
    [text, enabled, i18n.language]
  );
  const active = parsed && phraseOf(text, parsed) !== dismissed ? parsed : null;
  return {
    parsed: active,
    dismiss: () => {
      if (parsed) setDismissed(phraseOf(text, parsed));
    },
    // After saving: the next entry starts without a dismissed phrase
    reset: () => setDismissed(null),
  };
}

/** Title and due date to save: a date picked by hand wins over the recognised one. */
export function applyNaturalDate(text: string, parsed: NaturalDate | null, pickedDue: string): { title: string; due: string } {
  if (pickedDue || !parsed) return { title: text, due: pickedDue };
  return { title: parsed.title, due: parsed.due };
}

const COPIED_STYLES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'textIndent',
  'tabSize',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const;

interface PhraseHighlightProps {
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  text: string;
  spans: DateSpan[];
}

/**
 * Marks parts of the text of an input or textarea: a copy of the text with the field's metrics lies over the
 * field, its letters invisible, only the marks tinted. Render it as a sibling of the field (same positioned
 * parent); it follows the field's size and scrolling and lets every click through.
 */
export function PhraseHighlight({ inputRef, text, spans }: PhraseHighlightProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!input || !box || !inner) return;
    const isArea = input.tagName === 'TEXTAREA';
    const sync = () => {
      const cs = getComputedStyle(input);
      for (const k of COPIED_STYLES) box.style[k] = cs[k];
      box.style.left = `${input.offsetLeft}px`;
      box.style.top = `${input.offsetTop}px`;
      box.style.width = `${input.offsetWidth}px`;
      box.style.height = `${input.offsetHeight}px`;
      inner.style.whiteSpace = isArea ? 'pre-wrap' : 'pre';
      inner.style.overflowWrap = isArea ? 'break-word' : 'normal';
      // A one-line input centres its text vertically
      inner.style.lineHeight = isArea
        ? cs.lineHeight
        : `${input.clientHeight - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0')}px`;
      inner.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    };
    sync();
    const events = ['scroll', 'keyup', 'click', 'select'] as const;
    for (const e of events) input.addEventListener(e, sync);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(input);
    return () => {
      for (const e of events) input.removeEventListener(e, sync);
      ro?.disconnect();
    };
  });

  const parts: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    if (s.start > at) parts.push(text.slice(at, s.start));
    parts.push(
      <mark key={i} data-testid="natural-date-mark" className="bg-accent/20 text-transparent rounded-sm">
        {text.slice(s.start, s.end)}
      </mark>
    );
    at = s.end;
  });
  parts.push(`${text.slice(at)}\u200b`);

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className="absolute pointer-events-none overflow-hidden border-solid border-transparent box-border"
    >
      <div ref={innerRef} className="text-transparent">
        {parts}
      </div>
    </div>
  );
}

interface NaturalDateChipProps {
  due: string;
  onDismiss: () => void;
  className?: string;
}

/** "Morgen, 14:00 ×": the recognised due date; × keeps the text as typed and sets no date. */
export function NaturalDateChip({ due, onDismiss, className = '' }: NaturalDateChipProps) {
  const { t } = useTranslation();
  const label = formatDue(due);
  return (
    <span
      data-testid="natural-date-chip"
      title={t('naturalDate.recognized', { date: label })}
      className={`inline-flex items-center gap-1 h-6 pl-2 pr-0.5 rounded-full bg-accent-dim text-accent border border-accent-border text-[11px] font-medium whitespace-nowrap shrink-0 animate-in fade-in duration-150 ${className}`}
    >
      <CalendarClock className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span aria-label={t('naturalDate.recognized', { date: label })}>{label}</span>
      {/* The hit area grows to 44 px on phones without making the chip bigger */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDismiss}
        aria-label={t('naturalDate.ignore')}
        title={t('naturalDate.ignore')}
        className="relative w-5 h-5 rounded-full flex items-center justify-center hover:bg-accent/15 cursor-pointer after:absolute after:-inset-3 sm:after:inset-0"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
