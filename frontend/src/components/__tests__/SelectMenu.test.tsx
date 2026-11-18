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

  // The field keeps the width of its longest labels while choosing (layout itself is measured in the browser)
  const reserved = (button: HTMLElement) =>
    Array.from(button.querySelectorAll('[data-label]')).map((el) => el.getAttribute('data-label'));

  it('reserves the width of the longest labels, whichever option is chosen', () => {
    const quality = [
      { value: 'high', label: 'Hoch' },
      { value: 'off', label: 'Aus (Bilder unverändert hochladen)' },
    ];
    const { rerender } = render(<SelectMenu ariaLabel="Bildqualität" value="high" options={quality} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Bildqualität' });
    const before = reserved(button);
    expect(before).toEqual(['Hoch', 'Aus (Bilder unverändert hochladen)']);
    rerender(<SelectMenu ariaLabel="Bildqualität" value="off" options={quality} onChange={() => {}} />);
    expect(reserved(button)).toEqual(before);
    // The reserve is no text of the page; the chosen label is
    expect(button.textContent).toBe('Aus (Bilder unverändert hochladen)');
  });

  // The label that is shown (the reserve spans are aria-hidden)
  const shownLabel = (button: HTMLElement) => button.querySelector('span.grid > span:not([data-label])') as HTMLElement;
  const setWidths = (el: HTMLElement, scroll: number, client: number) => {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scroll });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: client });
  };

  it('shows the chosen label as tooltip only when it is cut short', () => {
    const quality = [
      { value: 'high', label: 'Hoch' },
      { value: 'off', label: 'Aus (Bilder unverändert hochladen)' },
    ];
    render(<SelectMenu ariaLabel="Bildqualität" value="off" options={quality} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Bildqualität' });
    // Room enough: no tooltip
    setWidths(shownLabel(button), 120, 120);
    fireEvent.pointerEnter(button);
    expect(button.getAttribute('title')).toBeNull();
    // Cut short (a narrow screen): the whole label on hover
    setWidths(shownLabel(button), 220, 120);
    fireEvent.pointerEnter(button);
    expect(button.getAttribute('title')).toBe('Aus (Bilder unverändert hochladen)');
    // Wide again: gone
    setWidths(shownLabel(button), 220, 220);
    fireEvent.pointerEnter(button);
    expect(button.getAttribute('title')).toBeNull();
  });

  it('keeps a title passed in, cut short or not', () => {
    render(<SelectMenu ariaLabel="Status" title="Status der Aufgabe" value="todo" options={options} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Status' });
    expect(button.getAttribute('title')).toBe('Status der Aufgabe');
    setWidths(shownLabel(button), 220, 120);
    fireEvent.pointerEnter(button);
    expect(button.getAttribute('title')).toBe('Status der Aufgabe');
  });

  it('reserves only a few of the longest labels in long lists, and none with fitLabel', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ value: `z${i}`, label: i === 30 ? 'America/Argentina/ComodRivadavia' : `Zone ${i}` }));
    const { unmount } = render(<SelectMenu ariaLabel="Zeitzone" value="z0" options={many} onChange={() => {}} />);
    const list = reserved(screen.getByRole('button', { name: 'Zeitzone' }));
    expect(list.length).toBeLessThanOrEqual(6);
    expect(list[0]).toBe('America/Argentina/ComodRivadavia');
    unmount();
    render(<SelectMenu ariaLabel="Sprache" fitLabel value="z0" options={many} onChange={() => {}} />);
    expect(reserved(screen.getByRole('button', { name: 'Sprache' }))).toEqual([]);
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
