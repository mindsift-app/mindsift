import { describe, it, expect } from 'vitest';
import { parseISODate } from '../journal';
import { localDay } from '../due';

describe('journal dates', () => {
  it('round-trips local dates', () => {
    expect(localDay(parseISODate('2026-03-01'))).toBe('2026-03-01');
  });
});
