import { describe, it, expect } from 'vitest';
import { joinSpeechResults } from '../voice';

describe('joinSpeechResults (browser speech recognition)', () => {
  it('Android: growing interim states of one phrase count once', () => {
    expect(joinSpeechResults(['Test', 'Test', 'Test', 'Test', 'Test', 'Test 1 2 3'])).toBe('Test 1 2 3');
    expect(joinSpeechResults(['Test', 'Test 1', 'Test 1 2', 'Test 1 2 3'])).toBe('Test 1 2 3');
  });

  it('desktop: consecutive pieces are joined', () => {
    expect(joinSpeechResults(['Milch kaufen', ' und Brot'])).toBe('Milch kaufen und Brot');
  });

  it('Android: a new phrase after a finished one is appended', () => {
    expect(joinSpeechResults(['Milch', 'Milch kaufen', ' und Brot', ' und Brot holen'])).toBe('Milch kaufen und Brot holen');
  });

  it('ignores empty results and earlier shorter states', () => {
    expect(joinSpeechResults(['', 'Test 1 2', 'Test 1', ''])).toBe('Test 1 2');
  });
});
