import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManageColumnsModal } from '../ManageColumnsModal';
import { KanbanColumn } from '../../../lib/types';

const columns: KanbanColumn[] = [
  { id: 'todo', name: 'Zu erledigen' },
  { id: 'done', name: 'Erledigt', isDone: true },
];

describe('ManageColumnsModal', () => {
  // Task lists are loaded again while the dialog is open (another device, a return to the tab): a new
  // array with the same columns must not throw away a renamed column
  it('keeps edits when the columns are loaded again while it is open', async () => {
    const onSave = vi.fn(async () => {});
    const view = (initial: KanbanColumn[]) => (
      <ManageColumnsModal isOpen onClose={() => {}} initialColumns={initial} onSave={onSave} listTitle="Haushalt" />
    );
    const { rerender } = render(view(columns));
    fireEvent.change(screen.getByDisplayValue('Zu erledigen'), { target: { value: 'Offen' } });

    rerender(view(columns.map((c) => ({ ...c }))));
    expect(screen.getByDisplayValue('Offen')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Spalten speichern' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      { id: 'todo', name: 'Offen' },
      { id: 'done', name: 'Erledigt', isDone: true },
    ]);
  });

  it('starts from the list columns each time it opens', () => {
    const view = (open: boolean, initial: KanbanColumn[]) => (
      <ManageColumnsModal isOpen={open} onClose={() => {}} initialColumns={initial} onSave={async () => {}} listTitle="Haushalt" />
    );
    const { rerender } = render(view(true, columns));
    fireEvent.change(screen.getByDisplayValue('Zu erledigen'), { target: { value: 'Verworfen' } });
    rerender(view(false, columns));
    rerender(view(true, columns));
    expect(screen.getByDisplayValue('Zu erledigen')).toBeTruthy();
    expect(screen.queryByDisplayValue('Verworfen')).toBeNull();
  });

  it('the colour menu: its dot toggles it, a press outside and Escape close it', () => {
    render(<ManageColumnsModal isOpen onClose={() => {}} initialColumns={columns} onSave={async () => {}} listTitle="Haushalt" />);
    const dot = screen.getByRole('button', { name: 'Farbe der Spalte Zu erledigen' });
    const press = (el: Element) => {
      fireEvent.pointerDown(el);
      fireEvent.click(el);
    };
    press(dot);
    expect(dot.getAttribute('aria-expanded')).toBe('true');
    press(dot);
    expect(dot.getAttribute('aria-expanded')).toBe('false');

    press(dot);
    // The other column's dot moves the menu there
    const other = screen.getByRole('button', { name: 'Farbe der Spalte Erledigt' });
    press(other);
    expect(dot.getAttribute('aria-expanded')).toBe('false');
    expect(other.getAttribute('aria-expanded')).toBe('true');

    fireEvent.pointerDown(document.body);
    expect(other.getAttribute('aria-expanded')).toBe('false');
    press(other);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(other.getAttribute('aria-expanded')).toBe('false');
  });
});
