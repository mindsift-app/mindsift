import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../SegmentedControl';

describe('SegmentedControl', () => {
  it('marks the chosen option and reports a click on another one', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="open"
        onChange={onChange}
        ariaLabel="Anzeige"
        options={[
          { value: 'open', label: 'Offen', title: 'Nur offene To-Dos zeigen' },
          { value: 'all', label: 'Alle' },
        ]}
      />
    );
    expect(screen.getByRole('radio', { name: 'Offen' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Alle' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('radio', { name: 'Alle' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
