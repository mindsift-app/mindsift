import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SnapshotAccount, SnapshotTakeOver } from '../../../lib/types';

const api = vi.hoisted(() => ({
  adminStageServerSnapshot: vi.fn(),
  adminTakeOverSnapshotAccount: vi.fn(),
  adminDiscardServerSnapshot: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({ api, isDesktopApp: () => true }));

import { ServerSnapshotCard } from '../ServerSnapshotCard';

const anna: SnapshotAccount = { id: 'usr_anna', displayName: 'Anna', username: 'anna', email: 'anna@example.com', role: 'admin', isActive: true, notes: 12, tasks: 3, lists: 1, inbox: 2 };
const ben: SnapshotAccount = { id: 'usr_ben', displayName: 'Ben', username: 'ben', email: '', role: 'member', isActive: true, notes: 1, tasks: 0, lists: 0, inbox: 0 };
const summary = (applied: boolean): SnapshotTakeOver => ({
  folders: 0, notes: 12, taskLists: 1, tasks: 3, lists: 1, listItems: 4, inbox: 2, themes: 0,
  skipped: [{ path: 'Bens Notiz', reason: 'geteilte Notiz eines anderen Benutzers' }],
  applied, account: anna, settings: true,
});

describe('ServerSnapshotCard (desktop: take over an account of a server backup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.adminStageServerSnapshot.mockResolvedValue({ token: 'tok', accounts: [anna, ben] });
    api.adminTakeOverSnapshotAccount.mockImplementation((_t: string, _a: string, o: { preview: boolean }) => Promise.resolve(summary(!o.preview)));
    api.adminDiscardServerSnapshot.mockResolvedValue(undefined);
  });

  it('lists the accounts with counts, previews the chosen one and takes it over after the confirmation', async () => {
    const { container } = render(<ServerSnapshotCard />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'mindsift-db-2026-11-20-030000.db.gz')] } });

    const annaCard = await screen.findByRole('radio', { name: /Anna/ });
    expect(annaCard.textContent).toContain('12 Notizen · 3 Aufgaben · 1 Liste · 2 Gedanken');
    expect(screen.getByRole('radio', { name: /Ben/ })).toBeTruthy();
    expect(api.adminTakeOverSnapshotAccount).not.toHaveBeenCalled();

    fireEvent.click(annaCard);
    await screen.findByText('Vorschau: Anna');
    expect(api.adminTakeOverSnapshotAccount).toHaveBeenCalledWith('tok', 'usr_anna', expect.objectContaining({ preview: true, settings: true }));
    expect(screen.getByText('1 übersprungen')).toBeTruthy();

    const replace = screen.getByRole('button', { name: 'Ersetzen und übernehmen' }) as HTMLButtonElement;
    expect(replace.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(replace);
    await screen.findByText('Anna übernommen');
    expect(api.adminTakeOverSnapshotAccount).toHaveBeenLastCalledWith('tok', 'usr_anna', expect.objectContaining({ preview: false, mode: 'restore' }));
    expect(screen.getByRole('button', { name: 'App neu laden' })).toBeTruthy();
  });

  it('keeps the local settings when switched off and discards the snapshot on cancel', async () => {
    const { container } = render(<ServerSnapshotCard />);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'a.db.gz')] } });
    fireEvent.click(await screen.findByRole('radio', { name: /Ben/ }));
    await screen.findByText('Vorschau: Anna');
    fireEvent.click(screen.getByRole('switch', { name: 'Persönliche Einstellungen übernehmen' }));
    await waitFor(() =>
      expect(api.adminTakeOverSnapshotAccount).toHaveBeenLastCalledWith('tok', 'usr_ben', expect.objectContaining({ preview: true, settings: false }))
    );
    await screen.findByText('Vorschau: Anna');
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(api.adminDiscardServerSnapshot).toHaveBeenCalledWith('tok');
    expect(screen.queryByRole('radio', { name: /Ben/ })).toBeNull();
  });

  it('shows why a file was refused', async () => {
    api.adminStageServerSnapshot.mockRejectedValue(new Error('Die Datei ist kein Datenbank-Abzug von MindSift'));
    const { container } = render(<ServerSnapshotCard />);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'notes.txt')] } });
    await screen.findByText('Die Datei ist kein Datenbank-Abzug von MindSift');
  });
});
