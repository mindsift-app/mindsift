import { describe, it, expect } from 'vitest';
import { dateOrder, formatDayField, parseDayInput, uses12h, formatTimeField, parseTimeInput, stepTime, timeSlots } from '../dateInput';

const today = new Date(2026, 10, 10);

describe('date fields in the order of the language', () => {
  it('knows the order of day, month and year', () => {
    expect(dateOrder('de-DE')).toEqual(['d', 'm', 'y']);
    expect(dateOrder('en-US')).toEqual(['m', 'd', 'y']);
  });

  it('shows a day as the language writes it', () => {
    expect(formatDayField('2026-11-24', 'de-DE')).toBe('24.11.2026');
    expect(formatDayField('2026-11-24', 'en-US')).toBe('11/24/2026');
    expect(formatDayField('', 'de-DE')).toBe('');
  });

  it('reads what was typed, in German', () => {
    expect(parseDayInput('24.11.2026', 'de-DE', today)).toBe('2026-11-24');
    expect(parseDayInput('24.11.26', 'de-DE', today)).toBe('2026-11-24');
    expect(parseDayInput('24.11.', 'de-DE', today)).toBe('2026-11-24');
    expect(parseDayInput('3.1.2027', 'de-DE', today)).toBe('2027-01-03');
    expect(parseDayInput('24112026', 'de-DE', today)).toBe('2026-11-24');
    expect(parseDayInput('2411', 'de-DE', today)).toBe('2026-11-24');
    expect(parseDayInput('2026-11-24', 'de-DE', today)).toBe('2026-11-24');
  });

  it('reads what was typed, in English', () => {
    expect(parseDayInput('11/24/2026', 'en-US', today)).toBe('2026-11-24');
    expect(parseDayInput('11/24', 'en-US', today)).toBe('2026-11-24');
  });

  it('keeps empty apart from wrong', () => {
    expect(parseDayInput('  ', 'de-DE', today)).toBe('');
    expect(parseDayInput('31.11.2026', 'de-DE', today)).toBeNull();
    expect(parseDayInput('morgen', 'de-DE', today)).toBeNull();
    expect(parseDayInput('13.13.', 'de-DE', today)).toBeNull();
  });
});

describe('time fields', () => {
  it('uses AM/PM only where the language does', () => {
    expect(uses12h('de-DE')).toBe(false);
    expect(uses12h('en-US')).toBe(true);
    expect(formatTimeField('14:30', 'de-DE')).toBe('14:30');
    expect(formatTimeField('14:30', 'en-US')).toMatch(/^2:30\sPM$/);
  });

  it('reads what was typed', () => {
    expect(parseTimeInput('14:30')).toBe('14:30');
    expect(parseTimeInput('14.30')).toBe('14:30');
    expect(parseTimeInput('1430')).toBe('14:30');
    expect(parseTimeInput('930')).toBe('09:30');
    expect(parseTimeInput('9')).toBe('09:00');
    expect(parseTimeInput('2:30 pm')).toBe('14:30');
    expect(parseTimeInput('2pm')).toBe('14:00');
    expect(parseTimeInput('12 am')).toBe('00:00');
    expect(parseTimeInput('')).toBe('');
    expect(parseTimeInput('25:00')).toBeNull();
    expect(parseTimeInput('abc')).toBeNull();
  });

  it('steps by 15 minutes and lists the day in steps', () => {
    expect(stepTime('14:30', 1)).toBe('14:45');
    expect(stepTime('14:37', 1)).toBe('14:45');
    expect(stepTime('14:37', -1)).toBe('14:30');
    expect(stepTime('23:45', 1)).toBe('00:00');
    expect(stepTime('', 1, 15, new Date(2026, 10, 10, 9, 5))).toBe('09:15');
    expect(timeSlots(15)).toHaveLength(96);
  });
});
