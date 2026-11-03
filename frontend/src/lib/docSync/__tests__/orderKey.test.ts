import { describe, it, expect } from 'vitest';
import { keyBetween, keysBetween, validOrderKey } from '../orderKey';

// Generated with internal/collab (Go); both implementations must agree exactly.
const VECTORS: [string, string, string][] = [
  ['', '', 'a0'],
  ['a0', '', 'a1'],
  ['', 'a0', 'Zz'],
  ['a0', 'a1', 'a0V'],
  ['a0', 'a0V', 'a0F'],
  ['a0V', 'a1', 'a0k'],
  ['Zz', 'a0', 'ZzV'],
  ['az', '', 'b00'],
  ['', 'Zz', 'Zy'],
  ['a1', 'a1V', 'a1F'],
  ['b00', 'b01', 'b00V'],
];

describe('order keys', () => {
  it('match the Go implementation', () => {
    for (const [a, b, want] of VECTORS) expect(keyBetween(a, b)).toBe(want);
    expect(keysBetween('a0', 'a1', 5)).toEqual(['a07', 'a0F', 'a0V', 'a0c', 'a0k']);
    let last = '';
    for (let i = 0; i < 70; i++) last = keyBetween(last, '');
    expect(last).toBe('b07');
  });

  it('rejects invalid ranges and keys', () => {
    expect(() => keyBetween('zz', '')).toThrow();
    expect(() => keyBetween('a1', 'a0')).toThrow();
    expect(validOrderKey('a0V0')).toBe(false);
  });

  it('stays sorted under random inserts', () => {
    const keys: string[] = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 2000; i++) {
      const pos = Math.floor(rnd() * (keys.length + 1));
      keys.splice(pos, 0, keyBetween(keys[pos - 1] || '', keys[pos] || ''));
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
