import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { MfaStatus, User } from '../../../lib/types';

const off: MfaStatus = {
  available: true,
  enabled: false,
  totp: { enabled: false, enabledAt: '' },
  passkeys: [],
  passkeysOff: '',
  recoveryCodesLeft: 0,
  trustedDevices: [],
  trustDays: 30,
};
const laptop = { id: 'psk_1', name: 'Laptop', createdAt: '2026-11-01T10:00:00Z', lastUsedAt: '', synced: true };
const withPasskey: MfaStatus = { ...off, enabled: true, passkeys: [laptop], recoveryCodesLeft: 10 };
const codes = ['aaaaa-bbbbb', 'ccccc-ddddd', 'eeeee-fffff', 'ggggg-hhhhh', 'jjjjj-kkkkk', 'mmmmm-nnnnn', 'ppppp-qqqqq', 'rrrrr-sssss', 'ttttt-uuuuu', 'vvvvv-wwwww'];

const { api, createPasskey, getPasskey } = vi.hoisted(() => ({
  api: {
    getMfaStatus: vi.fn(),
    passkeyRegisterOptions: vi.fn(),
    registerPasskey: vi.fn(),
    renamePasskey: vi.fn(),
    removePasskey: vi.fn(),
    passkeyChallenge: vi.fn(),
  },
  createPasskey: vi.fn(),
  getPasskey: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({ api, triggerHaptic: vi.fn() }));
vi.mock('../../../lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/webauthn')>()),
  passkeysSupported: () => true,
  createPasskey: (...a: unknown[]) => createPasskey(...a),
  getPasskey: (...a: unknown[]) => getPasskey(...a),
}));

import { PasskeyCard } from '../user/PasskeyCard';

const me = { id: 'u1', email: 'ada@example.com', username: 'ada', displayName: 'Ada' } as User;

async function renderCard(status: MfaStatus) {
  api.getMfaStatus.mockResolvedValue(status);
  const onChanged = vi.fn();
  await act(async () => {
    render(<PasskeyCard currentUser={me} demoMode={false} onChanged={onChanged} />);
  });
  return { onChanged };
}

describe('PasskeyCard', () => {
  beforeEach(() => {
    for (const f of [...Object.values(api), createPasskey, getPasskey]) f.mockReset();
  });

  it('adds the first passkey: password, name, the browser, then the recovery codes once', async () => {
    api.passkeyRegisterOptions.mockResolvedValue({ token: 'pkc_1', options: { challenge: 'AQID' } });
    createPasskey.mockResolvedValue({ id: 'cred' });
    api.registerPasskey.mockResolvedValue({ passkey: laptop, recoveryCodes: codes });
    const { onChanged } = await renderCard(off);
    expect(screen.getByText('Noch keine Passkeys.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Passkey hinzufügen' }));
    // No second factor yet: the password alone
    expect(screen.queryByLabelText('Wiederherstellungscode')).toBeNull();
    fireEvent.change(screen.getByLabelText('Zur Bestätigung dein Passwort'), { target: { value: 'geheim-1234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    });
    expect(api.passkeyRegisterOptions).toHaveBeenCalledWith('geheim-1234');
    const name = screen.getByLabelText('Name des Passkeys') as HTMLInputElement;
    expect(name.value).not.toBe('');
    fireEvent.change(name, { target: { value: 'Mein Laptop' } });
    api.getMfaStatus.mockResolvedValue(withPasskey);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Passkey anlegen' }));
    });
    expect(createPasskey).toHaveBeenCalledWith({ challenge: 'AQID' });
    expect(api.registerPasskey).toHaveBeenCalledWith('pkc_1', 'Mein Laptop', { id: 'cred' });
    expect(screen.getByText(/Die Zwei-Faktor-Anmeldung ist jetzt eingeschaltet/)).toBeTruthy();
    expect(screen.getAllByText(/^[a-z]{5}-[a-z]{5}$/)).toHaveLength(10);
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the name step when the browser’s dialog is closed', async () => {
    api.passkeyRegisterOptions.mockResolvedValue({ token: 'pkc_1', options: { challenge: 'AQID' } });
    createPasskey.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
    await renderCard(off);
    fireEvent.click(screen.getByRole('button', { name: 'Passkey hinzufügen' }));
    fireEvent.change(screen.getByLabelText('Zur Bestätigung dein Passwort'), { target: { value: 'geheim-1234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Passkey anlegen' }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Passkey anlegen' })).toBeTruthy();
    expect(api.registerPasskey).not.toHaveBeenCalled();
  });

  it('lists passkeys, renames one and asks for a second factor to add another', async () => {
    api.renamePasskey.mockResolvedValue({ name: 'Arbeit' });
    await renderCard(withPasskey);
    expect(screen.getByText('Laptop')).toBeTruthy();
    expect(screen.getByText('synchronisiert')).toBeTruthy();
    expect(screen.getByText(/noch nie benutzt/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Umbenennen' }));
    fireEvent.change(screen.getByLabelText('Name des Passkeys'), { target: { value: 'Arbeit' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    });
    expect(api.renamePasskey).toHaveBeenCalledWith('psk_1', 'Arbeit');

    api.passkeyChallenge.mockResolvedValue({ passkeyToken: 'pkc_c', options: { challenge: 'BBB' } });
    getPasskey.mockResolvedValue({ id: 'cred' });
    api.passkeyRegisterOptions.mockResolvedValue({ token: 'pkc_2', options: { challenge: 'CCC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Passkey hinzufügen' }));
    expect(screen.getByLabelText('Wiederherstellungscode')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Zur Bestätigung dein Passwort'), { target: { value: 'geheim-1234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit Passkey bestätigen' }));
    });
    expect(api.passkeyRegisterOptions).toHaveBeenCalledWith('geheim-1234', { passkeyToken: 'pkc_c', passkey: { id: 'cred' } });
    expect(screen.getByLabelText('Name des Passkeys')).toBeTruthy();
  });

  it('warns before the last second factor goes and removes it with a recovery code', async () => {
    api.removePasskey.mockResolvedValue({ mfaOff: true });
    await renderCard(withPasskey);
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(screen.getByText(/Das ist dein letzter zweiter Faktor/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'geheim-1234' } });
    fireEvent.change(screen.getByLabelText('Wiederherstellungscode'), { target: { value: 'aaaaa-bbbbb' } });
    api.getMfaStatus.mockResolvedValue(off);
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Passwort').closest('form')!);
    });
    expect(api.removePasskey).toHaveBeenCalledWith('u1', 'psk_1', 'geheim-1234', { code: 'aaaaa-bbbbb' });
    expect(screen.getByText('Passkey entfernt. Die Zwei-Faktor-Anmeldung ist ausgeschaltet.')).toBeTruthy();
  });

  it('says why passkeys are off on this server', async () => {
    await renderCard({ ...off, passkeysOff: 'no_base_url' });
    expect(screen.getByText(/Die Administration muss BASE_URL mit https setzen/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Passkey hinzufügen' })).toBeNull();
  });
});
