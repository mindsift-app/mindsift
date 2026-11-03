import { describe, it, expect } from 'vitest';
import { monthGrid, toISODate, parseISODate } from '../journal';

describe('journal dates', () => {
  it('builds a Monday-first month grid', () => {
    // October 2026 starts on a Thursday
    const weeks = monthGrid(2026, 9);
    expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('round-trips local dates', () => {
    expect(toISODate(parseISODate('2026-03-01'))).toBe('2026-03-01');
  });
});
