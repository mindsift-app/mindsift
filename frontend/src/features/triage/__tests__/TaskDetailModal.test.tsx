import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskDetailModal } from '../TaskDetailModal';
import { api } from '../../../lib/api';
import { Thought } from '../../../lib/types';

const task: Thought = {
  id: 'th_1',
  userId: 'usr_1',
  content: 'Fenster putzen',
  tags: [],
  priority: 'normal',
  source: 'manual',
  status: 'converted',
  isCompleted: false,
  kanbanStatus: 'todo',
  dueDate: '2026-10-30T14:30',
  createdAt: '2026-10-29T08:00:00Z',
};
const columns = [
  { id: 'todo', name: 'Zu erledigen' },
  { id: 'done', name: 'Erledigt', isDone: true },
];
const noop = vi.fn(async () => {});

const props = (over: Partial<React.ComponentProps<typeof TaskDetailModal>> = {}) => ({
  task,
  isOpen: true,
  onClose: vi.fn(),
  activeColumns: columns,
  taskLists: [],
  onUpdateTitle: noop,
  onUpdateStatus: noop,
  onUpdatePriority: noop,
  onUpdateDueDate: vi.fn(async () => {}),
  onUpdateTaskList: noop,
  onUpdateNotes: noop,
  onToggleSubtask: noop,
  onAddSubtask: noop,
  onDeleteSubtask: noop,
  onConvertToDoc: vi.fn(),
  onDeleteTask: vi.fn(),
  ...over,
});

describe('TaskDetailModal', () => {
  it('opens and closes without breaking the hook order', () => {
    const { rerender, container } = render(<TaskDetailModal {...props({ isOpen: false })} />);
    expect(container.firstChild).toBeNull();
    rerender(<TaskDetailModal {...props()} />);
    expect(screen.getByText('Aufgabe bearbeiten')).toBeTruthy();
    rerender(<TaskDetailModal {...props({ isOpen: false })} />);
    rerender(<TaskDetailModal {...props()} />);
    expect(screen.getByText('Aufgabe bearbeiten')).toBeTruthy();
  });

  it('shows date and time separately and removes only the time', () => {
    const onUpdateDueDate = vi.fn(async () => {});
    render(<TaskDetailModal {...props({ onUpdateDueDate })} />);
    expect((screen.getByLabelText('Fälligkeitsdatum') as HTMLInputElement).value).toBe('30.10.2026');
    expect((screen.getByLabelText('Uhrzeit (optional)') as HTMLInputElement).value).toBe('14:30');
    fireEvent.click(screen.getByTitle(/Uhrzeit entfernen/));
    expect(onUpdateDueDate).toHaveBeenCalledWith(task, '2026-10-30');
  });

  it('moves subtasks with the arrow keys on their handle', () => {
    const onReorderSubtasks = vi.fn(async () => {});
    const withSubs = {
      ...task,
      subtasks: [
        { id: 's1', title: 'Leiter holen', isCompleted: false },
        { id: 's2', title: 'Eimer füllen', isCompleted: false },
      ],
    };
    render(<TaskDetailModal {...props({ task: withSubs, onReorderSubtasks })} />);
    fireEvent.keyDown(screen.getByLabelText('„Leiter holen“ verschieben'), { key: 'ArrowDown' });
    expect(onReorderSubtasks).toHaveBeenCalledWith(withSubs, ['s2', 's1']);
    // The first one cannot move further up
    fireEvent.keyDown(screen.getByLabelText('„Leiter holen“ verschieben'), { key: 'ArrowUp' });
    expect(onReorderSubtasks).toHaveBeenCalledTimes(1);
  });

  it('has no subtask handles when read-only or with a single subtask', () => {
    const one = { ...task, subtasks: [{ id: 's1', title: 'Leiter holen', isCompleted: false }] };
    const { rerender } = render(<TaskDetailModal {...props({ task: one, onReorderSubtasks: noop })} />);
    expect(screen.queryByLabelText('„Leiter holen“ verschieben')).toBeNull();
    const two = { ...one, subtasks: [...one.subtasks, { id: 's2', title: 'Eimer füllen', isCompleted: false }] };
    rerender(<TaskDetailModal {...props({ task: two, onReorderSubtasks: noop, readOnly: true })} />);
    expect(screen.queryByLabelText('„Leiter holen“ verschieben')).toBeNull();
  });

  it('opens a new task (draft) with its title ready to be typed over', () => {
    render(<TaskDetailModal {...props({ editTitleOnOpen: true })} />);
    expect(screen.getByText('Neue Aufgabe')).toBeTruthy();
    expect((screen.getByDisplayValue('Fenster putzen') as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
  });

  it('is view-only for tasks in lists shared with viewer rights', () => {
    render(<TaskDetailModal {...props({ readOnly: true })} />);
    expect(screen.getByText('Aufgabe ansehen')).toBeTruthy();
    expect((screen.getByLabelText('Fälligkeitsdatum') as HTMLInputElement).closest('fieldset')?.disabled).toBe(true);
  });

  it('toggles watching a task via POST and DELETE /tasks/{id}/watch', async () => {
    const watchSpy = vi.spyOn(api, 'watchTask').mockResolvedValue({ watching: true });
    const unwatchSpy = vi.spyOn(api, 'unwatchTask').mockResolvedValue({ watching: false });

    render(<TaskDetailModal {...props({ task: { ...task, isWatching: false } })} />);
    const btn = screen.getByRole('button', { name: 'Beobachten' });
    fireEvent.click(btn);

    await waitFor(() => expect(watchSpy).toHaveBeenCalledWith('th_1'));
    expect(screen.getByRole('button', { name: 'Nicht mehr beobachten' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Nicht mehr beobachten' }));
    await waitFor(() => expect(unwatchSpy).toHaveBeenCalledWith('th_1'));
    expect(screen.getByRole('button', { name: 'Beobachten' })).toBeTruthy();
  });

  it('hands the new watch state to the parent instead of changing the task it was given', async () => {
    vi.spyOn(api, 'watchTask').mockResolvedValue({ watching: true });
    const onTaskChange = vi.fn();
    const given = { ...task, isWatching: false };
    render(<TaskDetailModal {...props({ task: given, onTaskChange })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Beobachten' }));
    await waitFor(() => expect(onTaskChange).toHaveBeenCalledWith('th_1', { isWatching: true }));
    expect(given.isWatching).toBe(false);
  });

  it('keeps the notes being typed when the task is followed meanwhile', async () => {
    vi.spyOn(api, 'watchTask').mockResolvedValue({ watching: true });
    render(<TaskDetailModal {...props({ task: { ...task, isWatching: false } })} />);
    fireEvent.click(screen.getByText('Detailnotiz hinzufügen…'));
    fireEvent.change(screen.getByPlaceholderText(/Detailnotizen eingeben/), { target: { value: 'Leiter holen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Beobachten' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nicht mehr beobachten' })).toBeTruthy());
    expect((screen.getByPlaceholderText(/Detailnotizen eingeben/) as HTMLTextAreaElement).value).toBe('Leiter holen');
  });

  it('starts editing the title with the title as it is now', () => {
    const { rerender } = render(<TaskDetailModal {...props()} />);
    // Renamed on another device while the dialog is open
    rerender(<TaskDetailModal {...props({ task: { ...task, content: 'Fenster putzen lassen' } })} />);
    fireEvent.click(screen.getByTitle('Klicken zum Bearbeiten des Titels'));
    expect((screen.getByDisplayValue('Fenster putzen lassen') as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
  });

  it('asks before closing with unsaved notes and saves on request', async () => {
    const onClose = vi.fn();
    const onUpdateNotes = vi.fn(async () => {});
    render(<TaskDetailModal {...props({ onClose, onUpdateNotes })} />);
    fireEvent.click(screen.getByText('Detailnotiz hinzufügen…'));
    fireEvent.change(screen.getByPlaceholderText(/Detailnotizen eingeben/), { target: { value: 'Leiter holen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Ungespeicherte Änderungen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onUpdateNotes).toHaveBeenCalledWith(expect.objectContaining({ id: 'th_1' }), 'Leiter holen');
  });

  it('closes right away without changes, and drops them on "Verwerfen"', () => {
    const onClose = vi.fn();
    const onUpdateNotes = vi.fn(async () => {});
    const { unmount } = render(<TaskDetailModal {...props({ onClose, onUpdateNotes })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    render(<TaskDetailModal {...props({ onClose, onUpdateNotes })} />);
    fireEvent.click(screen.getByText('Detailnotiz hinzufügen…'));
    fireEvent.change(screen.getByPlaceholderText(/Detailnotizen eingeben/), { target: { value: 'x' } });
    fireEvent.click(screen.getByTitle('Schließen'));
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onUpdateNotes).not.toHaveBeenCalled();
  });

  it('picks own reminders; "Standard" with the lead time from the settings stands for none', () => {
    const onUpdateReminders = vi.fn(async () => {});
    const { rerender } = render(<TaskDetailModal {...props({ onUpdateReminders, leadMinutes: 1440 })} />);
    const field = screen.getByRole('button', { name: 'Erinnerung' });
    expect(field.textContent).toContain('Standard (1 Tag vorher)');
    fireEvent.click(field);
    fireEvent.click(screen.getByRole('option', { name: /2 Wochen vorher/ }));
    expect(onUpdateReminders).toHaveBeenLastCalledWith(task, [20160]);

    const withReminders = { ...task, reminders: [20160, 0] };
    rerender(<TaskDetailModal {...props({ onUpdateReminders, leadMinutes: 1440, task: withReminders })} />);
    expect(screen.getByRole('button', { name: 'Erinnerung' }).textContent).toContain('2 Wochen vorher, Zum Fälligkeitszeitpunkt');
    fireEvent.click(screen.getByRole('option', { name: /Standard/ }));
    expect(onUpdateReminders).toHaveBeenLastCalledWith(withReminders, []);
  });

  it('offers only whole days for a task without a time', () => {
    render(<TaskDetailModal {...props({ onUpdateReminders: vi.fn(async () => {}), task: { ...task, dueDate: '2026-10-30' } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Erinnerung' }));
    expect(screen.queryByRole('option', { name: /Std\. vorher/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Am Fälligkeitstag \(9 Uhr\)/ })).toBeTruthy();
  });
});
