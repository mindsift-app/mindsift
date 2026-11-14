import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  linkCardUrl,
  hidePreviewContent,
  linkPreviewsEnabled,
  loadLinkPreview,
  serverLinkPreviewsOn,
  setServerLinkPreviews,
} from '../linkPreview';

describe('link previews switched off for the whole server', () => {
  afterEach(() => {
    setServerLinkPreviews(true);
    vi.unstubAllGlobals();
  });

  it('turns all previews off, whatever this device says', () => {
    expect(linkPreviewsEnabled()).toBe(true);
    setServerLinkPreviews(false);
    expect(serverLinkPreviewsOn()).toBe(false);
    expect(linkPreviewsEnabled()).toBe(false);
    setServerLinkPreviews(true);
    expect(linkPreviewsEnabled()).toBe(true);
  });

  it('learns it from the server answer link_previews_off', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Link-Vorschauen sind auf diesem Server ausgeschaltet', code: 'link_previews_off' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const changed = vi.fn();
    window.addEventListener('mindsift:link-previews', changed);
    expect(await loadLinkPreview('https://koch.de/spaetzle')).toBeNull();
    window.removeEventListener('mindsift:link-previews', changed);
    expect(serverLinkPreviewsOn()).toBe(false);
    expect(changed).toHaveBeenCalled();
  });

  it('keeps previews on after other refusals (a plain 404, the demo)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'In der Demo deaktiviert' }), { status: 403 })));
    expect(await loadLinkPreview('https://koch.de/andere-seite')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'nicht da' }), { status: 404 })));
    expect(await loadLinkPreview('https://koch.de/dritte-seite')).toBeNull();
    expect(serverLinkPreviewsOn()).toBe(true);
  });
});

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
