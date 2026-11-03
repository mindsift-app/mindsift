import { describe, it, expect } from 'vitest';
import { safeHref } from '../safeUrl';

describe('safeHref', () => {
  it('keeps web and mail links', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref(' http://example.com ')).toBe('http://example.com/');
    expect(safeHref('mailto:anna@example.com')).toBe('mailto:anna@example.com');
  });

  it('drops everything that could run code or load local data', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '/relative/path',
      '',
    ]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe('Markdown links in task notes', () => {
  it('render javascript: links as text, web links as links', async () => {
    const { render } = await import('@testing-library/react');
    const { MarkdownViewer } = await import('../markdown');
    const { container } = render(<MarkdownViewer content={'[Rechnung](javascript:alert(1)) und [Seite](https://example.com)'} />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/']);
    expect(container.textContent).toContain('Rechnung');
  });
});
