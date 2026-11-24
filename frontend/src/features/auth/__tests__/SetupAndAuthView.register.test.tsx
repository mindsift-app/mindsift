import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const register = vi.fn();
vi.mock('../../../lib/api', async () => (await import('../../../test/apiMock')).stubApi({ register: (...a: unknown[]) => register(...a) }));

import { SetupAndAuthView } from '../SetupAndAuthView';

const status = {
  needsSetup: false,
  allowRegistration: true,
  instanceName: 'MindSift',
  passwordReset: false,
  passwordLogin: true,
};
const user = { id: 'u1', displayName: 'Bert', username: 'bert', email: 'bert@beispiel.de', role: 'member', isActive: true };

async function fillAndSubmit(password: string, repeat: string, submitName: string) {
  fireEvent.change(screen.getByLabelText('Anzeigename *'), { target: { value: 'Bert' } });
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse *'), { target: { value: 'bert@beispiel.de' } });
  fireEvent.change(screen.getByLabelText('Passwort *'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Passwort wiederholen *'), { target: { value: repeat } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: submitName }));
  });
}

describe('SetupAndAuthView: new password typed twice when signing up', () => {
  beforeEach(() => register.mockReset());
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('registers when both passwords are the same', async () => {
    register.mockResolvedValue({ user });
    const onAuthenticated = vi.fn();
    render(<SetupAndAuthView authStatus={status} onAuthenticated={onAuthenticated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }));
    expect(screen.getByLabelText('Passwort *').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Passwort wiederholen *').getAttribute('autocomplete')).toBe('new-password');
    await fillAndSubmit('geheimes-Passwort', 'geheimes-Passwort', 'Konto registrieren');
    expect(register).toHaveBeenCalledWith('bert@beispiel.de', 'geheimes-Passwort', 'Bert', '');
    expect(onAuthenticated).toHaveBeenCalledWith(user);
  });

  it('refuses a different repetition without asking the server and flags the field', async () => {
    render(<SetupAndAuthView authStatus={status} onAuthenticated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }));
    await fillAndSubmit('geheimes-Passwort', 'anderes-Passwort', 'Konto registrieren');
    expect(register).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Passwort wiederholen *').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByText('Die eingegebenen Passwörter stimmen nicht überein.').length).toBeGreaterThan(0);
  });

  it('asks for the repetition when redeeming an invitation, too', async () => {
    register.mockResolvedValue({ user });
    window.history.replaceState(null, '', '/?invite=MS-ABCDEFGH');
    render(<SetupAndAuthView authStatus={status} onAuthenticated={vi.fn()} />);
    const submit = 'Einladung einlösen & Konto erstellen';
    await fillAndSubmit('geheimes-Passwort', 'anderes-Passwort', submit);
    expect(register).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Passwort wiederholen *'), { target: { value: 'geheimes-Passwort' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: submit }));
    });
    expect(register).toHaveBeenCalledWith('bert@beispiel.de', 'geheimes-Passwort', 'Bert', 'MS-ABCDEFGH');
  });

  it('does not carry a password typed into the login over to the sign-up form', () => {
    render(<SetupAndAuthView authStatus={status} onAuthenticated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'Login-Passwort' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }));
    expect((screen.getByLabelText('Passwort *') as HTMLInputElement).value).toBe('');
  });
});
