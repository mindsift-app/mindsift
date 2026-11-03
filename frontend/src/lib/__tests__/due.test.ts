import { describe, it, expect } from 'vitest';
import { formatDue, isOverdue, isDueToday, joinDue, splitDue } from '../due';

const now = new Date(2026, 9, 29, 14, 0); // Thu 29.10.2026, 14:00 local

describe('due dates', () => {
  it('splits and joins date and time', () => {
    expect(splitDue('2026-10-30T14:30')).toEqual({ date: '2026-10-30', time: '14:30' });
    expect(splitDue('2026-10-30')).toEqual({ date: '2026-10-30', time: '' });
    expect(joinDue('2026-10-30', '09:15')).toBe('2026-10-30T09:15');
    expect(joinDue('2026-10-30', '')).toBe('2026-10-30');
    expect(joinDue('', '09:15')).toBe('');
  });

  it('formats relative to today', () => {
    expect(formatDue('2026-10-29T14:30', now)).toBe('Heute, 14:30');
    expect(formatDue('2026-10-30', now)).toBe('Morgen');
    expect(formatDue('2026-10-28', now)).toBe('Gestern');
    expect(formatDue('2026-11-06T08:00', now)).toBe('Fr., 06.11., 08:00');
    expect(formatDue('2027-01-02', now)).toBe('02.01.2027');
  });

  it('knows overdue to the minute', () => {
    expect(isOverdue('2026-10-29T13:59', now)).toBe(true);
    expect(isOverdue('2026-10-29T14:30', now)).toBe(false);
    expect(isOverdue('2026-10-29', now)).toBe(false);
    expect(isOverdue('2026-10-28', now)).toBe(true);
    expect(isDueToday('2026-10-29T08:00', now)).toBe(true);
  });
});
