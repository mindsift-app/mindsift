import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthGrid, monthNames, parseISODate, todayISO } from '../../lib/journal';
import { formatDate } from '../../lib/format';

interface JournalCalendarProps {
  /** Day currently in view; the calendar follows its month */
  activeDate: string;
  /** Days with written entries (get a dot) */
  entryDates: Set<string>;
  onSelect: (date: string) => void;
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export const JournalCalendar: React.FC<JournalCalendarProps> = ({ activeDate, entryDates, onSelect }) => {
  const active = parseISODate(activeDate);
  const [view, setView] = useState({ year: active.getFullYear(), month: active.getMonth() });
  useEffect(() => {
    const d = parseISODate(activeDate);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  }, [activeDate]);

  const today = todayISO();
  const weeks = useMemo(() => monthGrid(view.year, view.month), [view]);
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    let first = now - 5;
    entryDates.forEach((d) => {
      first = Math.min(first, Number(d.slice(0, 4)));
    });
    const list: number[] = [];
    for (let y = now + 1; y >= first; y--) list.push(y);
    return list;
  }, [entryDates]);

  const shiftMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <div className="select-none text-xs" aria-label="Journal-Kalender">
      <div className="flex items-center gap-1 mb-1.5">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="h-9 w-9 sm:h-7 sm:w-7 shrink-0 rounded-btn flex items-center justify-center text-muted hover:text-main hover:bg-panel transition-colors cursor-pointer"
          title="Vorheriger Monat"
          aria-label="Vorheriger Monat"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <select
          value={view.month}
          onChange={(e) => setView((v) => ({ ...v, month: Number(e.target.value) }))}
          className="flex-1 min-w-0 h-9 sm:h-7 px-1.5 rounded-btn bg-panel text-main border-0 text-xs font-semibold outline-none focus:ring-1 focus:ring-accent cursor-pointer"
          aria-label="Monat"
        >
          {monthNames().map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={view.year}
          onChange={(e) => setView((v) => ({ ...v, year: Number(e.target.value) }))}
          className="w-[4.5rem] h-9 sm:h-7 px-1.5 rounded-btn bg-panel text-main border-0 text-xs font-semibold outline-none focus:ring-1 focus:ring-accent cursor-pointer"
          aria-label="Jahr"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="h-9 w-9 sm:h-7 sm:w-7 shrink-0 rounded-btn flex items-center justify-center text-muted hover:text-main hover:bg-panel transition-colors cursor-pointer"
          title="Nächster Monat"
          aria-label="Nächster Monat"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-faint font-semibold mb-0.5">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {weeks.flat().map((date, i) =>
          date ? (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-current={date === activeDate ? 'date' : undefined}
              title={formatDate(parseISODate(date), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              className={`relative h-9 sm:h-7 rounded-btn text-xs tabular-nums transition-colors cursor-pointer ${
                date === activeDate
                  ? 'bg-accent-dim text-accent font-bold'
                  : date === today
                  ? 'text-accent font-semibold ring-1 ring-inset ring-accent-border hover:bg-panel-elevated'
                  : 'text-main hover:bg-panel-elevated'
              }`}
            >
              {Number(date.slice(8))}
              {entryDates.has(date) && (
                <span className="absolute left-1/2 -translate-x-1/2 bottom-0.5 w-1 h-1 rounded-full bg-accent" />
              )}
            </button>
          ) : (
            <span key={`empty-${i}`} />
          )
        )}
      </div>
    </div>
  );
};
