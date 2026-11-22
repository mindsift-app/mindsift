import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const finishSetup = vi.fn(async (_payload: unknown) => {});
const location = { dir: '/home/anna/.local/share/MindSift/instances/Privat/backups', defaultDir: '/home/anna/.local/share/MindSift/instances/Privat/backups', custom: false };
const adminGetBackupLocation = vi.fn(async () => location);
vi.mock('../../../lib/api', () => ({
  api: {
    finishSetup: (payload: unknown) => finishSetup(payload),
    adminGetBackupLocation: () => adminGetBackupLocation(),
  },
  triggerHaptic: vi.fn(),
}));
const pickFolder = vi.fn(async (_path: string) => ({ path: '/media/usb/MindSift' }));
const shellState = vi.fn(async () => ({ base: '/b', entries: [{ id: 'e1', kind: 'local', name: 'Privat' }], found: [], current: 'e1' }));
vi.mock('../../../lib/desktopShell', () => ({
  desktopShell: { state: () => shellState(), pickFolder: (p: string) => pickFolder(p) },
  DesktopShellError: class extends Error {},
}));

import i18n from '../../../i18n';
import { DesktopSetupView } from '../DesktopSetupView';

const me = { id: 'u', email: '', username: 'anna', displayName: 'Anna Muster', role: 'admin', isActive: true } as never;
const status = { needsSetup: false, allowRegistration: false, instanceName: 'MindSift' };

async function renderView(onDone = () => {}) {
  await act(async () => {
    render(<DesktopSetupView user={me} authStatus={status} onDone={onDone} />);
  });
}

const finish = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Fertig, los geht’s/ }));
  });

describe('DesktopSetupView: the desktop app’s short wizard', () => {
  beforeEach(() => {
    finishSetup.mockClear();
    pickFolder.mockClear();
  });

  it('asks nothing server-specific and finishes with the defaults in one click', async () => {
    const onDone = vi.fn();
    await renderView(onDone);
    for (const gone of [/E-Mail/, /Mailserver/, /Registrierung/, /Organisation/, /Abmelden/, /BASE_URL/]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    // The start view's name of the instance is the suggestion
    expect((screen.getByLabelText('Name der Instanz') as HTMLInputElement).value).toBe('Privat');
    expect(screen.getByPlaceholderText(location.defaultDir)).toBeTruthy();
    await finish();
    const sent = finishSetup.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ instanceName: 'Privat', timeZone: '', createSampleData: true, backupEnabled: true, backupTime: '03:00', backupRetentionDays: 3, backupDir: '' });
    for (const key of ['email', 'smtp', 'sharingMode', 'allowRegistration']) expect(sent).not.toHaveProperty(key);
    expect(onDone).toHaveBeenCalled();
  });

  it('sends the language the wizard shows, also when the app switched after it opened', async () => {
    await renderView();
    // The account's or the browser's language arrives after the start language (App.tsx)
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    try {
      await finish();
      expect(finishSetup).toHaveBeenCalledWith(expect.objectContaining({ defaultLanguage: 'en' }));
    } finally {
      await act(async () => {
        await i18n.changeLanguage('de');
      });
    }
  });

  it('takes the folder chosen in the system dialog', async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Ordner wählen/ }));
    });
    expect(pickFolder).toHaveBeenCalledWith(location.defaultDir);
    expect((screen.getByLabelText('Ordner') as HTMLInputElement).value).toBe('/media/usb/MindSift');
    await finish();
    expect(finishSetup).toHaveBeenCalledWith(expect.objectContaining({ backupDir: '/media/usb/MindSift' }));
  });

  it('sends no backup settings when backups are switched off', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('switch', { name: 'Tägliche Backups' }));
    expect(screen.queryByRole('button', { name: /Ordner wählen/ })).toBeNull();
    await finish();
    const sent = finishSetup.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.backupEnabled).toBe(false);
    expect(sent).not.toHaveProperty('backupDir');
  });

  it('shows the server’s refusal of a folder', async () => {
    finishSetup.mockImplementationOnce(async () => {
      throw new Error('In den Ordner für die Backups kann nicht geschrieben werden');
    });
    await renderView();
    await finish();
    expect(screen.getByRole('alert').textContent).toContain('kann nicht geschrieben werden');
  });
});
