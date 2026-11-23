import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const completeSetup = vi.fn(async (_payload: unknown) => ({ token: 't', user: { id: 'u' } }));
vi.mock('../../../lib/api', async () => (await import('../../../test/apiMock')).stubApi({ completeSetup: (payload: unknown) => completeSetup(payload) }));

import { SetupWizardView } from '../SetupWizardView';

const status = { needsSetup: true, allowRegistration: false, instanceName: 'MindSift' };

// The first-boot wizard: account plus the shared instance questions, the daily backups among them
function fillAccount() {
  fireEvent.change(screen.getByPlaceholderText('z.B. Admin / Dein Name'), { target: { value: 'Chef' } });
  fireEvent.change(screen.getByPlaceholderText('admin@deinedomain.de'), { target: { value: 'chef@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Passwort erneut eingeben'), { target: { value: 'geheim-genug' } });
  const [password] = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  fireEvent.change(password, { target: { value: 'geheim-genug' } });
}

const submit = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }));
  });

describe('SetupWizardView', () => {
  beforeEach(() => completeSetup.mockClear());

  it('creates the admin with daily backups switched on by default', async () => {
    const onAuthenticated = vi.fn();
    render(<SetupWizardView authStatus={status} onAuthenticated={onAuthenticated} />);
    fillAccount();
    expect(screen.getByRole('switch', { name: 'Tägliche Backups einschalten' }).getAttribute('aria-checked')).toBe('true');
    await submit();
    expect(completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'chef@example.com', backupEnabled: true, backupTime: '03:00', backupRetentionDays: 3 })
    );
    expect(onAuthenticated).toHaveBeenCalled();
  });

  it('creates the admin without backups when switched off', async () => {
    render(<SetupWizardView authStatus={status} onAuthenticated={() => {}} />);
    fillAccount();
    fireEvent.click(screen.getByRole('switch', { name: 'Tägliche Backups einschalten' }));
    await submit();
    expect(completeSetup).toHaveBeenCalledWith(expect.objectContaining({ backupEnabled: false }));
    expect(completeSetup.mock.calls[0][0]).not.toHaveProperty('backupTime');
  });

  it('keeps the retention within 1 to 365 days', async () => {
    render(<SetupWizardView authStatus={status} onAuthenticated={() => {}} />);
    fillAccount();
    const field = screen.getByLabelText('Aufbewahren') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '400' } });
    fireEvent.blur(field);
    expect(field.value).toBe('365');
    // Empty goes back to the last value
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(field.value).toBe('365');
    await submit();
    expect(completeSetup).toHaveBeenCalledWith(expect.objectContaining({ backupRetentionDays: 365 }));
  });

  it('asks the mail server when the environment sets none and sends it with the account', async () => {
    const fresh = { ...status, setup: { smtpConfigured: false, smtpViaEnv: false, baseUrlSet: false, emailLinks: false, backupDir: '/data/backups' } };
    render(<SetupWizardView authStatus={fresh} onAuthenticated={() => {}} />);
    fillAccount();
    expect(screen.getByText('3. Mailserver')).toBeTruthy();
    const summary = screen.getByTestId('setup-summary');
    expect(summary.textContent).toContain('Kein Mailserver');
    expect(summary.textContent).toContain('BASE_URL ist nicht gesetzt');
    expect(summary.textContent).toContain('/data/backups');
    // The login address is the account's own here: nothing to confirm
    expect(summary.textContent).not.toContain('E-Mail-Adresse');

    fireEvent.click(screen.getByRole('switch', { name: 'Mailserver jetzt einrichten' }));
    // No account yet, so no test mail: it comes after the setup, in the administration
    expect(screen.queryByRole('button', { name: 'Testmail senden' })).toBeNull();
    expect(screen.getByText(/Eine Testmail sendest du nach dem Abschluss/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('SMTP Host (`SMTP_HOST`)'), { target: { value: 'mail.example.com' } });
    expect(summary.textContent).not.toContain('Kein Mailserver');
    await submit();
    expect(completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'chef@example.com', smtp: expect.objectContaining({ smtpHost: 'mail.example.com', smtpPort: '587' }) })
    );
  });

  it('only shows a mail server set by the environment', async () => {
    const withEnv = { ...status, setup: { smtpConfigured: true, smtpViaEnv: true, baseUrlSet: true, emailLinks: true, backupDir: '/data/backups' } };
    render(<SetupWizardView authStatus={withEnv} onAuthenticated={() => {}} />);
    fillAccount();
    expect(screen.getByText(/Mailserver per Umgebung eingerichtet/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Mailserver jetzt einrichten' })).toBeNull();
    expect(screen.getByTestId('setup-summary').textContent).toContain('Nichts offen');
    await submit();
    expect(completeSetup.mock.calls[0][0]).not.toHaveProperty('smtp');
  });

  it('refuses a mail server switched on without host', async () => {
    render(<SetupWizardView authStatus={status} onAuthenticated={() => {}} />);
    fillAccount();
    fireEvent.click(screen.getByRole('switch', { name: 'Mailserver jetzt einrichten' }));
    await submit();
    expect(screen.getByRole('alert').textContent).toContain('Bitte den SMTP-Server angeben');
    expect(completeSetup).not.toHaveBeenCalled();
  });

  it('asks for the setup code from the server log only when the server requires one', async () => {
    render(<SetupWizardView authStatus={status} onAuthenticated={() => {}} />);
    expect(screen.queryByLabelText('Einrichtungscode *')).toBeNull();
    fillAccount();
    await submit();
    expect(completeSetup.mock.calls[0][0]).not.toHaveProperty('setupCode');
  });

  it('sends the setup code with the account', async () => {
    render(<SetupWizardView authStatus={{ ...status, setupCodeRequired: true }} onAuthenticated={() => {}} />);
    const field = screen.getByLabelText('Einrichtungscode *') as HTMLInputElement;
    expect(field.required).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(screen.getByText('docker logs mindsift')).toBeTruthy();
    fireEvent.change(field, { target: { value: ' abcd-efgh-jkmn ' } });
    fillAccount();
    await submit();
    expect(completeSetup).toHaveBeenCalledWith(expect.objectContaining({ setupCode: 'abcd-efgh-jkmn', email: 'chef@example.com' }));
  });

  it('shows the server error for a wrong setup code', async () => {
    completeSetup.mockRejectedValueOnce(new Error('Der Einrichtungscode stimmt nicht. Er steht im Server-Log.'));
    render(<SetupWizardView authStatus={{ ...status, setupCodeRequired: true }} onAuthenticated={() => {}} />);
    fireEvent.change(screen.getByLabelText('Einrichtungscode *'), { target: { value: 'AAAA-BBBB-CCCC' } });
    fillAccount();
    await submit();
    expect(screen.getByRole('alert').textContent).toContain('Der Einrichtungscode stimmt nicht');
  });

  describe('with touch (the system time picker can be emptied)', () => {
    const matchMedia = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = matchMedia;
    });

    it('refuses an empty backup time', async () => {
      render(<SetupWizardView authStatus={status} onAuthenticated={() => {}} />);
      fillAccount();
      fireEvent.change(screen.getByLabelText('Uhrzeit'), { target: { value: '' } });
      await submit();
      expect(screen.getByText('Bitte eine Uhrzeit für die Backups wählen.')).toBeTruthy();
      expect(completeSetup).not.toHaveBeenCalled();
    });
  });
});
