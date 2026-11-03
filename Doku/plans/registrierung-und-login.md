# Plan: Registration and Login (Draft)

As of 2026-10-31. **Implemented in v0.23.0:** Sections 1 (Registration mode and approval), 2 (Environment variables), and 3 (Invitation links, invite via email, reusable links). Email confirmation via link in v0.24.0. OpenID Connect is deferred (no current demand), recorded in the "Mindsift" task list. Goal: A middle ground between "anyone can register" and "generating an invite code for every person", along with more convenient login.

## Current State

- `ALLOW_REGISTRATION` or admin toggle "Open Registration": anyone can create an account.
- Otherwise invitation code only (optionally bound to an email address and an organization, single-use, with expiration date).
- Login only via email/username and password (plus API keys for webhooks).

## 1. Registration Mode Instead of Yes/No

A mode setting replaces the "Open Registration" toggle:

| Mode | Behavior |
|---|---|
| `closed` | Invitation code only (as currently without open registration). |
| `approval` | Anyone can register, but the account is **locked until an admin approves it**. |
| `domain` | Registration restricted to specific email domains (e.g. `@firma.de, @familie-dach.de`), immediately active. |
| `domain+approval` | Allowed domains immediately active, all others wait for approval. |
| `open` | Anyone, immediately active (as today). |

Invitation codes work in every mode and bypass both approval and domain checks.

**Admin Approval**
- New accounts in `approval` mode are created with `is_active = 0` and a status of "pending approval" (a dedicated field so that "locked" and "pending" remain distinguishable).
- After registering, the user sees: "Your account is pending review. You will receive an email once it has been activated." Logging in is disabled until then (shows the same message).
- Admins receive a notification through existing channels (email/push, new event "registration pending") and see a **"Pending Approval"** list at the top of user management with Approve / Reject actions. Rejecting deletes the account.
- Upon approval, an email using the standard layout is sent to the user ("Your account has been activated" with a button linking to the app).
- Without SMTP, everything functions normally, just without emails.

**Email Domains**
- List of domains, case-insensitive comparison on the part after `@` (no subdomains unless explicitly specified like `*.firma.de`).
- Optional: **Confirm email address** via link (like password reset, using the same token mechanism) before the account becomes active. Otherwise anyone could enter `chef@firma.de`. In `domain` mode, verification should be mandatory when SMTP is configured.

**Abuse Prevention**
- Rate limiting similar to login (requests per IP), plus a cap of N concurrent pending registrations (e.g. 50), after which "Registration currently unavailable" is shown.
- In demo mode, registration remains disabled.

## 2. Settings: Admin UI or Environment Variables

To prevent cluttering admin settings:

- **Admin UI:** Only the mode selector (dropdown) and below it, depending on the mode, the field for allowed domains. The "Pending Approval" list is located in user management, not in settings.
- **Environment variables** (take precedence when set; the field in the UI is then locked with a notice "configured via environment" – exactly like SMTP today):

  ```env
  REGISTRATION_MODE=domain+approval      # closed | approval | domain | domain+approval | open
  REGISTRATION_DOMAINS=firma.de,familie-dach.de
  REGISTRATION_VERIFY_EMAIL=true          # Confirmation link before activation
  ```
- `ALLOW_REGISTRATION=true` is retained as an alias for `REGISTRATION_MODE=open`.

## 3. More Convenient Invitations

Current state: The admin generates a code (optionally bound to an email address and organization, role, validity 1–365 days, **single-use**) and shares it; the user selects "Invitation Code" on the login page and types it in.

**Invitation Link**
- Every code can also be used as a link: `https://<instance>/?invite=<CODE>`. The link navigates directly to registration with the code pre-filled; if bound to an address, the email is already pre-set.
- The app strips the code from the address bar after loading (like with password reset links).
- In the admin list next to each code: **Copy Link** and – if SMTP is enabled – **Invite via Email** (enter address → email in MindSift layout with "Create Account" button, inviter info, expiry). Inviting via email automatically binds the code to that address.
- The admin UI constructs the link from the current URL; only the email requires `BASE_URL`.

**Multiple People with One Code**
- New field **"Max Uses"** (default 1, e.g. 20) – a single link for an entire group, class, or family. The list displays "3 of 20 used", and Revoke terminates it immediately.
- Multi-use codes cannot be tied to a single email address, but can be tied to an organization and to allowed email domains (Section 1).
- Technically: `max_uses` and `use_count` columns on `user_invites`; the existing "reserve code → create account → mark as used" flow increments the counter instead of closing the invite (preventing duplicate redemption under concurrent registrations).

## 4. Logging in with External Accounts (Deferred)

### OpenID Connect (Instead of "Google Only")

A generic OIDC login covers Google, Microsoft, Apple, and especially **self-hosted providers**: Authentik, Keycloak, Authelia – and **Gitea/Forgejo itself** can act as an OIDC provider. For a homelab, this is usually more useful than Google.

- Configuration via environment only (secrets do not belong in the database UI):
  ```env
  OIDC_ISSUER=https://git.example.org/      # or https://accounts.google.com
  OIDC_CLIENT_ID=…
  OIDC_CLIENT_SECRET=…
  OIDC_BUTTON_LABEL=Log in with Gitea
  OIDC_ALLOWED_DOMAINS=firma.de             # optional, otherwise registration mode applies
  OIDC_AUTO_CREATE=true                     # create new account on first login (mode/approval rules apply)
  ```
- Flow: Authorization Code Flow with PKCE, `state`, and `nonce`; callback to `BASE_URL/api/v1/auth/oidc/callback`. Accounts are linked via `iss`+`sub` (new table), not merely by email.
- If an account already exists with the same email **verified** by the provider, it is linked after a password confirmation prompt (preventing silent takeovers of foreign accounts).
- Afterward, a standard MindSift session is established (as today); logging out remains local.
- Password login remains available alongside; optionally `PASSWORD_LOGIN=false` if only OIDC is desired (keeping emergency admin access in mind).

Authenticating directly via the mail server (SMTP credential check like in Gitea) is deliberately out of scope: Mail passwords would pass through MindSift, and major providers increasingly disallow password authentication.

## Execution Order and Effort (Rough Estimate)

1. Invitation links (copy link, invite via email) and multi-use codes – small to medium, immediately useful. (Generating multiple single-use codes in batches becomes obsolete and is dropped.)
2. Registration mode with approval and domain restrictions, environment variables, "Pending Approval" admin list, emails – medium.
3. Email confirmation via link – small (mechanics identical to password reset).
4. OIDC login – medium (`coreos/go-oidc` + `golang.org/x/oauth2` libraries, new table for linked accounts, button on login page).

## Decided

- A rejected request is deleted; the same email address can register again ("Reject" button under "Pending Approval").
- New accounts are not automatically assigned to an organization based on email domain; the admin performs this assignment.
- Admins receive an email for every pending registration (if SMTP is configured), plus the badge count in user management; no additional notification channels are added.

## Open Questions

- Which OIDC provider first: Gitea, Google, Authentik …?
