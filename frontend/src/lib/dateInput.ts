import { currentLocale } from '../i18n';
import { localDay } from './due';

// Typing and showing dates and times in the fields of DateField and TimeField, in the order and clock of
// the language: "24.11.2026" and "14:30" in German, "11/24/2026" and "2:30 PM" in English. Days are
// YYYY-MM-DD and times HH:MM (24 h), like the due dates of tasks.

type Part = 'd' | 'm' | 'y';

// The order of day, month and year when the language writes a date
export function dateOrder(locale: string = currentLocale()): Part[] {
  const map: Record<string, Part> = { day: 'd', month: 'm', year: 'y' };
  const order = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(2026, 10, 24))
    .map((p) => map[p.type])
    .filter(Boolean);
  return order.length === 3 ? order : ['d', 'm', 'y'];
}

export function formatDayField(day: string, locale: string = currentLocale()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return '';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  );
}

const validDay = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 ? localDay(date) : null;
};

// What someone typed into a date field: "24.11.2026", "24.11.26", "24.11." (this year), "24112026",
// "2026-11-24". '' for an empty field, null when it is no date.
export function parseDayInput(text: string, locale: string = currentLocale(), today: Date = new Date()): string | null {
  const s = text.trim();
  if (!s) return '';
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  let chunks = s.split(/[^0-9]+/).filter(Boolean);
  const order = dateOrder(locale);
  // Only digits: two each for day and month, the rest is the year
  if (chunks.length === 1 && [4, 6, 8].includes(chunks[0].length)) {
    const digits = chunks[0];
    const yearAt = order.indexOf('y');
    const sizes = order.map((p) => (p === 'y' ? digits.length - 4 : 2));
    if (yearAt !== 2 && sizes[yearAt] === 0) return null;
    chunks = [];
    let at = 0;
    for (const size of sizes) {
      if (size > 0) chunks.push(digits.slice(at, at + size));
      at += size;
    }
  }
  if (chunks.length < 2 || chunks.length > 3) return null;
  const parts: Partial<Record<Part, number>> = {};
  // Without a year, day and month keep their order
  const used = chunks.length === 3 ? order : order.filter((p) => p !== 'y');
  used.forEach((p, i) => (parts[p] = Number(chunks[i])));
  let year = parts.y ?? today.getFullYear();
  if (parts.y !== undefined && chunks[used.indexOf('y')].length <= 2) year += 2000;
  return validDay(year, parts.m!, parts.d!);
}

// Whether the language uses a 12-hour clock (AM/PM)
export function uses12h(locale: string = currentLocale()): boolean {
  const options = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & { hourCycle?: string; hour12?: boolean };
  if (options.hourCycle === undefined) return !!options.hour12;
  const cycle = options.hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

export function formatTimeField(time: string, locale: string = currentLocale()): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return '';
  if (!uses12h(locale)) return time;
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 0, 1, Number(m[1]), Number(m[2])));
}

const pad = (n: number) => String(n).padStart(2, '0');

// What someone typed into a time field: "14:30", "14.30", "1430", "930", "9", "2:30 pm", "2pm". '' for an
// empty field, null when it is no time.
export function parseTimeInput(text: string): string | null {
  const s = text.trim().toLowerCase();
  if (!s) return '';
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?$/.exec(s.replace(/\s+/g, ' '));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.[0];
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    if (meridiem === 'p' && h < 12) h += 12;
    if (meridiem === 'a' && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

// Times of the list in the time field, every step minutes
export function timeSlots(step = 15): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  return out;
}

// One step of the arrow keys: to the next (or previous) full step from time, or from now when empty
export function stepTime(time: string, dir: 1 | -1, step = 15, now: Date = new Date()): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  const minutes = m ? Number(m[1]) * 60 + Number(m[2]) : now.getHours() * 60 + now.getMinutes();
  const next = dir > 0 ? Math.floor(minutes / step) * step + step : Math.ceil(minutes / step) * step - step;
  const wrapped = ((next % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}
