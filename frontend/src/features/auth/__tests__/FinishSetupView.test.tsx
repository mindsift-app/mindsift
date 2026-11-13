import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const finishSetup = vi.fn(async (_payload: unknown) => {});
// A fresh server: no mail server, no BASE_URL
const noMail = { smtpConfigured: false, smtpViaEnv: false, baseUrlSet: false, emailLinks: false, backupDir: '/data/backups' };
const getSetupStatus = vi.fn(async (): Promise<Record<string, unknown>> => noMail);
const adminTestSMTP = vi.fn(async (_to: string, _smtp?: unknown) => ({ status: 'ok' }));
vi.mock('../../../lib/api', () => ({
  api: {
    finishSetup: (payload: unknown) => finishSetup(payload),
    getSetupStatus: () => getSetupStatus(),
    adminTestSMTP: (to: string, smtp?: unknown) => adminTestSMTP(to, smtp),
  },
  triggerHaptic: vi.fn(),
}));

import { FinishSetupView } from '../FinishSetupView';

const admin = { id: 'u', email: '', username: 'chef', displayName: 'Chef', role: 'admin', isActive: true } as never;
const status = { needsSetup: false, allowRegistration: false, instanceName: 'MindSift' };

// Rendered and the setup status answered
async function renderView(user = admin, onDone = () => {}) {
  await act(async () => {
    render(<FinishSetupView user={user} authStatus={status} onDone={onDone} onLogout={() => {}} />);
  });
}

const finish = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }));
  });

describe('FinishSetupView: e-mail, mail server and summary', () => {
  beforeEach(() => {
    finishSetup.mockClear();
    adminTestSMTP.mockClear();
    getSetupStatus.mockImplementation(async () => noMail);
  });

  it('asks the address of an admin without one and sends it', async () => {
    await renderView();
    expect(screen.getByText(/Ohne Adresse gibt es kein „Passwort vergessen“/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), { target: { value: ' chef@example.com ' } });
    await finish();
    expect(finishSetup).toHaveBeenCalledWith(expect.objectContaining({ email: 'chef@example.com' }));
    // Skipped, no mail server is sent
    expect(finishSetup.mock.calls[0][0]).not.toHaveProperty('smtp');
  });

  it('does not ask when the account has an address (ADMIN_EMAIL)', async () => {
    await renderView({ ...(admin as object), email: 'chef@example.com' } as never);
    expect(screen.queryByLabelText('E-Mail-Adresse')).toBeNull();
    await finish();
    expect(finishSetup.mock.calls[0][0]).not.toHaveProperty('email');
  });

  it('lists what is open on a fresh server: no address, no mail server, no BASE_URL', async () => {
    await renderView();
    const summary = screen.getByTestId('setup-summary');
    expect(summary.textContent).toContain('Keine E-Mail-Adresse');
    expect(summary.textContent).toContain('Kein Mailserver');
    expect(summary.textContent).toContain('BASE_URL ist nicht gesetzt');
    expect(summary.textContent).toContain('/data/backups');
    expect(summary.textContent).toContain('Kopiere ihn zusätzlich regelmäßig an einen anderen Ort');
    expect(summary.textContent).toContain('Administration');

    // An address without mail server is noted down, its link follows later
    fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), { target: { value: 'chef@example.com' } });
    expect(summary.textContent).toContain('chef@example.com wird vorgemerkt');
  });

  it('sets up the mail server, tries it with a test mail to the address given and sends it', async () => {
    getSetupStatus.mockImplementation(async () => ({ ...noMail, baseUrlSet: true }));
    await renderView();
    fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), { target: { value: 'chef@example.com' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Mailserver jetzt einrichten' }));
    fireEvent.change(screen.getByLabelText('SMTP Host (`SMTP_HOST`)'), { target: { value: ' mail.example.com ' } });
    fireEvent.change(screen.getByLabelText('SMTP Port (`SMTP_PORT`)'), { target: { value: '465' } });

    expect((screen.getByLabelText('Testmail an') as HTMLInputElement).value).toBe('chef@example.com');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Testmail senden' }));
    });
    expect(adminTestSMTP).toHaveBeenCalledWith('chef@example.com', expect.objectContaining({ smtpHost: 'mail.example.com', smtpPort: '465', smtpTls: true }));
    expect(screen.getByText(/Testmail an chef@example.com gesendet/)).toBeTruthy();

    const summary = screen.getByTestId('setup-summary');
    expect(summary.textContent).toContain('mail.example.com');
    expect(summary.textContent).toContain('bekommst du an chef@example.com einen Bestätigungslink');
    expect(summary.textContent).not.toContain('Kein Mailserver');

    await finish();
    expect(finishSetup).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'chef@example.com', smtp: expect.objectContaining({ smtpHost: 'mail.example.com', smtpPort: '465' }) })
    );
  });

  it('shows the failure of the test mail', async () => {
    adminTestSMTP.mockRejectedValueOnce(new Error('SMTP-Fehler: Verbindung abgelehnt'));
    await renderView();
    fireEvent.click(screen.getByRole('switch', { name: 'Mailserver jetzt einrichten' }));
    fireEvent.change(screen.getByLabelText('SMTP Host (`SMTP_HOST`)'), { target: { value: 'mail.example.com' } });
    fireEvent.change(screen.getByLabelText('Testmail an'), { target: { value: 'test@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Testmail senden' }));
    });
    expect(screen.getByText('Testmail fehlgeschlagen: SMTP-Fehler: Verbindung abgelehnt')).toBeTruthy();
  });

  it('refuses a mail server without host', async () => {
    const onDone = vi.fn();
    await renderView(admin, onDone);
    fireEvent.click(screen.getByRole('switch', { name: 'Mailserver jetzt einrichten' }));
    expect((screen.getByRole('button', { name: 'Testmail senden' }) as HTMLButtonElement).disabled).toBe(true);
    await finish();
    expect(screen.getByRole('alert').textContent).toContain('Bitte den SMTP-Server angeben');
    expect(finishSetup).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('only shows the mail server set by the environment and tests it as it is', async () => {
    getSetupStatus.mockImplementation(async () => ({
      ...noMail,
      smtpConfigured: true,
      smtpViaEnv: true,
      smtpHost: 'smtp.env.example',
      baseUrlSet: true,
      emailLinks: true,
    }));
    await renderView({ ...(admin as object), email: 'chef@example.com' } as never);
    expect(screen.getByText(/Mailserver per Umgebung eingerichtet/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Mailserver jetzt einrichten' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Testmail senden' }));
    });
    expect(adminTestSMTP).toHaveBeenCalledWith('chef@example.com', undefined);
    expect(screen.getByTestId('setup-summary').textContent).toContain('Nichts offen');
    await finish();
    expect(finishSetup.mock.calls[0][0]).not.toHaveProperty('smtp');
  });
});

describe('FinishSetupView', () => {
  beforeEach(() => finishSetup.mockClear());

  it('asks only the instance settings and sends them', async () => {
    const onDone = vi.fn();
    render(<FinishSetupView user={admin} authStatus={status} onDone={onDone} onLogout={() => {}} />);
    expect(screen.getByText('chef')).toBeTruthy();
    // No account fields: the admin exists already
    expect(screen.queryByText('Administrator-Passwort *')).toBeNull();
    expect(screen.queryByText('E-Mail-Adresse (Login) *')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('MindSift'), { target: { value: ' Zuhause ' } });
    fireEvent.click(screen.getByRole('button', { name: /Privat/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }));
    });
    expect(finishSetup).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: 'Zuhause', sharingMode: 'private', allowRegistration: false, createSampleData: false })
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('asks for daily backups, switched on with the server defaults', async () => {
    render(<FinishSetupView user={admin} authStatus={status} onDone={() => {}} onLogout={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Tägliche Backups einschalten' }).getAttribute('aria-checked')).toBe('true');
    // Below the switch and again in the summary
    expect(screen.getAllByText(/zusätzlich regelmäßig an einen anderen Ort/)).toHaveLength(2);
    expect((screen.getByLabelText('Uhrzeit') as HTMLInputElement).value).toBe('03:00');
    expect((screen.getByLabelText('Aufbewahren (Tage)') as HTMLInputElement).value).toBe('3');

    fireEvent.change(screen.getByLabelText('Uhrzeit'), { target: { value: '01:45' } });
    fireEvent.blur(screen.getByLabelText('Uhrzeit'));
    fireEvent.change(screen.getByLabelText('Aufbewahren (Tage)'), { target: { value: '14' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }));
    });
    expect(finishSetup).toHaveBeenCalledWith(
      expect.objectContaining({ backupEnabled: true, backupTime: '01:45', backupRetentionDays: 14 })
    );
  });

  it('suggests the browser time zone and sends the one chosen', async () => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: 'America/Los_Angeles' };
    });
    try {
      render(<FinishSetupView user={admin} authStatus={status} onDone={() => {}} onLogout={() => {}} />);
      const field = screen.getByRole('button', { name: 'Zeitzone' });
      expect(field.textContent).toContain('America/Los Angeles');
      expect(screen.getByText(/Vorgeschlagen ist die Zeitzone dieses Browsers/)).toBeTruthy();

      // Unchanged, the suggestion is sent
      await finish();
      expect(finishSetup).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'America/Los_Angeles' }));

      // Another one through the search of the list, or none at all
      fireEvent.click(field);
      const search = screen.getByLabelText('Suchen …');
      fireEvent.change(search, { target: { value: 'berlin' } });
      fireEvent.keyDown(search, { key: 'Enter' });
      expect(field.textContent).toContain('Europe/Berlin');
      await finish();
      expect(finishSetup).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'Europe/Berlin' }));

      fireEvent.click(field);
      fireEvent.click(screen.getByRole('option', { name: /Nicht festgelegt/ }));
      await finish();
      expect(finishSetup).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: '' }));
    } finally {
      spy.mockRestore();
    }
    // Builds the full list of time zones in jsdom: on a busy machine that took longer than the 5 s default
  }, 20_000);

  it('sends backups off without time and retention', async () => {
    render(<FinishSetupView user={admin} authStatus={status} onDone={() => {}} onLogout={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Tägliche Backups einschalten' }));
    expect(screen.queryByLabelText('Uhrzeit')).toBeNull();
    expect(screen.queryByText(/zusätzlich regelmäßig an einen anderen Ort/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }));
    });
    const payload = finishSetup.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.backupEnabled).toBe(false);
    expect(payload).not.toHaveProperty('backupTime');
    expect(payload).not.toHaveProperty('backupRetentionDays');
  });

  it('refuses a retention outside 1 to 365 days before sending', async () => {
    const onDone = vi.fn();
    render(<FinishSetupView user={admin} authStatus={status} onDone={onDone} onLogout={() => {}} />);
    const form = screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }).closest('form')!;
    for (const days of ['0', '366', '']) {
      fireEvent.change(screen.getByLabelText('Aufbewahren (Tage)'), { target: { value: days } });
      // Submitted directly: past the browser's own min/max check, which stops 0 and 366 first
      await act(async () => {
        fireEvent.submit(form);
      });
      expect(screen.getByText('Backups 1 bis 365 Tage aufbewahren.')).toBeTruthy();
    }
    expect(finishSetup).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows the error and stays when saving fails', async () => {
    finishSetup.mockRejectedValueOnce(new Error('Ersteinrichtung wurde bereits abgeschlossen'));
    const onDone = vi.fn();
    render(<FinishSetupView user={admin} authStatus={status} onDone={onDone} onLogout={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }));
    });
    expect(screen.getByText('Ersteinrichtung wurde bereits abgeschlossen')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
