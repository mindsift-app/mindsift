import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateField } from '../DateField';
import { TimeField } from '../TimeField';

describe('DateField (calendar with a mouse)', () => {
  it('shows the day in German and takes a typed one', () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="Fällig" value="2026-11-24" onChange={onChange} />);
    const input = screen.getByLabelText('Fällig') as HTMLInputElement;
    expect(input.value).toBe('24.11.2026');
    fireEvent.change(input, { target: { value: '1.12.2026' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('2026-12-01');
  });

  it('puts back the day when the typing is no date', () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="Fällig" value="2026-11-24" onChange={onChange} />);
    const input = screen.getByLabelText('Fällig') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '45.45.' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('24.11.2026');
  });

  it('opens the calendar at the chosen month and picks a day', () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="Fällig" value="2026-11-24" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Fällig'));
    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(screen.getByRole('gridcell', { selected: true }).textContent).toBe('24');
    fireEvent.click(screen.getByRole('gridcell', { name: /25\. November 2026/ }));
    expect(onChange).toHaveBeenCalledWith('2026-11-25');
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('weeks start on Monday in German and the arrows move the day', () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="Fällig" value="2026-11-24" onChange={onChange} />);
    const input = screen.getByLabelText('Fällig');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('columnheader')[0].textContent).toBe('Mo');
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2026-12-02');
  });

  it('switches to months and back', () => {
    render(<DateField ariaLabel="Fällig" value="2026-11-24" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Fällig'));
    fireEvent.click(screen.getByText('November 2026'));
    fireEvent.click(screen.getByText('Mär'));
    expect(screen.getByText('März 2026')).toBeTruthy();
  });

  it('empties with the ×', () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="Fällig" value="2026-11-24" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Datum entfernen'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('TimeField (list of times with a mouse)', () => {
  it('takes a typed time and steps with the arrows', () => {
    const onChange = vi.fn();
    render(<TimeField ariaLabel="Uhrzeit" value="14:30" onChange={onChange} />);
    const input = screen.getByLabelText('Uhrzeit') as HTMLInputElement;
    expect(input.value).toBe('14:30');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('14:45');
    fireEvent.change(input, { target: { value: '930' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('09:30');
  });

  it('picks from the list in 15-minute steps', () => {
    const onChange = vi.fn();
    render(<TimeField ariaLabel="Uhrzeit" value="14:30" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Uhrzeit'));
    expect(screen.getAllByRole('option')).toHaveLength(96);
    expect(screen.getByRole('option', { selected: true }).textContent).toBe('14:30');
    fireEvent.click(screen.getByRole('option', { name: '08:15' }));
    expect(onChange).toHaveBeenCalledWith('08:15');
  });
});
