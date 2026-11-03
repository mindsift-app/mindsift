import { describe, expect, it } from 'vitest';
import { mediaContent, parseMediaContent } from '../media';

describe('media content format', () => {
  it('round-trips captions, also with brackets and backslashes', () => {
    for (const caption of ['', 'Urlaub 2026', 'Plan [Entwurf]', 'C:\\Fotos\\x', 'zwei\nZeilen']) {
      const content = mediaContent('image', 'med_0123abcd', caption);
      expect(content.startsWith('![')).toBe(true);
      expect(parseMediaContent(content)).toEqual({ id: 'med_0123abcd', caption: caption.replace(/\n/g, ' ') });
    }
    expect(mediaContent('audio', 'med_ff', 'Sprachnotiz')).toBe('[Sprachnotiz](media:med_ff)');
  });

  it('ignores anything that is not a media reference', () => {
    expect(parseMediaContent('![x](https://example.com/a.png)')).toBeNull();
    expect(parseMediaContent('Text ![x](media:med_aa)')).toBeNull();
    expect(parseMediaContent('![x](media:../etc/passwd)')).toBeNull();
  });
});
