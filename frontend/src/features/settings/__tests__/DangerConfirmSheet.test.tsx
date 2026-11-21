import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setCurrentDesktop } from '../../../lib/api/client';
import type { useProfileSettings } from '../user/useProfileSettings';
import { DangerConfirmSheet } from '../user/ProfileSection';

type Profile = ReturnType<typeof useProfileSettings>;

// Only what the sheet reads from the profile state
function profileOf(noPassword: boolean, action: 'data' | 'account' = 'data'): Profile {
  return {
    currentUser: { id: 'u1', noPassword },
    dangerAction: action,
    dangerPassword: '',
    dangerError: null,
    dangerBusy: false,
    handleDangerSubmit: vi.fn(),
    setDangerAction: vi.fn(),
    setDangerPassword: vi.fn(),
  } as unknown as Profile;
}

const confirmButton = () => screen.getByRole('button', { name: 'Daten löschen' }) as HTMLButtonElement;

describe('DangerConfirmSheet', () => {
  afterEach(() => setCurrentDesktop(null));

  it('asks a normal account for its password and keeps the button off until it is typed', () => {
    render(<DangerConfirmSheet profile={profileOf(false)} />);
    expect(screen.getByLabelText('Zur Bestätigung dein Passwort')).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
  });

  it('sends an account without a password to the sign-in provider on a normal server', () => {
    render(<DangerConfirmSheet profile={profileOf(true)} />);
    expect(screen.getByText(/Du bestätigst mit einer erneuten Anmeldung/)).toBeTruthy();
    expect(screen.queryByLabelText('Zur Bestätigung dein Passwort')).toBeNull();
  });

  it('is a plain confirmation in the desktop app: no password, no provider, the button works at once', () => {
    setCurrentDesktop({ platform: 'linux', realtime: 'sse' });
    render(<DangerConfirmSheet profile={profileOf(true)} />);
    expect(screen.getByText(/endgültig gelöscht/)).toBeTruthy();
    expect(screen.queryByLabelText('Zur Bestätigung dein Passwort')).toBeNull();
    expect(screen.queryByText(/erneuten Anmeldung/)).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });
});
