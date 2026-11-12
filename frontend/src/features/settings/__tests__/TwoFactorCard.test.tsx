import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { MfaStatus, User } from '../../../lib/types';

const off: MfaStatus = { available: true, totp: { enabled: false, enabledAt: '' }, recoveryCodesLeft: 0, trustedDevices: [], trustDays: 30 };
const on: MfaStatus = {
  available: true,
  totp: { enabled: true, enabledAt: '2026-11-01T10:00:00Z' },
  recoveryCodesLeft: 2,
  trustedDevices: [
    { id: 'tdv_1', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0', createdAt: '', expiresAt: '2026-12-01T10:00:00Z', lastUsedAt: '' },
  ],
  trustDays: 30,
};
const codes = ['aaaaa-bbbbb', 'ccccc-ddddd', 'eeeee-fffff', 'ggggg-hhhhh', 'jjjjj-kkkkk', 'mmmmm-nnnnn', 'ppppp-qqqqq', 'rrrrr-sssss', 'ttttt-uuuuu', 'vvvvv-wwwww'];

const getMfaStatus = vi.fn();
const setupTotp = vi.fn();
const confirmTotp = vi.fn();
const disableTotp = vi.fn();
const removeTrustedDevice = vi.fn();
vi.mock('../../../lib/api', () => ({
  api: {
    getMfaStatus: () => getMfaStatus(),
    setupTotp: (...a: unknown[]) => setupTotp(...a),
    confirmTotp: (...a: unknown[]) => confirmTotp(...a),
    disableTotp: (...a: unknown[]) => disableTotp(...a),
    newRecoveryCodes: vi.fn(),
    removeTrustedDevice: (...a: unknown[]) => removeTrustedDevice(...a),
  },
  triggerHaptic: vi.fn(),
}));

import { TwoFactorCard } from '../user/TwoFactorCard';

const me = { id: 'u1', email: 'ada@example.com', username: 'ada', displayName: 'Ada' } as User;

describe('TwoFactorCard', () => {
  beforeEach(() => {
    for (const f of [getMfaStatus, setupTotp, confirmTotp, disableTotp, removeTrustedDevice]) f.mockReset();
  });

  it('sets the app up: password, QR code and key, first code, recovery codes once', async () => {
    getMfaStatus.mockResolvedValue(off);
    setupTotp.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/MindSift:ada@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' });
    confirmTotp.mockResolvedValue({ recoveryCodes: codes, enabledAt: '2026-11-12T09:00:00Z' });
    render(<TwoFactorCard currentUser={me} demoMode={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Einrichten' }));
    fireEvent.change(screen.getByLabelText('Zur Bestätigung dein Passwort'), { target: { value: 'geheim-1234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    });
    expect(setupTotp).toHaveBeenCalledWith('geheim-1234');
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    // The QR code comes from the lazily loaded encoder
    await waitFor(() => expect(screen.getByRole('img', { name: 'QR-Code für die Authenticator-App' })).toBeTruthy());
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    });
    expect(confirmTotp).toHaveBeenCalledWith('123456');
    expect(screen.getByText('Zwei-Faktor-Anmeldung eingeschaltet.')).toBeTruthy();
    expect(screen.getAllByText(/^[a-z]{5}-[a-z]{5}$/)).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Ich habe die Codes gesichert' }));
    expect(screen.queryByText('aaaaa-bbbbb')).toBeNull();
  });

  it('warns when few recovery codes are left and switches off with password and code', async () => {
    getMfaStatus.mockResolvedValue(on);
    disableTotp.mockResolvedValue(undefined);
    render(<TwoFactorCard currentUser={me} demoMode={false} />);
    expect(await screen.findByText(/Noch 2 Wiederherstellungscodes übrig\. Erzeuge neue/)).toBeTruthy();
    expect(screen.getByText('Firefox auf Linux')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ausschalten' }));
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'geheim-1234' } });
    fireEvent.change(screen.getByLabelText('Code der App oder Wiederherstellungscode'), { target: { value: '654321' } });
    getMfaStatus.mockResolvedValue(off);
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Passwort').closest('form')!);
    });
    expect(disableTotp).toHaveBeenCalledWith('u1', 'geheim-1234', { code: '654321' });
    expect(await screen.findByText('Zwei-Faktor-Anmeldung ausgeschaltet.')).toBeTruthy();
  });

  it('removes a trusted device without asking', async () => {
    getMfaStatus.mockResolvedValue(on);
    removeTrustedDevice.mockResolvedValue(undefined);
    render(<TwoFactorCard currentUser={me} demoMode={false} />);
    const remove = await screen.findByRole('button', { name: 'Entfernen' });
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(removeTrustedDevice).toHaveBeenCalledWith('u1', 'tdv_1');
  });

  it('only explains itself in the demo', async () => {
    getMfaStatus.mockResolvedValue({ ...off, available: false });
    render(<TwoFactorCard currentUser={me} demoMode />);
    expect(await screen.findByText(/In der Demo nicht verfügbar/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Einrichten' })).toBeNull();
  });
});
