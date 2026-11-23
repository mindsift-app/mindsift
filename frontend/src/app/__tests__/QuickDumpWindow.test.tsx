import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../lib/api', async () =>
  (await import('../../test/apiMock')).stubApi({
    getTaskLists: vi.fn(async () => []),
    captureThought: vi.fn(),
    getAuthStatus: vi.fn(async () => ({ voice: { mode: 'off' } })),
  })
);

import { QuickDumpWindow } from '../QuickDumpWindow';

describe('QuickDumpWindow: Escape', () => {
  it('closes the options first, then empties the field and closes the window', async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(<QuickDumpWindow open onClose={onClose} onCaptured={() => {}} lists={[]} focusTrigger={1} />);
    });
    const box = screen.getByPlaceholderText('Quick Dump…') as HTMLTextAreaElement;
    // The window takes the focus on opening
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'Backup prüfen' } });
    fireEvent.click(screen.getByTitle(/Ziel wählen/));
    expect(screen.getByRole('button', { name: /Direkt auf Liste/ })).toBeTruthy();

    // 1. the options
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /Direkt auf Liste/ })).toBeNull();
    expect(box.value).toBe('Backup prüfen');
    expect(onClose).not.toHaveBeenCalled();

    // 2. the window, and the text in the field goes with it
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(box.value).toBe('');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('empties the field and closes at once without options', async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(<QuickDumpWindow open onClose={onClose} onCaptured={() => {}} lists={[]} focusTrigger={1} />);
    });
    fireEvent.change(screen.getByPlaceholderText('Quick Dump…'), { target: { value: 'Backup prüfen' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect((screen.getByPlaceholderText('Quick Dump…') as HTMLTextAreaElement).value).toBe('');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes at once with an empty field', async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(<QuickDumpWindow open onClose={onClose} onCaptured={() => {}} lists={[]} focusTrigger={1} />);
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
