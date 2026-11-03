import { describe, it, expect } from 'vitest';
import { passwordProblem } from '../password';

describe('passwordProblem (same rule as the server)', () => {
  it('needs 8 characters, counted as characters', () => {
    expect(passwordProblem('kurz')).toMatch(/mindestens 8 Zeichen/);
    expect(passwordProblem('        ')).toMatch(/mindestens 8 Zeichen/);
    expect(passwordProblem('geheim12')).toBeNull();
    expect(passwordProblem('äöüßäöüß')).toBeNull();
  });
});
