import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { isTouchPointer, useAnchoredPopover } from '../lib/useAnchoredPopover';
import { formatTimeField, parseTimeInput, stepTime, timeSlots, uses12h } from '../lib/dateInput';

interface TimeFieldProps {
  // HH:MM (24 h) or ''
  value: string;
  onChange: (time: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  // Size and place of the field in its row
  className?: string;
  // Look of the input; default: the form field (44 px on phones, 32 px from sm)
  inputClassName?: string;
  title?: string;
}

const INPUT_CLASS = 'h-11 sm:h-8 input-field px-2 text-base sm:text-xs bg-panel';
const SLOTS = timeSlots(15);
const LIST_HEIGHT = 240;

// Time field (Doku/ui-patterns.md): with a mouse a field to type the time to the minute ("14:30", "1430",
// "2:30 pm") and a list in steps of 15 minutes below it, at the chosen time or now; arrow up/down moves by
// 15 minutes. With touch the system's own picker. 24 hours or AM/PM as the language writes it.
export function TimeField({ value, onChange, ariaLabel, disabled, className = '', inputClassName = INPUT_CLASS, title }: TimeFieldProps) {
  const { t } = useTranslation();
  const [touch] = useState(isTouchPointer);
  const { open, setOpen, show, pos, anchorRef, popRef } = useAnchoredPopover<HTMLDivElement>(LIST_HEIGHT, 112);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(() => formatTimeField(value));

  useEffect(() => setDraft(formatTimeField(value)), [value]);

  // The list opens at the chosen time, otherwise at the next step from now
  useEffect(() => {
    if (!open) return;
    const target = value ? SLOTS.findIndex((s) => s >= value) : SLOTS.indexOf(stepTime('', 1));
    popRef.current?.querySelector<HTMLElement>(`[data-index="${Math.max(0, target)}"]`)?.scrollIntoView({ block: 'center' });
  }, [open, value, popRef]);

  if (touch) {
    return (
      <input
        type="time"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} ${inputClassName}`}
      />
    );
  }

  const set = (time: string) => {
    setDraft(formatTimeField(time));
    if (time !== value) onChange(time);
  };

  const commit = () => {
    const time = parseTimeInput(draft);
    if (time === null) setDraft(formatTimeField(value));
    else set(time);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(stepTime(parseTimeInput(draft) || value, e.key === 'ArrowUp' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      setOpen(false);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        placeholder={t(uses12h() ? 'timeField.placeholder12' : 'timeField.placeholder')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !open && !disabled && show()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={`${inputClassName} w-full pr-7 disabled:opacity-50`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : show())}
        title={t('timeField.open')}
        aria-label={t('timeField.open')}
        className="absolute inset-y-0 right-1 my-auto w-6 h-6 flex items-center justify-center text-muted hover:text-main disabled:opacity-50"
      >
        <Clock className="w-3.5 h-3.5" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{ left: pos.left, minWidth: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            className="fixed z-[60] min-w-28 overflow-y-auto p-1 bg-panel border border-border rounded-card shadow-panel text-xs animate-in fade-in duration-100"
            onMouseDown={(e) => e.preventDefault()}
          >
            {SLOTS.map((slot, i) => {
              const chosen = slot === value;
              return (
                <div
                  key={slot}
                  data-index={i}
                  role="option"
                  aria-selected={chosen}
                  onClick={() => {
                    set(slot);
                    setOpen(false);
                  }}
                  className={`h-8 px-2 rounded-btn flex items-center tabular-nums cursor-pointer hover:bg-panel-elevated ${
                    chosen ? 'bg-accent/15 text-accent font-semibold' : 'text-main'
                  }`}
                >
                  {formatTimeField(slot)}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
