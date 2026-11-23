import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { applyLanguage } from '../../../i18n';
import { SectionPicker } from '../SectionPicker';

describe('SectionPicker', () => {
  it('uses switches and keeps at least one section on', () => {
    const onChange = vi.fn();
    render(<SectionPicker value={['notes']} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Bereiche' })).toBeTruthy();
    const notes = screen.getByRole('switch', { name: 'Notizen' });
    expect(notes.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(notes); // last one cannot be switched off
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: 'Listen' }));
    expect(onChange).toHaveBeenCalledWith(['notes', 'lists']);
  });

  it('names the sections in the chosen language', async () => {
    await act(() => applyLanguage('en'));
    try {
      render(<SectionPicker value={['notes']} onChange={vi.fn()} />);
      expect(screen.getByRole('group', { name: 'Sections' })).toBeTruthy();
      expect(screen.queryByText('Bereiche')).toBeNull();
    } finally {
      await act(() => applyLanguage('de'));
    }
  });
});
