import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { formatDate, formatDateRange } from '../format';

const day = new Date(2026, 9, 30, 14, 5);

describe('formatDate', () => {
  afterEach(async () => {
    await i18n.changeLanguage('de');
  });

  it('writes a date exactly as toLocaleDateString does', () => {
    const cases: Array<Intl.DateTimeFormatOptions | undefined> = [
      undefined,
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
      { day: 'numeric', month: 'short' },
      { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
      // only a time: the date is added, as toLocaleDateString does
      { hour: '2-digit', minute: '2-digit' },
    ];
    for (const options of cases) {
      expect(formatDate(day, options)).toBe(day.toLocaleDateString('de-DE', options));
      expect(formatDate(day.getTime(), options)).toBe(day.toLocaleDateString('de-DE', options));
      expect(formatDate(day.toISOString(), options)).toBe(day.toLocaleDateString('de-DE', options));
    }
  });

  it('reads "Invalid Date" for an invalid date instead of throwing', () => {
    expect(formatDate('kein Datum')).toBe(new Date('kein Datum').toLocaleDateString('de-DE'));
  });

  it('follows a change of language', async () => {
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
    expect(formatDate(day, options)).toBe('30. Oktober');
    await i18n.changeLanguage('en');
    expect(formatDate(day, options)).toBe('October 30');
    expect(formatDateRange(day, new Date(2026, 10, 2), options)).toMatch(/^October 30\s–\sNovember 2$/);
    await i18n.changeLanguage('de');
    expect(formatDate(day, options)).toBe('30. Oktober');
  });
});
