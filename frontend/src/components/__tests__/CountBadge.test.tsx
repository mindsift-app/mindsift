import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CountBadge } from '../CountBadge';

describe('CountBadge', () => {
  it('hides itself at zero unless asked', () => {
    expect(render(<CountBadge count={0} />).container.firstChild).toBeNull();
    expect(render(<CountBadge count={undefined} />).container.firstChild).toBeNull();
    expect(render(<CountBadge count={0} showZero />).container.textContent).toBe('0');
  });

  it('caps large numbers and keeps the real value for screen readers', () => {
    const el = render(<CountBadge count={150} />).container.firstChild as HTMLElement;
    expect(el.textContent).toBe('99+');
    expect(el.getAttribute('aria-label')).toBe('150');
  });

  it('maps variant and position to the shared classes', () => {
    const el = render(<CountBadge count={3} variant="accent" position="corner" />).container.firstChild as HTMLElement;
    expect(el.className).toContain('count-badge-accent');
    expect(el.className).toContain('count-badge-corner');
  });
});
