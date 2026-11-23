import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { BackupFile, SystemSettings } from '../../../lib/types';
import { setCapabilities } from '../../../lib/capabilities';
import { ApiError } from '../../../lib/api/client';

const api = vi.hoisted(() => ({
  adminListBackups: vi.fn(),
  adminDeletedBackups: vi.fn(),
  adminGetBackupLocation: vi.fn(),
  adminRestoreBackup: vi.fn(),
  adminBackupDownloadUrl: vi.fn(),
  adminRestoreUpload: vi.fn(),
  adminDiscardUpload: vi.fn(),
  serverBoot: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({ api, isDesktopApp: () => false }));
const askConfirm = vi.hoisted(() => vi.fn());
vi.mock('../../../components/askConfirm', () => ({ askConfirm }));
const reopen = vi.hoisted(() => ({ waitForReopen: vi.fn() }));
vi.mock('../../../lib/restoreReload', () => reopen);
const upload = vi.hoisted(() => ({ uploadBackup: vi.fn(), forgetUpload: vi.fn() }));
vi.mock('../../../lib/backupUpload', () => upload);

import { BackupAdminCard } from '../BackupAdminCard';

const settings = { backupEnabled: true, backupTime: '03:00', backupRetentionDays: 3 } as SystemSettings;
const files: BackupFile[] = [
  { name: 'mindsift-full-2026-11-22-030000', size: 5 * 1024 * 1024, createdAt: '2026-11-22T02:00:00Z', full: true, media: 2 },
  { name: 'mindsift-full-2026-11-21-120000', size: 4 * 1024 * 1024, createdAt: '2026-11-21T11:00:00Z', full: true, media: 1, reason: 'pre-restore' },
  { name: 'mindsift-db-2026-11-20-030000.db.gz', size: 2048, createdAt: '2026-11-20T02:00:00Z' },
];

describe('BackupAdminCard: full backups, restore and upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.adminListBackups.mockResolvedValue(files);
    api.adminDeletedBackups.mockResolvedValue([]);
    api.serverBoot.mockResolvedValue('boot1');
    api.adminRestoreBackup.mockResolvedValue({ restarting: true, preRestoreBackup: 'mindsift-full-2026-11-22-120000' });
    setCapabilities({ restore: true });
  });

  it('shows what each backup holds and restores one after the confirmation', async () => {
    render(<BackupAdminCard settings={settings} onSave={vi.fn()} />);
    expect(await screen.findByText(/Komplett mit 2 Mediendateien/)).toBeTruthy();
    expect(screen.getByText(/Komplett mit 1 Mediendatei · vor einer Wiederherstellung/)).toBeTruthy();
    expect(screen.getByText(/Nur Datenbank/)).toBeTruthy();

    // Cancelled: nothing happens
    askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByLabelText('Backup mindsift-full-2026-11-22-030000 wiederherstellen'));
    await waitFor(() => expect(askConfirm).toHaveBeenCalledTimes(1));
    expect(askConfirm.mock.calls[0][0]).toMatchObject({ danger: true, confirmLabel: 'Wiederherstellen' });
    expect(api.adminRestoreBackup).not.toHaveBeenCalled();

    askConfirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByLabelText('Backup mindsift-full-2026-11-22-030000 wiederherstellen'));
    await waitFor(() => expect(api.adminRestoreBackup).toHaveBeenCalledWith('mindsift-full-2026-11-22-030000', false));
    expect(await screen.findByText('Wird wiederhergestellt … MindSift lädt danach neu.')).toBeTruthy();
    expect(reopen.waitForReopen).toHaveBeenCalledWith('boot1');
  });

  it('asks again when the encrypted values of the backup do not open with the key, then restores anyway', async () => {
    const question = 'Verschlüsselte Werte der Sicherung lassen sich nicht öffnen; trotzdem wiederherstellen?';
    api.adminRestoreBackup.mockRejectedValueOnce(new ApiError(question, 409, 'secrets_key_mismatch'));
    askConfirm.mockResolvedValue(true);
    render(<BackupAdminCard settings={settings} onSave={vi.fn()} />);
    await screen.findByText(/Komplett mit 2 Mediendateien/);
    fireEvent.click(screen.getByLabelText('Backup mindsift-full-2026-11-22-030000 wiederherstellen'));
    await waitFor(() => expect(api.adminRestoreBackup).toHaveBeenCalledWith('mindsift-full-2026-11-22-030000', true));
    expect(askConfirm).toHaveBeenCalledTimes(2);
    expect(askConfirm.mock.calls[1][0]).toMatchObject({ message: question, danger: true });
    expect(await screen.findByText('Wird wiederhergestellt … MindSift lädt danach neu.')).toBeTruthy();
  });

  it('stops when the question about the key is cancelled', async () => {
    api.adminRestoreBackup.mockRejectedValueOnce(new ApiError('Frage', 409, 'secrets_key_mismatch'));
    askConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<BackupAdminCard settings={settings} onSave={vi.fn()} />);
    await screen.findByText(/Komplett mit 2 Mediendateien/);
    fireEvent.click(screen.getByLabelText('Backup mindsift-full-2026-11-22-030000 wiederherstellen'));
    await waitFor(() => expect(askConfirm).toHaveBeenCalledTimes(2));
    expect(api.adminRestoreBackup).toHaveBeenCalledTimes(1);
    expect(reopen.waitForReopen).not.toHaveBeenCalled();
  });

  it('says when the key is not in the backups', async () => {
    const { rerender } = render(<BackupAdminCard settings={settings} onSave={vi.fn()} />);
    await screen.findByText(/Komplett mit 2 Mediendateien/);
    expect(screen.queryByText(/nicht im Backup/)).toBeNull();
    rerender(<BackupAdminCard settings={{ ...settings, backupSecretsKeyExcluded: true }} onSave={vi.fn()} />);
    expect(screen.getByText('Der Schlüssel für verschlüsselte Werte ist nicht im Backup; bewahre ihn getrennt auf.')).toBeTruthy();
  });

  it('offers no restore where the instance cannot reopen its data', async () => {
    setCapabilities({ restore: false });
    render(<BackupAdminCard settings={settings} onSave={vi.fn()} />);
    expect(await screen.findByText(/Komplett mit 2 Mediendateien/)).toBeTruthy();
    expect(screen.queryByLabelText(/wiederherstellen$/)).toBeNull();
    expect(screen.queryByText('Backup hochladen')).toBeNull();
  });

  it('shows the progress of an upload, then restores the uploaded backup', async () => {
    let report: (p: { phase: string; done: number; total: number }) => void = () => {};
    let finish: (v: unknown) => void = () => {};
    upload.uploadBackup.mockImplementation((_file: File, onProgress: typeof report) => {
      report = onProgress;
      return new Promise((resolve) => (finish = resolve));
    });
    api.adminRestoreUpload.mockResolvedValue({ restarting: true, preRestoreBackup: 'x' });
    askConfirm.mockResolvedValue(true);
    render(<BackupAdminCard settings={settings} onSave={vi.fn()} />);
    await screen.findByText(/Komplett mit 2 Mediendateien/);
    const file = new File(['tar'], 'umzug.tar');
    fireEvent.change(screen.getByTestId('backup-upload-input'), { target: { files: [file] } });
    act(() => report({ phase: 'upload', done: 25, total: 100 }));
    expect(screen.getByText('Wird hochgeladen … 25 %')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    act(() => report({ phase: 'check', done: 80, total: 100 }));
    expect(screen.getByText('Wird geprüft … 80 %')).toBeTruthy();
    await act(async () => finish({ id: 'up1', name: 'umzug.tar', size: 100, sha256: 'abc' }));
    await waitFor(() => expect(api.adminRestoreUpload).toHaveBeenCalledWith('up1', 'umzug.tar', 'abc', false));
    expect(askConfirm.mock.calls[0][0].message).toContain('umzug.tar');
    expect(await screen.findByText('Wird wiederhergestellt … MindSift lädt danach neu.')).toBeTruthy();
  });

  it('downloads through a link with a one-time ticket', async () => {
    api.adminBackupDownloadUrl.mockResolvedValue('/api/v1/admin/backup-download/x?ticket=t');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<BackupAdminCard settings={settings} onSave={vi.fn()} />);
    await screen.findByText(/Komplett mit 2 Mediendateien/);
    fireEvent.click(screen.getAllByText('Download')[0]);
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.adminBackupDownloadUrl).toHaveBeenCalledWith('mindsift-full-2026-11-22-030000');
    click.mockRestore();
  });
});
