import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_QUALITY, mediaContent, parseMediaContent, prepareImage, serverImageQuality, setServerImageQuality } from '../media';

describe('media content format', () => {
  it('round-trips captions, also with brackets and backslashes', () => {
    for (const caption of ['', 'Urlaub 2026', 'Plan [Entwurf]', 'C:\\Fotos\\x', 'zwei\nZeilen']) {
      const content = mediaContent('image', 'med_0123abcd', caption);
      expect(content.startsWith('![')).toBe(true);
      expect(parseMediaContent(content)).toEqual({ id: 'med_0123abcd', caption: caption.replace(/\n/g, ' ') });
    }
    expect(mediaContent('audio', 'med_ff', 'Sprachnotiz')).toBe('[Sprachnotiz](media:med_ff)');
  });

  it('stores a width set by hand after the caption, like Obsidian', () => {
    expect(mediaContent('image', 'med_ab', 'Urlaub', 320)).toBe('![Urlaub|320](media:med_ab)');
    expect(mediaContent('image', 'med_ab', '', 199.6)).toBe('![|200](media:med_ab)');
    expect(parseMediaContent('![Urlaub|320](media:med_ab)')).toEqual({ id: 'med_ab', caption: 'Urlaub', width: 320 });
    expect(parseMediaContent('![|48](media:med_ab)')).toEqual({ id: 'med_ab', caption: '', width: 48 });
    // Without a width it stays the old format
    expect(mediaContent('image', 'med_ab', 'Urlaub')).toBe('![Urlaub](media:med_ab)');
    expect(mediaContent('image', 'med_ab', 'Urlaub', 0)).toBe('![Urlaub](media:med_ab)');
    // Recordings have no width
    expect(mediaContent('audio', 'med_ab', 'Notiz', 320)).toBe('[Notiz](media:med_ab)');
    expect(parseMediaContent('[Spur|2](media:med_ab)')).toEqual({ id: 'med_ab', caption: 'Spur|2' });
  });

  it('escapes a "|" of the caption, so it is never read as a width', () => {
    for (const caption of ['A|B', 'Seite|12', 'Ende|', 'C:\\|5']) {
      const content = mediaContent('image', 'med_ab', caption);
      expect(parseMediaContent(content)).toEqual({ id: 'med_ab', caption });
      expect(parseMediaContent(mediaContent('image', 'med_ab', caption, 640))).toEqual({ id: 'med_ab', caption, width: 640 });
    }
    // Older content with an unescaped "|" inside the caption keeps it
    expect(parseMediaContent('![A|B](media:med_ab)')).toEqual({ id: 'med_ab', caption: 'A|B' });
  });

  it('ignores anything that is not a media reference', () => {
    expect(parseMediaContent('![x](https://example.com/a.png)')).toBeNull();
    expect(parseMediaContent('Text ![x](media:med_aa)')).toBeNull();
    expect(parseMediaContent('![x](media:../etc/passwd)')).toBeNull();
  });
});

// prepareImage with a fake decoder and canvas: what size and encoder quality each level asks for
describe('prepareImage per image quality', () => {
  const calls: { type: string; quality: number; width: number; height: number }[] = [];
  let webp = true;

  function fakeBrowser(width: number, height: number) {
    calls.length = 0;
    vi.stubGlobal('createImageBitmap', async () => ({ width, height, close: () => {} }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ drawImage: () => {}, fillRect: () => {} }) as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
      type?: string,
      quality?: number
    ) {
      calls.push({ type: type!, quality: quality!, width: this.width, height: this.height });
      const out = type === 'image/webp' && !webp ? 'image/png' : type!;
      cb(new Blob(['x'], { type: out }));
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setServerImageQuality('high');
    webp = true;
  });

  const photo = () => new Blob(['jpeg'], { type: 'image/jpeg' });

  it('keeps 2048 px for every level and only changes the WebP quality', async () => {
    for (const [level, quality] of [['high', 0.82], ['medium', 0.65], ['low', 0.5]] as const) {
      fakeBrowser(4096, 3072);
      const out = await prepareImage(photo(), level);
      expect(out.name).toBe('bild.webp');
      expect(calls).toEqual([{ type: 'image/webp', quality, width: 2048, height: 1536 }]);
    }
  });

  it('uses the level the server said, and high for anything unknown', async () => {
    expect(serverImageQuality()).toBe('high');
    setServerImageQuality('low');
    fakeBrowser(800, 600);
    await prepareImage(photo());
    expect(calls[0]).toEqual({ type: 'image/webp', quality: 0.5, width: 800, height: 600 });
    setServerImageQuality('ultra');
    expect(serverImageQuality()).toBe('high');
  });

  it('falls back to JPEG a little above the WebP quality', async () => {
    webp = false;
    fakeBrowser(1000, 1000);
    const out = await prepareImage(photo(), 'medium');
    expect(out.name).toBe('bild.jpg');
    expect(calls.map((c) => [c.type, c.quality])).toEqual([
      ['image/webp', IMAGE_QUALITY.medium.webp],
      ['image/jpeg', IMAGE_QUALITY.medium.jpeg],
    ]);
    expect(IMAGE_QUALITY.medium.jpeg).toBeGreaterThan(IMAGE_QUALITY.medium.webp);
  });

  it('leaves GIFs as they are', async () => {
    fakeBrowser(4096, 4096);
    const gif = new Blob(['GIF89a'], { type: 'image/gif' });
    const out = await prepareImage(gif, 'low');
    expect(out.blob).toBe(gif);
    expect(calls).toHaveLength(0);
  });
});
