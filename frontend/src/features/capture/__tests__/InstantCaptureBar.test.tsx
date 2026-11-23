import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const captureThought = vi.fn(async (content: string) => ({ id: 't1', content }));
vi.mock('../../../lib/api', () => ({
  api: {
    getTaskLists: vi.fn(async () => [
      { id: 'tkl_1', title: 'Homelab', icon: '🖥️', permission: 'owner' },
      { id: 'tkl_2', title: 'Fremd', icon: '🔒', permission: 'viewer' },
    ]),
    captureThought: (...args: unknown[]) => captureThought(...(args as [string])),
    getAuthStatus: vi.fn(async () => ({ voice: { mode: 'off' } })),
  },
  triggerHaptic: vi.fn(),
}));

import { InstantCaptureBar } from '../InstantCaptureBar';
import type { SharedList } from '../../../lib/types';

const lists: SharedList[] = [{ id: 'lst_1', title: 'Wocheneinkauf', icon: '🛒', isOwner: true, listType: 'shopping', items: [], createdAt: '', updatedAt: '' }];

describe('InstantCaptureBar', () => {
  beforeEach(() => {
    captureThought.mockClear();
    sessionStorage.clear();
  });

  it('shows the list row that fits the target and saves into the chosen task list on send', async () => {
    await act(async () => {
      render(<InstantCaptureBar onCaptured={() => {}} lists={lists} defaultShowOptions />);
    });
    // Quick Dump: no list row
    expect(screen.queryByText('Wocheneinkauf')).toBeNull();
    expect(screen.queryByText('Homelab')).toBeNull();

    const box = screen.getByPlaceholderText('Quick Dump…');
    fireEvent.change(box, { target: { value: 'Backup prüfen' } });
    fireEvent.click(screen.getByRole('button', { name: /Direkt als Aufgabe/ }));
    // With task lists, choosing the target does not save yet; read-only lists are not offered
    expect(captureThought).not.toHaveBeenCalled();
    expect(screen.queryByText('Wocheneinkauf')).toBeNull();
    expect(screen.queryByText('Fremd')).toBeNull();
    // Picking the list only selects it as well; saving takes the send button (or Enter)
    fireEvent.click(screen.getByRole('button', { name: /Homelab/ }));
    expect(captureThought).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.submit(box.closest('form')!);
    });
    expect(captureThought).toHaveBeenCalledWith('Backup prüfen', 'normal', 'manual', '', {
      target: 'task',
      targetListId: '',
      taskListId: 'tkl_1',
    });
  });

  it('offers the shopping lists for a list item', async () => {
    await act(async () => {
      render(<InstantCaptureBar onCaptured={() => {}} lists={lists} defaultShowOptions />);
    });
    fireEvent.click(screen.getByRole('button', { name: /Direkt auf Liste/ }));
    // The list chip (the target pill shows the chosen list as well)
    expect(screen.getAllByRole('button', { name: /Wocheneinkauf/ }).length).toBe(2);
    expect(screen.queryByText('Homelab')).toBeNull();
  });

  it('closes the options on the first Escape and empties the field only on the next', async () => {
    await act(async () => {
      render(<InstantCaptureBar onCaptured={() => {}} lists={lists} />);
    });
    const box = screen.getByPlaceholderText('Quick Dump…') as HTMLTextAreaElement;
    await act(async () => {
      box.focus();
    });
    fireEvent.change(box, { target: { value: 'Backup prüfen' } });
    // The options open from the button; the focus stays in the field
    fireEvent.click(screen.getByTitle(/Ziel wählen/));
    expect(screen.getByRole('button', { name: /Direkt auf Liste/ })).toBeTruthy();

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /Direkt auf Liste/ })).toBeNull();
    expect(box.value).toBe('Backup prüfen');
    expect(document.activeElement).toBe(box);

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
    expect(document.activeElement).not.toBe(box);
  });

  describe('dates in the text', () => {
    beforeEach(() => {
      // Wednesday 18.11.2026, 10:00
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 10, 18, 10, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('shows the recognised date as a chip and saves it without the phrase', async () => {
      await act(async () => {
        render(<InstantCaptureBar onCaptured={() => {}} lists={lists} />);
      });
      const box = screen.getByPlaceholderText('Quick Dump…');
      fireEvent.change(box, { target: { value: 'Zahnarzt morgen 14 Uhr' } });
      expect(screen.getByTestId('natural-date-chip').textContent).toContain('Morgen, 14:00');
      expect(screen.getByTestId('natural-date-mark').textContent).toBe('morgen 14 Uhr');
      await act(async () => {
        fireEvent.submit(box.closest('form')!);
      });
      expect(captureThought).toHaveBeenCalledWith('Zahnarzt', 'normal', 'manual', '2026-11-19T14:00', {
        target: 'inbox',
        targetListId: '',
        taskListId: '',
      });
      expect(screen.queryByTestId('natural-date-chip')).toBeNull();
    });

    it('keeps the text as typed and sets no date after the ×', async () => {
      await act(async () => {
        render(<InstantCaptureBar onCaptured={() => {}} lists={lists} />);
      });
      const box = screen.getByPlaceholderText('Quick Dump…');
      fireEvent.change(box, { target: { value: 'Zahnarzt morgen 14 Uhr' } });
      fireEvent.click(screen.getByRole('button', { name: 'Datum nicht übernehmen' }));
      expect(screen.queryByTestId('natural-date-chip')).toBeNull();
      expect(screen.queryByTestId('natural-date-mark')).toBeNull();
      // Typing on leaves the phrase dismissed; another phrase brings the chip back
      fireEvent.change(box, { target: { value: 'Zahnarzt morgen 14 Uhr!' } });
      expect(screen.queryByTestId('natural-date-chip')).toBeNull();
      await act(async () => {
        fireEvent.submit(box.closest('form')!);
      });
      expect(captureThought).toHaveBeenCalledWith('Zahnarzt morgen 14 Uhr!', 'normal', 'manual', '', expect.anything());
      fireEvent.change(box, { target: { value: 'Zahnarzt Freitag' } });
      expect(screen.getByTestId('natural-date-chip').textContent).toContain('Fr., 20.11.');
    });

    it('reads no date for list items, and a picked date wins', async () => {
      await act(async () => {
        render(<InstantCaptureBar onCaptured={() => {}} lists={lists} defaultShowOptions />);
      });
      const box = screen.getByPlaceholderText('Quick Dump…');
      fireEvent.change(box, { target: { value: 'Milch morgen' } });
      expect(screen.getByTestId('natural-date-chip')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Direkt auf Liste/ }));
      expect(screen.queryByTestId('natural-date-chip')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Quick Dump \(Triage\)/ }));
      expect(screen.getByTestId('natural-date-chip')).toBeTruthy();
      const picker = screen.getByLabelText('Fällig am:');
      fireEvent.change(picker, { target: { value: '01.12.2026' } });
      fireEvent.keyDown(picker, { key: 'Enter' });
      expect(screen.queryByTestId('natural-date-chip')).toBeNull();
      await act(async () => {
        fireEvent.submit(box.closest('form')!);
      });
      expect(captureThought).toHaveBeenCalledWith('Milch morgen', 'normal', 'manual', '2026-12-01', expect.anything());
    });
  });
});
