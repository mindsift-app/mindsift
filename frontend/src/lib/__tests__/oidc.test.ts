import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: { oidcStart: vi.fn(), oidcConfirm: vi.fn(), oidcExchange: vi.fn() },
}));
vi.mock('../api', () => ({
  api,
  getCurrentOidc: () => ({ enabled: true, name: 'Authentik', passwordLogin: true }),
}));

import { finishOidcReturn, oidcErrorText, startOidcConfirm, startOidcLogin, takeOidcResult } from '../oidc';

const realLocation = window.location;

describe('sign-in through the OIDC provider', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    localStorage.clear();
    takeOidcResult();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    window.history.replaceState(null, '', '/');
  });

  it('keeps bind and goes to the provider, coming back to the same page', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/oauth/authorize', search: '?client_id=mcl_1&state=s', assign },
    });
    api.oidcStart.mockResolvedValue({ url: 'https://auth.example/authorize?x=1', bind: 'geheim' });
    await startOidcLogin();
    expect(api.oidcStart).toHaveBeenCalledWith('/oauth/authorize?client_id=mcl_1&state=s');
    expect(localStorage.getItem('mindsift_oidc_bind')).toBe('geheim');
    expect(assign).toHaveBeenCalledWith('https://auth.example/authorize?x=1');

    api.oidcConfirm.mockResolvedValue({ url: 'https://auth.example/authorize?prompt=login', bind: 'zwei' });
    await startOidcConfirm({ link: true, password: 'pw' });
    expect(api.oidcConfirm).toHaveBeenCalledWith({ return: '/oauth/authorize?client_id=mcl_1&state=s', link: true, password: 'pw' });
    expect(localStorage.getItem('mindsift_oidc_bind')).toBe('zwei');
  });

  it('trades the ticket with bind and takes it out of the address bar', async () => {
    localStorage.setItem('mindsift_oidc_bind', 'geheim');
    window.history.replaceState(null, '', '/oauth/authorize?client_id=mcl_1&oidc=TICKET&state=s');
    api.oidcExchange.mockResolvedValue({ token: 'jwt', user: { id: 'u1' } });
    expect(await finishOidcReturn()).toEqual({ kind: 'signedIn' });
    expect(api.oidcExchange).toHaveBeenCalledWith('TICKET', 'geheim');
    expect(window.location.pathname + window.location.search).toBe('/oauth/authorize?client_id=mcl_1&state=s');
    expect(localStorage.getItem('mindsift_oidc_bind')).toBeNull();
    expect(takeOidcResult()).toEqual({ kind: 'signedIn' });
    // Taken once
    expect(takeOidcResult()).toBeNull();
    // Nothing to do on an ordinary page load
    expect(await finishOidcReturn()).toBeNull();
    expect(api.oidcExchange).toHaveBeenCalledTimes(1);
  });

  it('reports a confirmation of the current session', async () => {
    window.history.replaceState(null, '', '/?oidc=T2');
    api.oidcExchange.mockResolvedValue({ confirmed: true, linked: true, expiresIn: 300 });
    expect(await finishOidcReturn()).toEqual({ kind: 'confirmed', linked: true });
  });

  it('says in German why the provider sent the person back', async () => {
    window.history.replaceState(null, '', '/?oidc_error=no_account');
    expect(await finishOidcReturn()).toEqual({
      kind: 'error',
      message: 'Zu deinem Konto bei Authentik gibt es hier kein MindSift-Konto, und neue Konten legt nur die Administration an.',
    });
    expect(window.location.search).toBe('');
    expect(api.oidcExchange).not.toHaveBeenCalled();
    expect(oidcErrorText('cancelled')).toBe('Die Anmeldung bei Authentik wurde abgebrochen.');
    expect(oidcErrorText('irgendwas')).toBe(
      'Die Anmeldung über Authentik hat nicht geklappt. Bitte versuche es noch einmal oder wende dich an die Administration.'
    );
    // A refused ticket shows the server's message
    window.history.replaceState(null, '', '/?oidc=ALT');
    api.oidcExchange.mockRejectedValue(new Error('Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.'));
    expect(await finishOidcReturn()).toEqual({ kind: 'error', message: 'Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.' });
  });
});
