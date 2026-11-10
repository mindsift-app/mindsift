import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SelectMenu } from '../SelectMenu';

const options = [
  { value: 'todo', label: 'Zu erledigen' },
  { value: 'in_progress', label: 'In Bearbeitung' },
  { value: 'done', label: 'Erledigt' },
];

describe('SelectMenu (dropdown in the app look)', () => {
  it('shows the chosen option and opens the list on a click', () => {
    render(<SelectMenu ariaLabel="Status" value="in_progress" options={options} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Status' });
    expect(button.textContent).toContain('In Bearbeitung');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(button);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('In Bearbeitung');
  });

  it('picks an option with a click and closes', () => {
    const onChange = vi.fn();
    render(<SelectMenu ariaLabel="Status" value="todo" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    fireEvent.click(screen.getByRole('option', { name: 'Erledigt' }));
    expect(onChange).toHaveBeenCalledWith('done');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('works with the keyboard, and Escape closes only the list', () => {
    const onChange = vi.fn();
    render(<SelectMenu ariaLabel="Status" value="todo" options={options} onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Status' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('in_progress');
  });

  it('does not report the option that is already chosen', () => {
    const onChange = vi.fn();
    render(<SelectMenu ariaLabel="Status" value="todo" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    fireEvent.click(screen.getByRole('option', { name: 'Zu erledigen' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
