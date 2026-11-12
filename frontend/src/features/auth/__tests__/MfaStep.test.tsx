import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { FakeApiError, loginMfa } = vi.hoisted(() => ({
  FakeApiError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string
    ) {
      super(message);
    }
  },
  loginMfa: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({
  api: { loginMfa: (...args: unknown[]) => loginMfa(...args) },
  ApiError: FakeApiError,
  triggerHaptic: vi.fn(),
}));

import { MfaStep } from '../MfaStep';

const user = { id: 'u1', displayName: 'Ada' };

function renderStep() {
  const onAuthenticated = vi.fn();
  const onBack = vi.fn();
  render(<MfaStep mfaToken="mfa_1" methods={['totp', 'recovery']} onAuthenticated={onAuthenticated} onBack={onBack} />);
  return { onAuthenticated, onBack };
}

const codeField = () => screen.getByLabelText(/^Code$|Wiederherstellungscode/) as HTMLInputElement;

describe('MfaStep: second step of the sign-in', () => {
  beforeEach(() => {
    loginMfa.mockReset();
  });

  it('sends the app code as soon as six digits are there', async () => {
    loginMfa.mockResolvedValue({ token: 't', user, method: 'totp', recoveryCodesLeft: 10 });
    const { onAuthenticated } = renderStep();
    expect(screen.getByText('Bestätigung in zwei Schritten')).toBeTruthy();
    const field = codeField();
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    fireEvent.change(field, { target: { value: '12345' } });
    expect(loginMfa).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.change(field, { target: { value: '123 456' } });
    });
    expect(loginMfa).toHaveBeenCalledWith('mfa_1', '123456', false);
    expect(onAuthenticated).toHaveBeenCalledWith(user);
  });

  it('trusts the device when the switch is on', async () => {
    loginMfa.mockResolvedValue({ token: 't', user, method: 'totp', recoveryCodesLeft: 10 });
    renderStep();
    fireEvent.click(screen.getByRole('switch', { name: 'Diesem Gerät 30 Tage vertrauen' }));
    await act(async () => {
      fireEvent.change(codeField(), { target: { value: '654321' } });
    });
    expect(loginMfa).toHaveBeenCalledWith('mfa_1', '654321', true);
  });

  it('shows the error of a wrong code and empties the field', async () => {
    loginMfa.mockImplementation(async () => {
      throw new FakeApiError('Der Code ist falsch oder abgelaufen', 401, 'mfa_invalid');
    });
    const { onAuthenticated, onBack } = renderStep();
    await act(async () => {
      fireEvent.change(codeField(), { target: { value: '111111' } });
    });
    expect(screen.getByRole('alert').textContent).toContain('Der Code ist falsch oder abgelaufen');
    expect(codeField().value).toBe('');
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('goes back to the password when the step expired', async () => {
    loginMfa.mockImplementation(async () => {
      throw new FakeApiError('Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.', 401, 'mfa_expired');
    });
    const { onBack } = renderStep();
    await act(async () => {
      fireEvent.change(codeField(), { target: { value: '222222' } });
    });
    expect(onBack).toHaveBeenCalledWith('Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.');
  });

  it('takes a recovery code and says how few are left', async () => {
    loginMfa.mockResolvedValue({ token: 't', user, method: 'recovery', recoveryCodesLeft: 2 });
    const { onAuthenticated } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellungscode verwenden' }));
    const field = codeField();
    expect(field.getAttribute('inputmode')).toBeNull();
    fireEvent.change(field, { target: { value: 'abcde-fghjk' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    });
    expect(loginMfa).toHaveBeenCalledWith('mfa_1', 'abcde-fghjk', false);
    expect(screen.getByRole('status').textContent).toContain('Du hast noch 2 Codes');
    expect(screen.getByRole('status').textContent).toContain('neue Codes');
    expect(onAuthenticated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(onAuthenticated).toHaveBeenCalledWith(user);
  });

  it('goes back to the sign-in on request', () => {
    const { onBack } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Anmeldung' }));
    expect(onBack).toHaveBeenCalled();
  });
});
