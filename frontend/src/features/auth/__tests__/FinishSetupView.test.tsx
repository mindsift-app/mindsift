import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const finishSetup = vi.fn(async (_payload: unknown) => {});
vi.mock('../../../lib/api', () => ({
  api: { finishSetup: (payload: unknown) => finishSetup(payload) },
  triggerHaptic: vi.fn(),
}));

import { FinishSetupView } from '../FinishSetupView';

const admin = { id: 'u', email: '', username: 'chef', displayName: 'Chef', role: 'admin', isActive: true } as never;
const status = { needsSetup: false, allowRegistration: false, instanceName: 'MindSift' };

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
    expect(screen.getByText(/zusätzlich regelmäßig an einen anderen Ort/)).toBeTruthy();
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
