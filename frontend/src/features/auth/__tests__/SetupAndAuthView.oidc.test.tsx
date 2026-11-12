import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { login: vi.fn(), oidcStart: vi.fn(), oidcExchange: vi.fn() },
}));
vi.mock('../../../lib/api', () => ({
  api,
  ApiError: class extends Error {},
  triggerHaptic: vi.fn(),
  getCurrentOidc: () => ({ enabled: true, name: 'Authentik', passwordLogin: false }),
}));

import { SetupAndAuthView } from '../SetupAndAuthView';
import { finishOidcReturn } from '../../../lib/oidc';

const status = {
  needsSetup: false,
  allowRegistration: true,
  instanceName: 'MindSift',
  passwordReset: true,
  oidc: { enabled: true, name: 'Authentik' },
  passwordLogin: true,
};
const loginField = () => screen.queryByPlaceholderText('admin oder name@beispiel.de');
const realLocation = window.location;

describe('SetupAndAuthView: sign-in through the OIDC provider', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    window.history.replaceState(null, '', '/');
  });

  it('offers the provider beside the password form', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/', pathname: '/', search: '', hash: '', assign } });
    api.oidcStart.mockResolvedValue({ url: 'https://auth.example/authorize', bind: 'b1' });
    render(<SetupAndAuthView authStatus={status} onAuthenticated={vi.fn()} />);
    expect(loginField()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Registrieren' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mit Authentik anmelden' }));
    });
    expect(api.oidcStart).toHaveBeenCalledWith('/');
    expect(assign).toHaveBeenCalledWith('https://auth.example/authorize');
    expect(api.login).not.toHaveBeenCalled();
  });

  it('shows only the button when the password login is off', () => {
    render(<SetupAndAuthView authStatus={{ ...status, passwordLogin: false }} onAuthenticated={vi.fn()} />);
    expect(screen.getByText('Melde dich mit deinem Konto bei Authentik an.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mit Authentik anmelden' })).toBeTruthy();
    expect(loginField()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrieren' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Einladungscode' })).toBeNull();
    expect(screen.queryByText('Passwort vergessen?')).toBeNull();
  });

  it('keeps the form for the administrators at /?login=password', () => {
    window.history.replaceState(null, '', '/?login=password');
    render(<SetupAndAuthView authStatus={{ ...status, passwordLogin: false }} onAuthenticated={vi.fn()} />);
    expect(loginField()).toBeTruthy();
    expect(screen.getByText(/Notzugang für die Administration/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mit Authentik anmelden' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Registrieren' })).toBeNull();
  });

  it('says why the provider sent the person back', async () => {
    window.history.replaceState(null, '', '/?oidc_error=cancelled');
    await finishOidcReturn();
    render(<SetupAndAuthView authStatus={status} onAuthenticated={vi.fn()} />);
    expect(screen.getByText('Die Anmeldung bei Authentik wurde abgebrochen.')).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it('shows no provider button while OIDC is off', () => {
    render(<SetupAndAuthView authStatus={{ ...status, oidc: { enabled: false, name: '' } }} onAuthenticated={vi.fn()} />);
    expect(screen.queryByText(/Mit .* anmelden/)).toBeNull();
    expect(loginField()).toBeTruthy();
  });
});
