import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const lists = [{ id: 'lst_1', title: 'Wocheneinkauf', icon: '🛒', isOwner: true, listType: 'shopping', items: [] }] as any;

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

  it('takes the focus on a bare "c", not on Ctrl/Cmd+C (that copies)', async () => {
    await act(async () => {
      render(<InstantCaptureBar onCaptured={() => {}} lists={lists} />);
    });
    const input = screen.getByPlaceholderText(/Quick Dump/);
    input.blur();
    const ctrlC = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ctrlC);
    expect(document.activeElement).not.toBe(input);
    expect(ctrlC.defaultPrevented).toBe(false);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(document.activeElement).toBe(input);
  });
});
