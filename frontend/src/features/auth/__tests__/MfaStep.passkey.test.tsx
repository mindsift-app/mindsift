import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { mfaPasskeyOptions, loginMfaPasskey, getPasskey } = vi.hoisted(() => ({
  mfaPasskeyOptions: vi.fn(),
  loginMfaPasskey: vi.fn(),
  getPasskey: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({
  api: {
    mfaPasskeyOptions: (...a: unknown[]) => mfaPasskeyOptions(...a),
    loginMfaPasskey: (...a: unknown[]) => loginMfaPasskey(...a),
    loginMfa: vi.fn(),
  },
  ApiError: class extends Error {},
  triggerHaptic: vi.fn(),
}));
vi.mock('../../../lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/webauthn')>()),
  passkeysSupported: () => true,
  getPasskey: (...a: unknown[]) => getPasskey(...a),
}));

import { MfaStep } from '../MfaStep';

const user = { id: 'u1', displayName: 'Ada' };
const answer = { id: 'cred', type: 'public-key' };

describe('MfaStep: the passkey as second step', () => {
  beforeEach(() => {
    for (const f of [mfaPasskeyOptions, loginMfaPasskey, getPasskey]) f.mockReset();
    mfaPasskeyOptions.mockResolvedValue({ options: { challenge: 'AQID' } });
  });
  afterEach(() => vi.useRealTimers());

  it('puts the passkey first when the account has no app, and signs in with it', async () => {
    getPasskey.mockResolvedValue(answer);
    loginMfaPasskey.mockResolvedValue({ token: 't', user, method: 'passkey', recoveryCodesLeft: 10 });
    const onAuthenticated = vi.fn();
    await act(async () => {
      render(<MfaStep mfaToken="mfa_1" methods={['passkey', 'recovery']} onAuthenticated={onAuthenticated} onBack={vi.fn()} />);
    });
    expect(screen.getByText(/Bestätige die Anmeldung mit deinem Passkey/)).toBeTruthy();
    expect(screen.queryByLabelText('Code')).toBeNull();
    // The options come ahead, so the click opens the browser's dialog at once
    expect(mfaPasskeyOptions).toHaveBeenCalledWith('mfa_1');
    fireEvent.click(screen.getByRole('switch', { name: 'Diesem Gerät 30 Tage vertrauen' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit Passkey bestätigen' }));
    });
    expect(getPasskey).toHaveBeenCalledWith({ challenge: 'AQID' });
    expect(loginMfaPasskey).toHaveBeenCalledWith('mfa_1', answer, true);
    expect(onAuthenticated).toHaveBeenCalledWith(user);
  });

  it('stays quiet when the person closes the browser’s dialog, and can try again', async () => {
    getPasskey.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
    await act(async () => {
      render(<MfaStep mfaToken="mfa_1" methods={['passkey', 'recovery']} onAuthenticated={vi.fn()} onBack={vi.fn()} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit Passkey bestätigen' }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(loginMfaPasskey).not.toHaveBeenCalled();
    // A fresh challenge for the next try
    expect(mfaPasskeyOptions).toHaveBeenCalledTimes(2);
  });

  it('shows a refused passkey and offers the recovery code', async () => {
    getPasskey.mockResolvedValue(answer);
    loginMfaPasskey.mockRejectedValue(new Error('Der Passkey wurde nicht angenommen'));
    await act(async () => {
      render(<MfaStep mfaToken="mfa_1" methods={['passkey', 'recovery']} onAuthenticated={vi.fn()} onBack={vi.fn()} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit Passkey bestätigen' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('Der Passkey wurde nicht angenommen');
    fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellungscode verwenden' }));
    expect(screen.getByLabelText('Wiederherstellungscode')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Passkey verwenden' }));
    expect(screen.getByRole('button', { name: 'Mit Passkey bestätigen' })).toBeTruthy();
  });

  it('keeps the app’s code first and offers the passkey below it', async () => {
    await act(async () => {
      render(<MfaStep mfaToken="mfa_1" methods={['totp', 'passkey', 'recovery']} onAuthenticated={vi.fn()} onBack={vi.fn()} />);
    });
    expect(screen.getByLabelText('Code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mit Passkey bestätigen' })).toBeTruthy();
  });
});
