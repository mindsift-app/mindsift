import { describe, it, expect } from 'vitest';
import { extractHashtags } from '../hashtags';

describe('extractHashtags', () => {
  it('finds tags at the start, after spaces and after "("', () => {
    expect(extractHashtags('#start mitten #zwei (#drei)')).toEqual(['start', 'zwei', 'drei']);
  });

  it('ignores URL anchors and words like C#', () => {
    expect(extractHashtags('example.com/blog#ueberschrift')).toEqual([]);
    expect(extractHashtags('https://x.de/#anker und #echt, C# nicht')).toEqual(['echt']);
  });
});
