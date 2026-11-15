import { describe, expect, it } from 'vitest';
import { dataUrlBlob, draggedFiles, droppedImages, MAX_PASTED_IMAGES, pastedImages } from '../pasteImages';
import { clipboard, png } from '../../test/clipboard';


describe('pastedImages', () => {
  it('takes a screenshot (only an image file) as an image', () => {
    const file = png();
    expect(pastedImages(clipboard({ files: [file] }))).toEqual({ files: [file], urls: [], keepText: false, dropped: 0 });
  });

  it('takes several image files, one bullet each, in their order', () => {
    const a = png('a.png');
    const b = new File([new Uint8Array([1])], 'b.jpg', { type: 'image/jpeg' });
    expect(pastedImages(clipboard({ files: [a, b] }))?.files).toEqual([a, b]);
  });

  it('ignores files that are no images', () => {
    const pdf = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });
    expect(pastedImages(clipboard({ files: [pdf] }))).toBeNull();
  });

  it('prefers the image data of "Copy image" over its HTML and address', () => {
    const file = png();
    const html = '<meta charset="utf-8"><img src="https://example.com/katze.png" alt="Katze">';
    const got = pastedImages(clipboard({ files: [file], html, text: 'https://example.com/katze.png' }));
    expect(got).toEqual({ files: [file], urls: [], keepText: false, dropped: 0 });
  });

  it('lets text win over the picture office apps put next to it', () => {
    const html = '<table><tr><td>Umsatz</td><td>42</td></tr></table>';
    expect(pastedImages(clipboard({ files: [png()], text: 'Umsatz\t42', html }))).toBeNull();
  });

  it('keeps the text and adds the image when the HTML shows it was part of the selection', () => {
    const file = png();
    const html = '<p>Ein Absatz</p><img src="https://example.com/a.png">';
    expect(pastedImages(clipboard({ files: [file], text: 'Ein Absatz', html }))).toEqual({
      files: [file],
      urls: [],
      keepText: true,
      dropped: 0,
    });
  });

  it('copies images only known from HTML through the server, data: images directly', () => {
    const html = '<img src="https://example.com/a.png"><img src="data:image/png;base64,iVBORw0K"><img src="/relativ.png">';
    expect(pastedImages(clipboard({ html }))).toEqual({
      files: [],
      urls: ['https://example.com/a.png', 'data:image/png;base64,iVBORw0K'],
      keepText: false,
      dropped: 0,
    });
  });

  it('leaves a part of a web page with text and images a text paste', () => {
    const html = '<p>Artikel</p><img src="https://example.com/pixel.gif">';
    expect(pastedImages(clipboard({ html, text: 'Artikel' }))).toBeNull();
  });

  it('leaves plain text alone', () => {
    expect(pastedImages(clipboard({ text: 'Hallo' }))).toBeNull();
    expect(pastedImages(clipboard({ text: 'https://example.com/a.png' }))).toBeNull();
    expect(pastedImages(null)).toBeNull();
  });

  it('takes at most MAX_PASTED_IMAGES and says how many were dropped', () => {
    const files = Array.from({ length: MAX_PASTED_IMAGES + 2 }, (_, i) => png(`${i}.png`));
    const got = pastedImages(clipboard({ files }));
    expect(got?.files).toHaveLength(MAX_PASTED_IMAGES);
    expect(got?.dropped).toBe(2);
  });
});

describe('dataUrlBlob', () => {
  it('decodes base64 data URLs with their type', async () => {
    const blob = dataUrlBlob('data:image/png;base64,iVBORw==');
    expect(blob.type).toBe('image/png');
    const bytes = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob);
    });
    expect(Array.from(new Uint8Array(bytes))).toEqual([137, 80, 78, 71]);
  });
});

describe('draggedFiles', () => {
  const pdf = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });

  it('tells image files from other files while dragging', () => {
    expect(draggedFiles(clipboard({ files: [png()] }))).toBe('images');
    expect(draggedFiles(clipboard({ files: [pdf, png()] }))).toBe('images');
    expect(draggedFiles(clipboard({ files: [pdf] }))).toBe('other');
  });

  it('ignores drags without files (a bullet by its handle, text, a link)', () => {
    expect(draggedFiles(clipboard({ text: 'Hallo' }))).toBeNull();
    expect(draggedFiles(clipboard({ extra: { 'application/mindsift-block': '{}' } }))).toBeNull();
    expect(draggedFiles(null)).toBeNull();
  });
});

describe('droppedImages', () => {
  it('takes the image files of a drop whatever text the file manager adds', () => {
    const file = png();
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' });
    const dropped = droppedImages(
      clipboard({ files: [txt, file], text: '/tmp/a.txt\n/tmp/bild.png', extra: { 'text/uri-list': 'file:///tmp/bild.png' } })
    );
    expect(dropped).toEqual({ images: { files: [file], urls: [], keepText: false, dropped: 0 }, otherFiles: 1 });
  });

  it('keeps at most MAX_PASTED_IMAGES dropped images', () => {
    const files = Array.from({ length: MAX_PASTED_IMAGES + 2 }, (_, i) => png(`${i}.png`));
    expect(droppedImages(clipboard({ files })).images?.dropped).toBe(2);
  });

  it('takes an image dragged out of a browser tab by its HTML or address', () => {
    expect(droppedImages(clipboard({ html: '<img src="https://example.com/a.png">', text: 'https://example.com/a.png' })).images?.urls).toEqual([
      'https://example.com/a.png',
    ]);
    expect(droppedImages(clipboard({ extra: { 'text/uri-list': 'https://example.com/bild.jpg' } })).images?.urls).toEqual([
      'https://example.com/bild.jpg',
    ]);
  });

  it('leaves text and links to the browser', () => {
    expect(droppedImages(clipboard({ text: 'Hallo' }))).toEqual({ images: null, otherFiles: 0 });
    expect(droppedImages(clipboard({ extra: { 'text/uri-list': 'https://example.com/seite' } })).images).toBeNull();
    expect(droppedImages(clipboard({ html: '<p>Text <img src="https://example.com/a.png"></p>' })).images).toBeNull();
  });
});
