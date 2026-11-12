import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const login = vi.fn(async () => ({ mfaRequired: true, mfaToken: 'mfa_1', methods: ['totp', 'recovery'], expiresIn: 300 }));
const loginMfa = vi.fn(async () => ({ token: 't', user: { id: 'u1' }, method: 'totp', recoveryCodesLeft: 10 }));
vi.mock('../../../lib/api', () => ({
  api: { login: (...a: unknown[]) => login(...(a as [])), loginMfa: (...a: unknown[]) => loginMfa(...(a as [])) },
  ApiError: class extends Error {},
  triggerHaptic: vi.fn(),
}));

import { SetupAndAuthView } from '../SetupAndAuthView';

const status = { needsSetup: false, allowRegistration: false, instanceName: 'MindSift' };

async function signIn() {
  fireEvent.change(screen.getByPlaceholderText('admin oder name@beispiel.de'), { target: { value: 'ada' } });
  const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  fireEvent.change(password, { target: { value: 'geheim-1234' } });
  await act(async () => {
    fireEvent.submit(password.closest('form')!);
  });
}

describe('SetupAndAuthView: sign-in with a second factor', () => {
  it('asks for the code after the password and signs in with it', async () => {
    const onAuthenticated = vi.fn();
    render(<SetupAndAuthView authStatus={status} onAuthenticated={onAuthenticated} />);
    await signIn();
    expect(login).toHaveBeenCalledWith('ada', 'geheim-1234');
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(screen.getByText('Bestätigung in zwei Schritten')).toBeTruthy();
    // The tabs and the password form are gone while the code is asked
    expect(screen.getByRole('button', { name: 'Einladungscode' }).parentElement!.className).toMatch(/\bhidden\b/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    });
    expect(loginMfa).toHaveBeenCalledWith('mfa_1', '123456', false);
    expect(onAuthenticated).toHaveBeenCalledWith({ id: 'u1' });
  });

  it('goes back to the password form', async () => {
    render(<SetupAndAuthView authStatus={status} onAuthenticated={() => {}} />);
    await signIn();
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Anmeldung' }));
    expect(screen.queryByText('Bestätigung in zwei Schritten')).toBeNull();
    expect((screen.getByPlaceholderText('admin oder name@beispiel.de') as HTMLInputElement).value).toBe('ada');
  });
});
