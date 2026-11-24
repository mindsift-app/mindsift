import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ImportSummary } from '../../../lib/types';

const api = vi.hoisted(() => ({
  listMyBackups: vi.fn(),
  restoreMyBackup: vi.fn(),
  downloadMyBackup: vi.fn(),
}));
vi.mock('../../../lib/api', async () => (await import('../../../test/apiMock')).stubApi(api));

import { ServerBackupsCard } from '../ServerBackupsCard';

const restored: ImportSummary = {
  folders: 0, notes: 4, taskLists: 0, tasks: 2, lists: 0, listItems: 0, inbox: 0, themes: 0,
  skipped: [{ path: 'Alte Notiz', reason: 'kaputt' }], applied: true,
};

describe('ServerBackupsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listMyBackups.mockResolvedValue([{ name: 'b1.json.gz', size: 2048, createdAt: '2026-11-20T03:00:00Z' }]);
    api.restoreMyBackup.mockResolvedValue(restored);
  });

  it('replaces only after the warning is ticked and shows what came back', async () => {
    const onRestored = vi.fn();
    render(<ServerBackupsCard onRestored={onRestored} />);
    fireEvent.click(await screen.findByRole('button', { name: /Wiederherstellen/ }));

    const run = screen.getByRole('button', { name: 'Löschen und wiederherstellen' }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(run.disabled).toBe(false);
    fireEvent.click(run);

    expect(await screen.findByText('Backup wiederhergestellt')).toBeTruthy();
    expect(api.restoreMyBackup).toHaveBeenCalledWith('b1.json.gz', 'restore', ['notes', 'tasks', 'lists', 'inbox', 'themes']);
    expect(screen.getByText(/4 Notizen, 2 Aufgaben/)).toBeTruthy();
    expect(screen.getByText('Alte Notiz')).toBeTruthy();
    expect(onRestored).toHaveBeenCalled();
  });

  it('adds without a warning', async () => {
    render(<ServerBackupsCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Wiederherstellen/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Hinzufügen/ }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByText('Backup wiederhergestellt')).toBeTruthy();
    expect(api.restoreMyBackup).toHaveBeenCalledWith('b1.json.gz', 'merge', expect.any(Array));
  });
});
