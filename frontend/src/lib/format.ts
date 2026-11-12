import { currentLocale } from '../i18n';

// Dates, times and sorting in the language of the app (i18n/index.ts)

const asDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

// One formatter per language, options and time zone offset: toLocaleDateString builds a new one on every call,
// which costs far more than formatting itself (a calendar month formats some 30 days on every render)
const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${currentLocale()}|${new Date().getTimezoneOffset()}|${options ? JSON.stringify(options) : ''}`;
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(currentLocale(), options);
    dateFormats.set(key, f);
  }
  return f;
}

// toLocaleDateString shows day, month and year unless the options name a part of the date (a formatter on its
// own would show only the time for options with nothing but a time)
const withDate = (o?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions | undefined =>
  !o || o.dateStyle || o.timeStyle || o.weekday || o.year || o.month || o.day ? o : { ...o, year: 'numeric', month: 'numeric', day: 'numeric' };

export const formatDate = (d: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
  const date = asDate(d);
  // An invalid date reads "Invalid Date" there, while a formatter throws
  return Number.isNaN(date.getTime()) ? date.toLocaleDateString(currentLocale(), options) : dateFormat(withDate(options)).format(date);
};

export const formatDateTime = (d: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
  asDate(d).toLocaleString(currentLocale(), options);

// "9.–15. Nov." (shared parts once, as the language writes a range)
export const formatDateRange = (a: Date | string | number, b: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
  const f = dateFormat(options) as Intl.DateTimeFormat & { formatRange?: (x: Date, y: Date) => string };
  return f.formatRange ? f.formatRange(asDate(a), asDate(b)) : `${f.format(asDate(a))} – ${f.format(asDate(b))}`;
};

// Alphabetical order ignoring case and accents
// 20000 → "20.000" in German, "20,000" in English
export const formatNumber = (n: number) => n.toLocaleString(currentLocale());

export const compareText = (a: string, b: string) => a.localeCompare(b, currentLocale(), { sensitivity: 'base' });

// "vor 5 Minuten", "gestern" … for recent times; older than a week: the date
export const formatRelative = (d: Date | string | number, now: Date = new Date()) => {
  const seconds = (asDate(d).getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(seconds / 86400), 'day');
  return formatDate(d, { day: 'numeric', month: 'short' });
};
