import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { isTouchPointer, useAnchoredPopover } from '../lib/useAnchoredPopover';
import { formatDayField, parseDayInput } from '../lib/dateInput';
import { firstWeekday, monthGrid, shiftDay, weekOf } from '../lib/calendar';
import { localDay } from '../lib/due';
import { currentLocale } from '../i18n';

interface DateFieldProps {
  // YYYY-MM-DD or ''
  value: string;
  onChange: (day: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  // Size and place of the field in its row (e.g. "flex-1 min-w-0")
  className?: string;
  // Look of the input; default: the form field (44 px on phones, 32 px from sm)
  inputClassName?: string;
  // × in the field that empties it (off where the form has its own button for that)
  clearable?: boolean;
  title?: string;
}

const INPUT_CLASS = 'h-11 sm:h-8 input-field px-2 text-base sm:text-xs bg-panel';
const POPOVER_WIDTH = 264;
const POPOVER_HEIGHT = 300;

// The same day n months later; 31 March + 1 is the last day of April
const addMonths = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(y, m + n, 0).getDate();
  return localDay(new Date(y, m - 1 + n, Math.min(d, last)));
};

// Date field (Doku/ui-patterns.md): with a mouse a field to type the date in the language's order
// ("24.11.2026", "24.11.", "24112026") and a calendar below it; with touch the system's own picker, which
// works best with fingers. The calendar opens at the chosen day, otherwise today; arrows move the day,
// Page Up/Down the month, Enter picks, Escape closes only the calendar.
export function DateField({ value, onChange, ariaLabel, disabled, className = '', inputClassName = INPUT_CLASS, clearable = true, title }: DateFieldProps) {
  const { t } = useTranslation();
  const [touch] = useState(isTouchPointer);
  const { open, setOpen, show, pos, anchorRef, popRef } = useAnchoredPopover<HTMLDivElement>(POPOVER_HEIGHT, POPOVER_WIDTH);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(() => formatDayField(value));
  const today = localDay(new Date());
  // The day the keys move (and the month shown), and whether month/year are being picked
  const [cursor, setCursor] = useState(value || today);
  const [picking, setPicking] = useState<'days' | 'months'>('days');

  // The typed text follows the value when it changes from outside
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDraft(formatDayField(value)), [value]);

  if (touch) {
    return (
      <input
        type="date"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} ${inputClassName}`}
      />
    );
  }

  const openCalendar = (focusGrid = false) => {
    if (disabled) return;
    const typed = parseDayInput(draft);
    setCursor(typed || value || today);
    setPicking('days');
    show();
    if (focusGrid) requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.focus());
  };

  const commit = () => {
    const day = parseDayInput(draft);
    if (day === null) {
      setDraft(formatDayField(value));
      return;
    }
    setDraft(formatDayField(day));
    if (day !== value) onChange(day);
  };

  const pick = (day: string) => {
    setOpen(false);
    setDraft(formatDayField(day));
    if (day !== value) onChange(day);
    inputRef.current?.focus();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) gridRef.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.focus();
      else openCalendar(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => shiftDay(cursor, -1),
      ArrowRight: () => shiftDay(cursor, 1),
      ArrowUp: () => shiftDay(cursor, -7),
      ArrowDown: () => shiftDay(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
      Home: () => weekOf(cursor)[0],
      End: () => weekOf(cursor)[6],
    };
    if (moves[e.key]) {
      e.preventDefault();
      setCursor(moves[e.key]());
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.focus());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(cursor);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const locale = currentLocale();
  const first = firstWeekday();
  const weeks = monthGrid(cursor, first);
  const month = cursor.slice(0, 7);
  const [year] = cursor.split('-').map(Number);
  const weekdayNames = weekOf(today, first).map((d) => new Date(d + 'T12:00').toLocaleDateString(locale, { weekday: 'short' }).replace(/\.$/, ''));
  const navButton = 'w-8 h-8 flex items-center justify-center rounded-btn text-muted hover:text-main hover:bg-panel-elevated';

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        placeholder={t('dateField.placeholder')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => !open && openCalendar()}
        onChange={(e) => {
          setDraft(e.target.value);
          const typed = parseDayInput(e.target.value);
          if (typed) setCursor(typed);
        }}
        onBlur={commit}
        onKeyDown={onInputKey}
        className={`${inputClassName} w-full ${clearable && value ? 'pr-14' : 'pr-8'} disabled:opacity-50`}
      />
      <div className="absolute inset-y-0 right-1 flex items-center">
        {clearable && value && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraft('');
              onChange('');
            }}
            title={t('dateField.clear')}
            aria-label={t('dateField.clear')}
            className="w-6 h-6 flex items-center justify-center text-muted hover:text-status-err"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? setOpen(false) : openCalendar())}
          title={t('dateField.open')}
          aria-label={t('dateField.open')}
          className="w-6 h-6 flex items-center justify-center text-muted hover:text-main disabled:opacity-50"
        >
          <CalendarDays className="w-3.5 h-3.5" />
        </button>
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={ariaLabel}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: POPOVER_WIDTH }}
            className="fixed z-[60] p-2 bg-panel border border-border rounded-card shadow-panel text-xs animate-in fade-in duration-100"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between mb-1">
              <button
                type="button"
                className={navButton}
                aria-label={t(picking === 'days' ? 'dateField.prevMonth' : 'dateField.prevYear')}
                title={t(picking === 'days' ? 'dateField.prevMonth' : 'dateField.prevYear')}
                onClick={() => setCursor(picking === 'days' ? addMonths(cursor, -1) : addMonths(cursor, -12))}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPicking(picking === 'days' ? 'months' : 'days')}
                title={t('dateField.chooseMonth')}
                className="h-8 px-2 rounded-btn font-semibold text-main hover:bg-panel-elevated capitalize"
              >
                {picking === 'days'
                  ? new Date(cursor + 'T12:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })
                  : year}
              </button>
              <button
                type="button"
                className={navButton}
                aria-label={t(picking === 'days' ? 'dateField.nextMonth' : 'dateField.nextYear')}
                title={t(picking === 'days' ? 'dateField.nextMonth' : 'dateField.nextYear')}
                onClick={() => setCursor(picking === 'days' ? addMonths(cursor, 1) : addMonths(cursor, 12))}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {picking === 'months' ? (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, i) => {
                  const day = `${year}-${String(i + 1).padStart(2, '0')}-01`;
                  const isCurrent = day.slice(0, 7) === month;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setCursor(day);
                        setPicking('days');
                      }}
                      className={`h-9 rounded-btn capitalize ${
                        isCurrent ? 'bg-accent text-on-accent font-semibold' : 'text-main hover:bg-panel-elevated'
                      }`}
                    >
                      {new Date(day + 'T12:00').toLocaleDateString(locale, { month: 'short' }).replace(/\.$/, '')}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div ref={gridRef} role="grid" onKeyDown={onGridKey}>
                <div role="row" className="grid grid-cols-7 mb-0.5">
                  {weekdayNames.map((name) => (
                    <div key={name} role="columnheader" className="h-6 flex items-center justify-center text-[10px] text-faint uppercase">
                      {name}
                    </div>
                  ))}
                </div>
                {weeks.map((week) => (
                  <div key={week[0]} role="row" className="grid grid-cols-7">
                    {week.map((day) => {
                      const inMonth = day.slice(0, 7) === month;
                      const weekday = new Date(day + 'T12:00').getDay();
                      const chosen = day === value;
                      const isToday = day === today;
                      const isCursor = day === cursor;
                      return (
                        <button
                          key={day}
                          type="button"
                          role="gridcell"
                          aria-selected={chosen}
                          aria-label={new Date(day + 'T12:00').toLocaleDateString(locale, { dateStyle: 'full' })}
                          data-cursor={isCursor}
                          tabIndex={isCursor ? 0 : -1}
                          onClick={() => pick(day)}
                          className={`h-8 m-px rounded-btn tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            chosen
                              ? 'bg-accent text-on-accent font-semibold'
                              : isToday
                              ? 'text-accent font-semibold ring-1 ring-inset ring-accent hover:bg-panel-elevated'
                              : `${inMonth ? 'text-main' : 'text-faint'} ${weekday === 0 || weekday === 6 ? 'bg-main/[0.03]' : ''} hover:bg-panel-elevated`
                          }`}
                        >
                          {Number(day.slice(8))}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
