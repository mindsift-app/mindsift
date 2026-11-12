// Sign-in through the OpenID Connect provider (server: internal/api/oidc.go). The app starts a flow, keeps the
// value bind in localStorage and goes to the provider. It comes back with ?oidc=<ticket> (or ?oidc_error=<code>),
// which leaves the address bar at once; the ticket together with bind gives the session, or the confirmation of
// a sensitive change for the current one. Without bind (another browser) the ticket is worthless.
import i18n from '../i18n';
import { api, getCurrentOidc } from './api';
import type { SecondFactorProof } from './types';

const BIND_KEY = 'mindsift_oidc_bind';

export type OidcResult =
  | { kind: 'signedIn' }
  | { kind: 'confirmed'; linked: boolean }
  | { kind: 'error'; message: string };

// The result of this page load's return, until the screen that shows it takes it
let pending: OidcResult | null = null;

const here = () => window.location.pathname + window.location.search;

function keepBind(bind: string) {
  try {
    localStorage.setItem(BIND_KEY, bind);
  } catch {
    // Without storage the ticket cannot be traded; the return says so
  }
}

function takeBind(): string {
  try {
    const bind = localStorage.getItem(BIND_KEY) || '';
    localStorage.removeItem(BIND_KEY);
    return bind;
  } catch {
    return '';
  }
}

// "Mit <Anbieter> anmelden": off to the provider, back to this page (e.g. the OAuth consent) afterwards
export async function startOidcLogin(returnTo = here()): Promise<void> {
  const { url, bind } = await api.oidcStart(returnTo);
  keepBind(bind);
  window.location.assign(url);
}

// Signed in: sign in at the provider again (a sensitive change), or link the account (link, with the password)
export async function startOidcConfirm(opts: { link?: boolean; password?: string } & Partial<SecondFactorProof> = {}): Promise<void> {
  const { url, bind } = await api.oidcConfirm({ return: here(), ...opts });
  keepBind(bind);
  window.location.assign(url);
}

// The provider's name on buttons and in texts
export const oidcName = () => getCurrentOidc().name || 'SSO';

// What the app says to an error code of the return (?oidc_error=…)
export function oidcErrorText(code: string): string {
  const name = oidcName();
  switch (code) {
    case 'cancelled':
      return i18n.t('auth:oidc.error.cancelled', { name });
    case 'expired':
      return i18n.t('auth:oidc.error.expired', { name });
    case 'unavailable':
      return i18n.t('auth:oidc.error.unavailable', { name });
    case 'no_account':
      return i18n.t('auth:oidc.error.noAccount', { name });
    case 'no_email':
      return i18n.t('auth:oidc.error.noEmail', { name });
    case 'email_in_use':
      return i18n.t('auth:oidc.error.emailInUse', { name });
    case 'disabled':
      return i18n.t('auth:oidc.error.disabled');
    case 'pending':
      return i18n.t('auth:oidc.error.pending');
    case 'unverified':
      return i18n.t('auth:oidc.error.unverified');
    case 'setup':
      return i18n.t('auth:oidc.error.setup');
    case 'wrong_account':
      return i18n.t('auth:oidc.error.wrongAccount', { name });
    case 'not_fresh':
      return i18n.t('auth:oidc.error.notFresh', { name });
    case 'linked_elsewhere':
      return i18n.t('auth:oidc.error.linkedElsewhere', { name });
    case 'already_linked':
      return i18n.t('auth:oidc.error.alreadyLinked', { name });
  }
  return i18n.t('auth:oidc.error.failed', { name });
}

// Reads ?oidc / ?oidc_error once, removes them from the address bar and trades the ticket. Runs at the start
// of the app, before it looks for a session; the result waits for takeOidcResult.
export async function finishOidcReturn(): Promise<OidcResult | null> {
  const url = new URL(window.location.href);
  const ticket = url.searchParams.get('oidc');
  const error = url.searchParams.get('oidc_error');
  if (!ticket && !error) return null;
  url.searchParams.delete('oidc');
  url.searchParams.delete('oidc_error');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  const bind = takeBind();
  if (error || !ticket) {
    pending = { kind: 'error', message: oidcErrorText(error || 'failed') };
    return pending;
  }
  try {
    const res = await api.oidcExchange(ticket, bind);
    pending = res.token ? { kind: 'signedIn' } : { kind: 'confirmed', linked: Boolean(res.linked) };
  } catch (err: any) {
    pending = { kind: 'error', message: err?.message || oidcErrorText('failed') };
  }
  return pending;
}

// The result of the return for the screen showing it, once
export function takeOidcResult(): OidcResult | null {
  const result = pending;
  pending = null;
  return result;
}
