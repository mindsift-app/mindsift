import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { api, getPasskey, conditional } = vi.hoisted(() => ({
  api: { passkeyLoginOptions: vi.fn(), loginPasskey: vi.fn(), login: vi.fn() },
  getPasskey: vi.fn(),
  conditional: { available: false },
}));
vi.mock('../../../lib/api', () => ({ api, ApiError: class extends Error {}, triggerHaptic: vi.fn() }));
vi.mock('../../../lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/webauthn')>()),
  passkeysSupported: () => true,
  conditionalPasskeysAvailable: async () => conditional.available,
  getPasskey: (...a: unknown[]) => getPasskey(...a),
}));

import { SetupAndAuthView } from '../SetupAndAuthView';

const status = { needsSetup: false, allowRegistration: false, instanceName: 'MindSift', passkeys: true };
const loginField = () => screen.getByPlaceholderText('admin oder name@beispiel.de');

describe('SetupAndAuthView: sign-in with a passkey', () => {
  beforeEach(() => {
    for (const f of [...Object.values(api), getPasskey]) f.mockReset();
    conditional.available = false;
    api.passkeyLoginOptions.mockResolvedValue({ token: 'pkc_1', options: { challenge: 'AQID' }, expiresIn: 300 });
  });

  it('signs in with the passkey button, without password', async () => {
    getPasskey.mockResolvedValue({ id: 'cred' });
    api.loginPasskey.mockResolvedValue({ token: 't', user: { id: 'u1' } });
    const onAuthenticated = vi.fn();
    render(<SetupAndAuthView authStatus={status} onAuthenticated={onAuthenticated} />);
    expect(loginField().getAttribute('autocomplete')).toBe('username webauthn');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }));
    });
    expect(getPasskey).toHaveBeenCalledWith({ challenge: 'AQID' });
    expect(api.loginPasskey).toHaveBeenCalledWith('pkc_1', { id: 'cred' });
    expect(onAuthenticated).toHaveBeenCalledWith({ id: 'u1' });
    expect(api.login).not.toHaveBeenCalled();
  });

  it('shows no error when the dialog is closed, but one when the server refuses', async () => {
    getPasskey.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
    render(<SetupAndAuthView authStatus={status} onAuthenticated={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }));
    });
    expect(screen.queryByText('Die Anmeldung mit dem Passkey hat nicht geklappt')).toBeNull();
    expect(screen.queryByText(/cancelled/)).toBeNull();
    getPasskey.mockResolvedValue({ id: 'cred' });
    api.loginPasskey.mockRejectedValue(new Error('Dieses Benutzerkonto ist deaktiviert'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }));
    });
    expect(screen.getByText('Dieses Benutzerkonto ist deaktiviert')).toBeTruthy();
  });

  it('offers the passkeys in the autofill of the login field where the browser can', async () => {
    conditional.available = true;
    getPasskey.mockResolvedValue({ id: 'cred' });
    api.loginPasskey.mockResolvedValue({ token: 't', user: { id: 'u1' } });
    const onAuthenticated = vi.fn();
    await act(async () => {
      render(<SetupAndAuthView authStatus={status} onAuthenticated={onAuthenticated} />);
    });
    expect(getPasskey).toHaveBeenCalledWith({ challenge: 'AQID' }, expect.objectContaining({ conditional: true }));
    expect(onAuthenticated).toHaveBeenCalledWith({ id: 'u1' });
  });

  it('shows no passkey button when the server has passkeys off', () => {
    render(<SetupAndAuthView authStatus={{ ...status, passkeys: false }} onAuthenticated={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Mit Passkey anmelden' })).toBeNull();
    expect(loginField().getAttribute('autocomplete')).toBe('username');
  });
});
