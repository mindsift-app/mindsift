import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionPicker } from '../SectionPicker';

describe('SectionPicker', () => {
  it('uses switches and keeps at least one section on', () => {
    const onChange = vi.fn();
    render(<SectionPicker value={['notes']} onChange={onChange} />);
    const notes = screen.getByRole('switch', { name: 'Notizen' });
    expect(notes.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(notes); // last one cannot be switched off
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: 'Listen' }));
    expect(onChange).toHaveBeenCalledWith(['notes', 'lists']);
  });
});
