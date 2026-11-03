import { describe, it, expect } from 'vitest';
import { formatSharedThought } from '../shareTarget';

describe('formatSharedThought', () => {
  it('formats pure text correctly', () => {
    expect(formatSharedThought({ text: 'Spontaner Einfall' })).toBe('Spontaner Einfall');
  });

  it('formats pure url correctly', () => {
    expect(formatSharedThought({ url: 'https://example.com/article' })).toBe('https://example.com/article');
  });

  it('combines title and url when text is empty', () => {
    expect(formatSharedThought({ title: 'Toller Artikel', url: 'https://example.com/article' }))
      .toBe('Toller Artikel\nhttps://example.com/article');
  });

  it('does not duplicate URL when text already contains it', () => {
    const input = {
      title: 'Artikel',
      text: 'Lies das hier: https://example.com/article unbedingt!',
      url: 'https://example.com/article',
    };
    expect(formatSharedThought(input))
      .toBe('Artikel\nLies das hier: https://example.com/article unbedingt!');
  });

  it('does not duplicate URL when text is exactly the URL', () => {
    const input = {
      title: 'News',
      text: 'https://news.example.com',
      url: 'https://news.example.com',
    };
    expect(formatSharedThought(input))
      .toBe('News\nhttps://news.example.com');
  });

  it('does not duplicate title if text starts with title', () => {
    const input = {
      title: 'MindSift Update',
      text: 'MindSift Update ist jetzt verfügbar.',
    };
    expect(formatSharedThought(input))
      .toBe('MindSift Update ist jetzt verfügbar.');
  });

  it('combines title, text and distinct URL', () => {
    const input = {
      title: 'Empfehlung',
      text: 'Ein großartiges Tool für schnelles Erfassen.',
      url: 'https://mindsift.app',
    };
    expect(formatSharedThought(input))
      .toBe('Empfehlung\nEin großartiges Tool für schnelles Erfassen.\nhttps://mindsift.app');
  });

  it('handles image with text', () => {
    const input = {
      title: 'Foto vom Ausflug',
      fileName: 'berge.jpg',
      hasMedia: true,
    };
    expect(formatSharedThought(input))
      .toBe('Foto vom Ausflug\n(Bild geteilt – Bilder im Posteingang werden noch nicht unterstützt)');
  });

  it('handles image only with filename', () => {
    const input = {
      fileName: 'screenshot.png',
      hasMedia: true,
    };
    expect(formatSharedThought(input))
      .toBe('[screenshot.png] (Bild geteilt – Bilder im Posteingang werden noch nicht unterstützt)');
  });

  it('handles image only without filename', () => {
    const input = {
      hasMedia: true,
    };
    expect(formatSharedThought(input))
      .toBe('(Bild geteilt – Bilder im Posteingang werden noch nicht unterstützt)');
  });

  it('returns empty string if nothing is provided', () => {
    expect(formatSharedThought({})).toBe('');
  });
});
