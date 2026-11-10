# Flaws, Risks & Ideas

Status: Continuously verified against the `dev` branch. Completely resolved items are removed here; their history can be found in git commits and in the `CHANGELOG`. Open and partially resolved issues remain listed. Issue IDs (from FLAW-28 onwards, previously FLAW-01–27) continue incrementing so references in commit messages remain stable. Every entry is verified against the source code; code references are provided.

Severity levels: **High** (account takeover or data exfiltration possible), **Medium** (protection bypassed or malfunction under realistic conditions), **Low** (hardening, privacy, maintainability).

---

## Overview

| ID | Domain | Summary | Severity |
|---|---|---|---|
| FLAW-31 | Auth | Session token stored in `localStorage` (no HttpOnly cookies) | Partially resolved |
| FLAW-34 | Admin | SMTP password stored in plain text in DB and backups | Partially resolved |

---

## Details

### FLAW-31: Long-Lived Session in `localStorage`
- **Status: Partially resolved.** Server-side sessions (`sessions`, [sessions.go](../internal/api/sessions.go)): Each token is tied to a session that can be revoked individually and expires after 30 days of inactivity; the token is refreshed daily via `X-Session-Token`. Profile → "Active Sessions" displays device, IP, and last activity, allowing individual logouts.
- **Remaining risk:** The token remains stored in `localStorage` (any script executing in the app context could access it); HttpOnly cookies with CSRF protection were deliberately deferred because strict CSP and link sanitization (formerly FLAW-28/29) close the known exploit vectors. If needed: short-lived access token + HttpOnly cookie.

### FLAW-34: Plaintext SMTP Password
- **Status: Partially resolved.** `GET`/`PUT /admin/settings` always return `smtpPass` empty and only report `smtpPassSet`; leaving the field empty retains the stored password, while omitting an SMTP username clears it ([handlers_admin.go](../internal/api/handlers_admin.go)).
- **Remaining risk:** In the database and its backups, the password remains in plain text (the server needs it to authenticate). Operators who wish to avoid this can configure `SMTP_HOST`/`SMTP_PASS` via environment variables and leave the fields blank in the admin UI.

---

## Feature Ideas

### Capture
- **Natural Language Dates** during capture: "Dentist tomorrow 2pm" automatically sets the due date and time.
- **Email to Inbox:** A dedicated personal email address whose incoming emails become inbox thoughts.

### Tasks & Reminders
- **Per-User Timezone** instead of a single server-wide timezone.
- **Calendar View & iCal Subscription** for due tasks (e.g. in Google/Apple Calendar).
- **Flexible Recurrence:** "every 2nd Tuesday", "on the last business day", "3 days after completion".

### Notes
- **View & Restore Version History:** The operations log (`doc_ops`) exists, but a dedicated UI is missing.
- **Templates** (e.g. "Weekly Review").
- **Graph View** based on backlinks.

### Lists
- **Sort by Store:** Arrange categories according to the physical layout of your local supermarket.
- **Suggest Frequent Items** while typing (based on completed entries).

### Account & Security
- **Two-Factor Authentication** (TOTP) or **Passkeys**.
- **OIDC Authentication** (Authelia, Authentik, Keycloak) for homelab setups.
- **Admin Audit Log:** Detailed record of who modified accounts, roles, and settings, and when.

### Operations
- **Offsite Backup Destinations** (WebDAV, S3, SFTP) to survive local drive failures.
- **Prometheus `/metrics`** and a healthcheck endpoint that also verifies database connectivity.
- **Update Notifications** in the admin interface when a new release image is available.
