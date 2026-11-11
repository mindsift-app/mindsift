import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const completeSetup = vi.fn(async (_payload: unknown) => ({ token: 't', user: { id: 'u' } }));
vi.mock('../../../lib/api', () => ({
  api: { completeSetup: (payload: unknown) => completeSetup(payload) },
  ApiError: class extends Error {},
  triggerHaptic: vi.fn(),
}));

import { SetupAndAuthView } from '../SetupAndAuthView';

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

// Past the browser's own check of min/max, as when a browser does not stop the form
const submitForm = () =>
  act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: /Ersteinrichtung abschließen/ }).closest('form')!);
  });

describe('SetupAndAuthView: setup wizard', () => {
  beforeEach(() => completeSetup.mockClear());

  it('creates the admin with daily backups switched on by default', async () => {
    const onAuthenticated = vi.fn();
    render(<SetupAndAuthView authStatus={status} onAuthenticated={onAuthenticated} />);
    fillAccount();
    expect(screen.getByRole('switch', { name: 'Tägliche Backups einschalten' }).getAttribute('aria-checked')).toBe('true');
    await submit();
    expect(completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'chef@example.com', backupEnabled: true, backupTime: '03:00', backupRetentionDays: 3 })
    );
    expect(onAuthenticated).toHaveBeenCalled();
  });

  it('creates the admin without backups when switched off', async () => {
    render(<SetupAndAuthView authStatus={status} onAuthenticated={() => {}} />);
    fillAccount();
    fireEvent.click(screen.getByRole('switch', { name: 'Tägliche Backups einschalten' }));
    await submit();
    expect(completeSetup).toHaveBeenCalledWith(expect.objectContaining({ backupEnabled: false }));
    expect(completeSetup.mock.calls[0][0]).not.toHaveProperty('backupTime');
  });

  it('refuses a retention outside 1 to 365 days', async () => {
    render(<SetupAndAuthView authStatus={status} onAuthenticated={() => {}} />);
    fillAccount();
    fireEvent.change(screen.getByLabelText('Aufbewahren (Tage)'), { target: { value: '400' } });
    await submitForm();
    expect(screen.getByText('Backups 1 bis 365 Tage aufbewahren.')).toBeTruthy();
    // Empty passes the browser's check, not the wizard's
    fireEvent.change(screen.getByLabelText('Aufbewahren (Tage)'), { target: { value: '' } });
    await submit();
    expect(screen.getByText('Backups 1 bis 365 Tage aufbewahren.')).toBeTruthy();
    expect(completeSetup).not.toHaveBeenCalled();
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
      render(<SetupAndAuthView authStatus={status} onAuthenticated={() => {}} />);
      fillAccount();
      fireEvent.change(screen.getByLabelText('Uhrzeit'), { target: { value: '' } });
      await submit();
      expect(screen.getByText('Bitte eine Uhrzeit für die Backups wählen.')).toBeTruthy();
      expect(completeSetup).not.toHaveBeenCalled();
    });
  });
});
