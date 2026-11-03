import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderInlineMarkdown } from '../markdown';

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

  it('renders links correctly', () => {
    const { container } = render(<div>{renderInlineMarkdown('[Testseite](https://example.com)')}</div>);
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://example.com/');
    expect(link?.textContent).toBe('Testseite');
  });
});
