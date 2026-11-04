import { describe, it, expect } from 'vitest';
import { userColor, userColorStyles } from '../userColor';

describe('userColor', () => {
  it('gives the same person the same color every time', () => {
    expect(userColor('u_123')).toBe(userColor('u_123'));
    expect(userColorStyles('u_123').ring).toBe(userColorStyles('u_123').ring);
  });

  it('spreads different people over the palette', () => {
    const colors = new Set(Array.from({ length: 40 }, (_, i) => userColor(`user-${i}`)));
    expect(colors.size).toBeGreaterThan(6);
  });

  it('falls back to a color without a key', () => {
    expect(userColor(undefined)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
