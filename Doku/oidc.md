# Single Sign-On (OpenID Connect)

How to let people sign in to MindSift through an OpenID Connect provider: settings, what happens to accounts and the second factor, and examples for common providers. The implementation (flow, token checks, tickets, sessions) is described in [architecture.md](architecture.md#authentication).

## Setup

With an OpenID Connect provider (Authentik, Authelia, Keycloak, Dex, Google and others) the login shows "Sign in with …". Register MindSift there as a confidential client (authorization code flow with PKCE) with the redirect URI **`<BASE_URL>/api/v1/auth/oidc/callback`** and the scopes `openid email profile` (plus `groups` for `OIDC_ADMIN_GROUP`). `BASE_URL` is required; without it the sign-in through the provider stays off and the log says why.

| Variable | Default | What for |
|---|---|---|
| `OIDC_ISSUER` | empty | The provider's issuer address, exactly as in its `/.well-known/openid-configuration` (trailing slash included) |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | empty | The client registered at the provider; `OIDC_CLIENT_SECRET_FILE` reads the secret from a file (Docker secret) instead |
| `OIDC_NAME` | `SSO` | Text on the button: "Sign in with Authentik" |
| `OIDC_AUTO_CREATE` | `true` | Create an account at the first sign-in. `false`: only accounts already linked get in, everyone else gets a clear message |
| `OIDC_PASSWORD_LOGIN` | `true` | `false`: only the provider's button; no password sign-in, sign-up with a password or "forgot password". Administrators keep an emergency access with their password at `/?login=password` |
| `OIDC_ADMIN_GROUP` | empty | Members of this group at the provider are administrators, checked at every sign-in (in and out; the last administrator always stays one). Needs the `groups` claim |
| `OIDC_SCOPES` | `openid email profile` (+ `groups`) | Other scopes, if the provider needs them |

```env
OIDC_ISSUER=https://auth.example.com/application/o/mindsift/
OIDC_CLIENT_ID=mindsift
OIDC_CLIENT_SECRET=...
OIDC_NAME=Authentik
# OIDC_ADMIN_GROUP=mindsift-admins
# OIDC_PASSWORD_LOGIN=false
```

## Accounts

An account is tied to the provider's identity (issuer and `sub`) alone, so a changed address at the provider keeps the link. MindSift never takes over an existing account at a sign-in, not even by a verified address: its owner links it under Settings → Security (with the password and the second factor). `OIDC_LINK_BY_EMAIL` no longer exists; if it is still set, MindSift starts as usual and says so in the log.

A first sign-in creates a new account with the name and username the provider gives and no password of its own. Its address: verified and free, it is the login address; not verified, it waits for the confirmation link like a changed address; already used by another account (or not sent), the account starts without an address and can add one in the settings. Disabled accounts and accounts waiting for approval stay locked.

## Second factor

The provider asks for its own. MindSift does not ask again, and "require two-factor sign-in" in the administration applies only to password sign-ins. Sensitive changes (address, password, deleting, API keys) are confirmed by signing in at the provider again; that counts for five minutes and only in that browser.

## Provider down or misconfigured

MindSift starts anyway; the button says the provider cannot be reached, and administrators sign in at `/?login=password`. Half a configuration (an issuer without a client, a secret file that cannot be read, `OIDC_PASSWORD_LOGIN=false` without a provider) stops the start with a message in the log. The administration shows the setup and whether the provider answers under Server & Sharing. Off in the demo.

## Provider examples

All with `BASE_URL=https://notes.example.com`.

### Authentik

Applications → Providers → OAuth2/OpenID Provider, client type *Confidential*, redirect URI `https://notes.example.com/api/v1/auth/oidc/callback` (strict), scopes `openid`, `email`, `profile` (Authentik sends the groups with `profile`). `OIDC_ISSUER=https://auth.example.com/application/o/<slug>/`.

### Authelia

In `identity_providers.oidc.clients`:

```yaml
- client_id: mindsift
  client_secret: '$pbkdf2-sha512$…'   # the hash of OIDC_CLIENT_SECRET
  redirect_uris: ['https://notes.example.com/api/v1/auth/oidc/callback']
  scopes: ['openid', 'email', 'profile', 'groups']
  require_pkce: true
  pkce_challenge_method: 'S256'
  token_endpoint_auth_method: 'client_secret_basic'
```

`OIDC_ISSUER=https://auth.example.com`.

### Keycloak

A client with *Client authentication* on and *Standard flow*, valid redirect URI as above. For `OIDC_ADMIN_GROUP` add a *Group Membership* mapper with the claim name `groups` (with or without the full path). `OIDC_ISSUER=https://keycloak.example.com/realms/<realm>`.

## Not supported

SAML and LDAP are not supported, and signing out of MindSift does not sign you out of the provider.
