import { localDay, splitDue, joinDue } from './due';
import { currentLocale } from '../i18n';
import { Thought } from './types';

// The calendar view of tasks: days as YYYY-MM-DD in local time, weeks starting per language, and the
// entries of a range (a recurring task also shows its coming dates, computed like the server does).

const parseDay = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const shiftDay = (day: string, days: number): string => {
  const d = parseDay(day);
  d.setDate(d.getDate() + days);
  return localDay(d);
};

// First day of the week: 1 = Monday … 7 = Sunday (Intl week info where the browser knows it)
export function firstWeekday(locale: string = currentLocale()): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = loc.getWeekInfo?.() || loc.weekInfo;
    if (info?.firstDay) return info.firstDay;
  } catch {
    // older browsers: below
  }
  return /-(US|CA|JP|BR|IL|MX|PH)$/i.test(locale) ? 7 : 1;
}

// The 7 days of the week that contains day
export function weekOf(day: string, firstDay = firstWeekday()): string[] {
  const d = parseDay(day);
  const weekday = d.getDay() === 0 ? 7 : d.getDay();
  const start = shiftDay(day, -((weekday - firstDay + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
}

// The weeks shown for the month of day (5 or 6 rows of 7 days, from the week of the 1st)
export function monthGrid(day: string, firstDay = firstWeekday()): string[][] {
  const d = parseDay(day);
  const first = localDay(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = localDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const weeks: string[][] = [];
  let start = weekOf(first, firstDay)[0];
  while (start <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => shiftDay(start, i)));
    start = shiftDay(start, 7);
  }
  return weeks;
}

// ISO week number ("KW 46")
export function isoWeek(day: string): number {
  const d = parseDay(day);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNr);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

const addMonthsClamped = (day: string, months: number): string => {
  const d = parseDay(day);
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return localDay(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay)));
};

// The next date of a repeating task, as the server computes it when the task is ticked off
export function nextRepeat(day: string, rule: string): string {
  switch (rule) {
    case 'daily':
      return shiftDay(day, 1);
    case 'weekly':
      return shiftDay(day, 7);
    case 'monthly':
      return addMonthsClamped(day, 1);
    case 'yearly':
      return addMonthsClamped(day, 12);
  }
  return day;
}

// A new due date on another day; the time stays
export function moveDue(due: string | undefined, day: string): string {
  return joinDue(day, splitDue(due).time);
}

export interface CalendarEntry {
  task: Thought;
  time: string; // HH:MM or '' (all day)
  // A coming date of a repeating task (shown greyed, opens the task itself)
  upcoming: boolean;
}

// The entries per day between from and to (both included): due tasks, and the coming dates of open
// repeating tasks. All-day entries first, then by time.
export function entriesByDay(tasks: Thought[], from: string, to: string): Map<string, CalendarEntry[]> {
  const out = new Map<string, CalendarEntry[]>();
  const add = (day: string, e: CalendarEntry) => {
    if (day < from || day > to) return;
    const list = out.get(day);
    if (list) list.push(e);
    else out.set(day, [e]);
  };
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const { date, time } = splitDue(task.dueDate);
    add(date, { task, time, upcoming: false });
    if (task.recurrence && !task.isCompleted) {
      let next = nextRepeat(date, task.recurrence);
      for (let n = 0; n < 400 && next <= to; n++) {
        add(next, { task, time, upcoming: true });
        next = nextRepeat(next, task.recurrence);
      }
    }
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.time === b.time ? 0 : !a.time ? -1 : !b.time ? 1 : a.time.localeCompare(b.time)));
  }
  return out;
}
