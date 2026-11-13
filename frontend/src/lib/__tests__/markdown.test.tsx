import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { notePreview, renderInlineMarkdown } from '../markdown';

describe('renderInlineMarkdown', () => {
  it('renders bold text with <strong> tag', () => {
    const { container } = render(<div>{renderInlineMarkdown('Text mit **fettem** Wort')}</div>);
    const strong = container.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe('fettem');
  });

  it('renders inline code inside bold text', () => {
    const { container } = render(<div>{renderInlineMarkdown('Der Block **`services`** startet')}</div>);
    const code = container.querySelector('strong code');
    expect(code?.textContent).toBe('services');
    expect(container.textContent).toBe('Der Block services startet');
  });

  it('links bare web addresses without the trailing punctuation and keeps markdown links intact', () => {
    const { container } = render(
      <div>{renderInlineMarkdown('Siehe https://example.com/a_b_c. und [Doku](https://example.org/x) oder https://x.de/#frag')}</div>
    );
    const links = [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['https://example.com/a_b_c', 'https://example.com/a_b_c'],
      ['Doku', 'https://example.org/x'],
      ['https://x.de/#frag', 'https://x.de/#frag'],
    ]);
    expect(container.textContent).toBe('Siehe https://example.com/a_b_c. und Doku oder https://x.de/#frag');
  });

  it('renders italic text with <em> tag', () => {
    const { container } = render(<div>{renderInlineMarkdown('Text mit *kursivem* Wort')}</div>);
    const em = container.querySelector('em');
    expect(em).toBeTruthy();
    expect(em?.textContent).toBe('kursivem');
  });

  it('renders both bold and italic text in one paragraph', () => {
    const { container } = render(<div>{renderInlineMarkdown('Hier ist **fett** und *kursiv* vereint')}</div>);
    const strong = container.querySelector('strong');
    const em = container.querySelector('em');
    expect(strong?.textContent).toBe('fett');
    expect(em?.textContent).toBe('kursiv');
  });

  it('keeps finding tokens after formatting that has tokens inside, with and without hashtags', () => {
    const text = '__fett mit *kursiv* und `code`__ dann ~~weg mit **fett**~~ und #garten am [Ende](https://example.com)';
    for (const options of [undefined, { onTagClick: () => {} }]) {
      const { container, unmount } = render(<div>{renderInlineMarkdown(text, options)}</div>);
      expect(container.querySelector('strong em')?.textContent).toBe('kursiv');
      expect(container.querySelector('strong code')?.textContent).toBe('code');
      expect(container.querySelector('del strong')?.textContent).toBe('fett');
      expect(container.querySelector('a')?.textContent).toBe('Ende');
      expect(container.querySelector('[role="button"]')?.textContent).toBe(options ? '#garten' : undefined);
      expect(container.textContent).toBe('fett mit kursiv und code dann weg mit fett und #garten am Ende');
      unmount();
    }
  });

  it('renders links correctly', () => {
    const { container } = render(<div>{renderInlineMarkdown('[Testseite](https://example.com)')}</div>);
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://example.com/');
    expect(link?.textContent).toBe('Testseite');
  });
});

describe('notePreview', () => {
  it('keeps a short note and collapses line breaks', () => {
    expect(notePreview('Händler hat das Ersatzteil\n\n  seit Montag da.')).toBe('Händler hat das Ersatzteil seit Montag da.');
    expect(notePreview('')).toBe('');
  });

  it('cuts a long note after 60 characters with an ellipsis', () => {
    const long = 'a'.repeat(50) + ' ' + 'b'.repeat(50);
    const out = notePreview(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out).toBe('a'.repeat(50) + ' ' + 'b'.repeat(9) + '…');
  });

  it('counts a mention as a short name and never cuts it', () => {
    const mention = '{{mention:abcdefghijklmnopqrstuvwxyz0123456789}}';
    expect(notePreview(`Frag ${mention} wegen der SSD`)).toBe(`Frag ${mention} wegen der SSD`);
    const cut = notePreview('x'.repeat(55) + ' ' + mention + ' danach');
    expect(cut).toBe('x'.repeat(55) + '…');
    expect(cut).not.toContain('{{mention');
  });
});
