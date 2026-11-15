import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const changeOwnPassword = vi.fn(async () => {});
vi.mock('../../../lib/api', () => ({
  api: { changeOwnPassword: (...a: unknown[]) => changeOwnPassword(...(a as [])) },
}));

import { PasswordChangeRequiredView } from '../PasswordChangeRequiredView';
import { User } from '../../../lib/types';

const user = { id: 'u1', displayName: 'Bert', username: 'bert', email: 'bert@beispiel.de', role: 'member', isActive: true } as User;
const status = { needsSetup: false, allowRegistration: false, instanceName: 'MindSift' };

function fill(current: string, next: string, repeat: string) {
  fireEvent.change(screen.getByLabelText('Bisheriges Passwort (von der Administration)'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Neues Passwort wiederholen'), { target: { value: repeat } });
}

describe('PasswordChangeRequiredView', () => {
  beforeEach(() => changeOwnPassword.mockClear());

  it('sets the new password with the one from the administration and goes on', async () => {
    const onDone = vi.fn();
    render(<PasswordChangeRequiredView user={user} authStatus={status} onDone={onDone} onLogout={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeTruthy();
    fill('vom-admin-123', 'mein-eigenes-Passwort', 'mein-eigenes-Passwort');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Speichern und weiter/ }));
    });
    expect(changeOwnPassword).toHaveBeenCalledWith('vom-admin-123', 'mein-eigenes-Passwort');
    expect(onDone).toHaveBeenCalled();
  });

  it('refuses two different new passwords and the old one again without asking the server', async () => {
    const onDone = vi.fn();
    render(<PasswordChangeRequiredView user={user} authStatus={status} onDone={onDone} onLogout={vi.fn()} />);
    fill('vom-admin-123', 'mein-eigenes-Passwort', 'ein-anderes-Passwort');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Speichern und weiter/ }));
    });
    expect(screen.getByRole('alert').textContent).toContain('stimmen nicht überein');
    fill('vom-admin-123', 'vom-admin-123', 'vom-admin-123');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Speichern und weiter/ }));
    });
    expect(screen.getByRole('alert').textContent).toContain('unterscheiden');
    expect(changeOwnPassword).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows the answer of the server and offers to sign out', async () => {
    changeOwnPassword.mockRejectedValueOnce(new Error('Bitte gib zur Bestätigung dein aktuelles Passwort richtig ein'));
    const onLogout = vi.fn();
    render(<PasswordChangeRequiredView user={user} authStatus={status} onDone={vi.fn()} onLogout={onLogout} />);
    fill('falsch-123', 'mein-eigenes-Passwort', 'mein-eigenes-Passwort');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Speichern und weiter/ }));
    });
    expect(screen.getByRole('alert').textContent).toContain('aktuelles Passwort');
    fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(onLogout).toHaveBeenCalled();
  });
});
