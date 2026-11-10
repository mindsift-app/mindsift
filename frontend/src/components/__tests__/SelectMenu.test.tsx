import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SelectMenu, MultiSelectMenu } from '../SelectMenu';

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

  it('jumps to an option when its first letters are typed', () => {
    const onChange = vi.fn();
    render(<SelectMenu ariaLabel="Status" value="todo" options={options} onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Status' });
    fireEvent.keyDown(button, { key: 'e' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('done');
  });

  it('skips disabled options and shows their hint', () => {
    const onChange = vi.fn();
    const withDisabled = [options[0], { ...options[1], disabled: true, hint: 'Nicht erlaubt' }, options[2]];
    render(<SelectMenu ariaLabel="Status" value="todo" options={withDisabled} onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Status' });
    fireEvent.click(button);
    expect(screen.getByText('Nicht erlaubt')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /In Bearbeitung/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('done');
  });

  it('filters long lists with a search field', () => {
    const onChange = vi.fn();
    const many = Array.from({ length: 20 }, (_, i) => ({ value: `l${i}`, label: i === 7 ? 'TypeScript' : `Sprache ${i}` }));
    render(<SelectMenu ariaLabel="Sprache" value="l0" options={many} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sprache' }));
    const search = screen.getByLabelText('Suchen …');
    fireEvent.change(search, { target: { value: 'type' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('l7');
  });

  it('ticks several options and stays open', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MultiSelectMenu ariaLabel="Erinnerung" values={['todo']} options={options} onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Erinnerung' });
    expect(button.textContent).toContain('Zu erledigen');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('option', { name: /Erledigt/ }));
    expect(onChange).toHaveBeenCalledWith(['todo', 'done']);
    expect(screen.getByRole('listbox')).toBeTruthy();
    rerender(<MultiSelectMenu ariaLabel="Erinnerung" values={['todo', 'done']} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('option', { name: /Zu erledigen/ }));
    expect(onChange).toHaveBeenLastCalledWith(['done']);
  });
});
