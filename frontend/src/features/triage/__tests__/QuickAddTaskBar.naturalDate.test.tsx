import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const captureThought = vi.fn(async (content: string) => ({ id: 't1', content }));
vi.mock('../../../lib/api', async () =>
  (await import('../../../test/apiMock')).stubApi({
    captureThought: (...args: unknown[]) => captureThought(...(args as [string])),
    getAuthStatus: vi.fn(async () => ({ voice: { mode: 'off' } })),
  })
);

import { QuickAddTaskBar } from '../QuickAddTaskBar';
import { MobileTaskCreateSheet } from '../MobileTaskCreateSheet';

const renderBar = () =>
  render(
    <QuickAddTaskBar
      hidden={false}
      currentSelectedList={undefined}
      selectedListId="all"
      setTasks={() => {}}
      onRefreshStats={() => {}}
      loadData={async () => {}}
    />
  );

describe('dates typed into a new task', () => {
  beforeEach(() => {
    captureThought.mockClear();
    // Wednesday 18.11.2026, 10:00
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 10, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('task view: saves the recognised date and the title without it', async () => {
    renderBar();
    const box = screen.getByPlaceholderText('Neue Aufgabe anlegen…');
    fireEvent.change(box, { target: { value: 'Bericht am Freitag um 9' } });
    expect(screen.getByTestId('natural-date-chip').textContent).toContain('Fr., 20.11., 09:00');
    await act(async () => {
      fireEvent.submit(box.closest('form')!);
    });
    expect(captureThought).toHaveBeenCalledWith('Bericht', 'normal', 'manual', '2026-11-20T09:00', { target: 'task', taskListId: '' });
  });

  it('task view: the date field wins over the text', async () => {
    renderBar();
    const box = screen.getByPlaceholderText('Neue Aufgabe anlegen…');
    fireEvent.change(box, { target: { value: 'Bericht morgen' } });
    expect(screen.getByTestId('natural-date-chip')).toBeTruthy();
    const picker = screen.getByLabelText('Fälligkeitsdatum');
    fireEvent.change(picker, { target: { value: '01.12.2026' } });
    fireEvent.keyDown(picker, { key: 'Enter' });
    expect(screen.queryByTestId('natural-date-chip')).toBeNull();
    await act(async () => {
      fireEvent.submit(box.closest('form')!);
    });
    expect(captureThought).toHaveBeenCalledWith('Bericht morgen', 'normal', 'manual', '2026-12-01', expect.anything());
  });

  it('phone sheet: × keeps the text, otherwise the date is taken', async () => {
    const onCreate = vi.fn(async () => true);
    render(<MobileTaskCreateSheet open onClose={() => {}} lists={[]} listId="" onListIdChange={() => {}} onCreate={onCreate} />);
    const box = screen.getByPlaceholderText(/Was ist zu tun/);
    fireEvent.change(box, { target: { value: 'Reifen in 3 Tagen' } });
    expect(screen.getByTestId('natural-date-chip').textContent).toContain('Sa., 21.11.');
    await act(async () => {
      fireEvent.submit(box.closest('form')!);
    });
    expect(onCreate).toHaveBeenLastCalledWith({ title: 'Reifen', priority: 'normal', dueDate: '2026-11-21', listId: '' });

    fireEvent.change(box, { target: { value: 'Reifen in 3 Tagen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Datum nicht übernehmen' }));
    await act(async () => {
      fireEvent.submit(box.closest('form')!);
    });
    expect(onCreate).toHaveBeenLastCalledWith({ title: 'Reifen in 3 Tagen', priority: 'normal', dueDate: '', listId: '' });
  });
});
