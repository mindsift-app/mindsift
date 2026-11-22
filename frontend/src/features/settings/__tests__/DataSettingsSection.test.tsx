import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SystemSettings } from '../../../lib/types';
import { actAsDesktopApp } from '../../../test/desktop';

const shell = vi.hoisted(() => ({ desktop: false }));
const api = vi.hoisted(() => ({
  adminListBackups: vi.fn(),
  adminDeletedBackups: vi.fn(),
  adminGetBackupLocation: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({ api, isDesktopApp: () => shell.desktop }));

import { DataSettingsSection } from '../admin/DataSettingsSection';
import type { useAdminSettings } from '../admin/useAdminSettings';

const settings = { backupEnabled: true, backupTime: '02:30', backupRetentionDays: 3, retentionAllowNever: true } as SystemSettings;
const admin = { settings, demoMode: false, handleSaveSystemSettings: vi.fn() } as unknown as ReturnType<typeof useAdminSettings>;

describe('DataSettingsSection (Administration → Data)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shell.desktop = false;
    api.adminListBackups.mockResolvedValue([]);
    api.adminDeletedBackups.mockResolvedValue([]);
    api.adminGetBackupLocation.mockResolvedValue({ dir: '/daten/backups', defaultDir: '/daten/backups', custom: false });
  });

  it('on a server: backups at their time and the switch for keeping things for good', () => {
    render(<DataSettingsSection admin={admin} />);
    expect(screen.getByText('Tägliche Backups und ob Erledigtes und Gelöschtes für immer bleiben darf.')).toBeTruthy();
    expect(screen.getByText(/Täglich um 02:30: die ganze Datenbank/)).toBeTruthy();
    expect(screen.getByText('Dauerhaftes Aufbewahren erlauben')).toBeTruthy();
    expect(screen.queryByText('Konto aus einem Server-Backup übernehmen')).toBeNull();
  });

  it('in the desktop app: one line per card, the take-over, no switch for other people', async () => {
    shell.desktop = true;
    actAsDesktopApp();
    render(<DataSettingsSection admin={admin} />);
    expect(screen.getByText('Tägliche Backups und Konten aus einem Server-Backup.')).toBeTruthy();
    expect(screen.getByText('Täglich um 02:30; verpasste Backups werden beim nächsten Start nachgeholt.')).toBeTruthy();
    expect(await screen.findByText('Leer = Ordner der Instanz; im gewählten Ordner entsteht ein Unterordner „MindSift-Backups“.')).toBeTruthy();
    expect(screen.getByText('Übernimmt ein Konto samt Bildern und Aufnahmen aus dem Backup eines MindSift-Servers.')).toBeTruthy();
    expect(screen.queryByText('Dauerhaftes Aufbewahren erlauben')).toBeNull();
    expect(screen.queryByText(/Vorhandene Backups bleiben/)).toBeNull();
  });
});
