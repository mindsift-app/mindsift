import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListSwitcher } from '../ListSwitcher';

const items = [
  { id: 'a', title: 'Haushalt', icon: '🏠', count: 3 },
  { id: 'b', title: 'Arbeit' },
];

describe('ListSwitcher', () => {
  it('opens all lists on a tap and switches to the chosen one', () => {
    const onSelect = vi.fn();
    render(<ListSwitcher label="🏠 Haushalt" items={items} activeId="a" onSelect={onSelect} />);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Haushalt/ }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('option', { name: /Arbeit/ }));
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes without a change on the open list, Escape or a tap outside', () => {
    const onSelect = vi.fn();
    render(<ListSwitcher label="🏠 Haushalt" items={items} activeId="a" onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: /Haushalt/ });

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('option', { name: /Haushalt/ }));
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
