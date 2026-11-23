import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingState, Spinner } from '../Spinner';
import { EmptyState } from '../EmptyState';

describe('Spinner, LoadingState and EmptyState', () => {
  it('a spinner is decoration unless it has a label', () => {
    const { container, rerender } = render(<Spinner size="lg" tone="accent" />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toContain('animate-spin');
    expect(svg.getAttribute('class')).toContain('w-5');
    rerender(<Spinner label="Wird geladen …" />);
    expect(screen.getByRole('status', { name: 'Wird geladen …' })).toBeTruthy();
  });

  it('says what loads, "Wird geladen …" by default', () => {
    const { rerender } = render(<LoadingState />);
    expect(screen.getByRole('status').textContent).toBe('Wird geladen …');
    rerender(<LoadingState label="Notizen werden geladen …" />);
    expect(screen.getByRole('status').textContent).toBe('Notizen werden geladen …');
  });

  it('an empty state is one muted line, framed when it stands alone', () => {
    const { rerender } = render(<EmptyState>Der Papierkorb ist leer.</EmptyState>);
    const plain = screen.getByText('Der Papierkorb ist leer.');
    expect(plain.className).toContain('text-muted');
    expect(plain.className).not.toContain('border-dashed');
    rerender(<EmptyState framed>Der Papierkorb ist leer.</EmptyState>);
    expect(screen.getByText('Der Papierkorb ist leer.').className).toContain('border-dashed');
  });
});
