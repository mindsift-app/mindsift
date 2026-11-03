import { currentLocale } from '../i18n';

// Dates, times and sorting in the language of the app (i18n/index.ts)

const asDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

export const formatDate = (d: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
  asDate(d).toLocaleDateString(currentLocale(), options);

export const formatDateTime = (d: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
  asDate(d).toLocaleString(currentLocale(), options);

// Alphabetical order ignoring case and accents
export const compareText = (a: string, b: string) => a.localeCompare(b, currentLocale(), { sensitivity: 'base' });
