import { currentLocale } from '../i18n';

// Dates, times and sorting in the language of the app (i18n/index.ts)

const asDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

export const formatDate = (d: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
  asDate(d).toLocaleDateString(currentLocale(), options);

export const formatDateTime = (d: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
  asDate(d).toLocaleString(currentLocale(), options);

// Alphabetical order ignoring case and accents
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
