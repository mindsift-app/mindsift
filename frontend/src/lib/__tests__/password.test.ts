import { describe, it, expect } from 'vitest';
import { passwordPairProblem, passwordProblem } from '../password';

describe('passwordProblem (same rule as the server)', () => {
  it('needs 8 characters, counted as characters', () => {
    expect(passwordProblem('kurz')).toMatch(/mindestens 8 Zeichen/);
    expect(passwordProblem('        ')).toMatch(/mindestens 8 Zeichen/);
    expect(passwordProblem('geheim12')).toBeNull();
    expect(passwordProblem('äöüßäöüß')).toBeNull();
  });
});

describe('passwordPairProblem', () => {
  it('reports a short password first, then two that differ', () => {
    expect(passwordPairProblem('kurz', 'anders')).toMatch(/mindestens 8 Zeichen/);
    expect(passwordPairProblem('geheim123', 'geheim124')).toMatch(/stimmen nicht überein/);
    expect(passwordPairProblem('geheim123', 'geheim123')).toBeNull();
  });
});
