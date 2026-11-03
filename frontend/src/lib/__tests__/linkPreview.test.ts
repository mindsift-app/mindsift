import { describe, expect, it } from 'vitest';
import { linkCardUrl, hidePreviewContent } from '../linkPreview';

describe('link preview helpers', () => {
  it('returns the URL only when the entire trimmed content is a single https address', () => {
    expect(linkCardUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(linkCardUrl('  https://example.com/page/  ')).toBe('https://example.com/page/');
    expect(linkCardUrl('Rezept: https://koch.de/spaetzle, lecker!')).toBeNull();
    expect(linkCardUrl('https://a.de https://b.de')).toBeNull();
    expect(linkCardUrl('siehe (https://x.de/p).')).toBeNull();
    expect(linkCardUrl('[Kochseite](https://koch.de)')).toBeNull();
    expect(linkCardUrl('http://unsicher.de')).toBeNull();
    expect(linkCardUrl('nur Text')).toBeNull();
  });

  it('hides a preview by turning the address into a named link', () => {
    expect(hidePreviewContent('Lesen: https://koch.de/x', 'https://koch.de/x', 'Käsespätzle [Rezept]')).toBe(
      'Lesen: [Käsespätzle Rezept](https://koch.de/x)'
    );
    expect(hidePreviewContent('https://koch.de/x', 'https://koch.de/x', '')).toBe('[koch.de](https://koch.de/x)');
    expect(linkCardUrl(hidePreviewContent('https://koch.de/x', 'https://koch.de/x', 'T'))).toBeNull();
  });
});

describe('linkHost', () => {
  it('shows host and path without scheme and www', async () => {
    const { linkHost } = await import('../linkPreview');
    expect(linkHost('https://www.example.com/')).toBe('example.com');
    expect(linkHost('https://example.com/blog/post')).toBe('example.com/blog/post');
  });
});
