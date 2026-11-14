# Flaws, Risks & Ideas

Status: Continuously verified against the `dev` branch. Open and partially resolved issues are listed with their details. A resolved item leaves the overview and keeps one line under [Resolved](#resolved), so the IDs in code comments, commit messages and the changelog can still be looked up. Issue IDs keep incrementing and are never reused. Every open entry is verified against the source code; code references are provided.

Severity levels: **High** (account takeover or data exfiltration possible), **Medium** (protection bypassed or malfunction under realistic conditions), **Low** (hardening, privacy, maintainability).

---

## Overview

| ID | Domain | Summary | Severity |
|---|---|---|---|
| FLAW-31 | Auth | Session token stored in `localStorage` (no HttpOnly cookies) | Partially resolved |
| FLAW-34 | Admin | SMTP password stored in plain text in DB and backups | Partially resolved |
| FLAW-43 | Sharing | A picture copied out of a shared note stays readable after the share is revoked | Accepted (by design) |
| FLAW-44 | Accounts | Changing one's login address tells whether another address already has an account | Accepted |

---

## Details

### FLAW-31: Long-Lived Session in `localStorage`
- **Status: Partially resolved.** Server-side sessions (`sessions`, [sessions.go](../internal/api/sessions.go)): Each token is tied to a session that can be revoked individually and expires after 30 days of inactivity; the token is refreshed daily via `X-Session-Token`. Profile → "Active Sessions" displays device, IP, and last activity, allowing individual logouts.
- **Remaining risk:** The token remains stored in `localStorage` (any script executing in the app context could access it); HttpOnly cookies with CSRF protection were deliberately deferred because strict CSP and link sanitization (formerly FLAW-28/29) close the known exploit vectors. If needed: short-lived access token + HttpOnly cookie.

### FLAW-34: Plaintext SMTP Password
- **Status: Partially resolved.** `GET`/`PUT /admin/settings` always return `smtpPass` empty and only report `smtpPassSet`; leaving the field empty retains the stored password, while omitting an SMTP username clears it ([handlers_admin.go](../internal/api/handlers_admin.go)).
- **Remaining risk:** In the database and its backups, the password remains in plain text (the server needs it to authenticate). Operators who wish to avoid this can configure `SMTP_HOST`/`SMTP_PASS` via environment variables and leave the fields blank in the admin UI.

### FLAW-43: Copied Pictures Outlive a Revoked Share
- **Status: Accepted (by design).** A file is readable for everyone who may read the note it was uploaded to or any note whose bullets point to it ([media.go](../internal/storage/media.go) `CanReadMedia`, [block_refs.go](../internal/storage/block_refs.go) `sqlDocsWithMedia`). This is what keeps an image working when a bullet is copied or moved into another note.
- **Only what one could read already:** a bullet may only point to a file its writer uploaded or may read at that moment. Wherever content comes in (editor sync, MCP, new notes through the API, imports of an Obsidian vault, a MindSift archive or a backup, restoring a personal backup, a task's title carried into its note), references to any other file are replaced by their caption or a placeholder (`mediaGate` in [media.go](../internal/storage/media.go)); an import lists the notes concerned as skipped. Knowing a file's id is therefore no way in: before, importing a note (or writing a bullet) with `![…](media:<id>)` of someone else's file made that file readable (pentest 2026-11-14).
- **Consequence:** someone who saw a picture (or recording) in a shared note and copies that bullet into a note of their own keeps access to the file after the share is revoked, and can publish it through a public link of their own note (`handlePublicMedia` in [publiclinks.go](../internal/api/publiclinks.go) serves every file the note shows).
- **Why it stays:** what was shared once can be copied or photographed anyway. A copy in one's own notes is one's own copy, just like copied text. Revoking a share stops access to the note, not to copies made while it was shared.

### FLAW-44: Changing the Login Address Reveals Taken Addresses
- **Status: Accepted.** Changing one's login address in the account settings answers `409` ("E-Mail-Adresse existiert bereits") when another account already uses the new address ([handlers_auth.go](../internal/api/handlers_auth.go) `handleUpdateUserSettings`), so a signed-in person can test whether an address has an account on this server.
- **Why it stays:** it needs an account of one's own and its current password, and every try is a deliberate settings change. On a self-hosted server the people with accounts are known to the admin. Answering the same way every time and mailing nothing to a taken address would hide it, but someone who mistypes would never learn why no mail arrives.

---

## Resolved

Every ID that was ever given out and is no longer open. IDs up to FLAW-27 date from before the public history (it starts at v0.70.0); what is known about them comes from the changelog ([CHANGELOG-archive.md](../CHANGELOG-archive.md)), which is why some share a line.

| ID | Resolved by | Version |
|---|---|---|
| FLAW-01, 02, 03, 11, 15 | Realtime events and WebSocket/SSE rooms only for signed-in people with access; reordering tasks checks write rights; SSE streams are no longer cut after 30 s; a block write checks that the block belongs to the note | 0.2 |
| FLAW-04 | Without `JWT_SECRET` (or with a well-known placeholder) a random secret is created in `data/jwt.secret` instead of a public default | 0.4.1 |
| FLAW-05 | Addresses of Discord and custom alarm webhooks are checked (https only, no loopback, link-local or cloud metadata; private networks only with an admin switch) | 0.4.1 |
| FLAW-06, 10, 24 | Only owners share; organizations and visibility modes decide who sees whom and who may share with whom | 0.3 |
| FLAW-07, 08 | One authentication check for middleware and webhook ingest (session, `token_version`, active account); API keys only deliver data and only within their scopes | 0.4.1, 0.5 |
| FLAW-09 | Login guard against guessing passwords (`429` with `Retry-After`), `TRUSTED_PROXIES`, passwords of at least 8 characters | 0.5 |
| FLAW-12 | Due dates with a time and the server's time zone; an alarm gives up after 3 failed deliveries instead of trying every minute | 0.4.1, 0.5 |
| FLAW-13 | Numbered migrations in `schema_migrations` that run once and stop the start on errors | 0.5 |
| FLAW-14 | Changes in several steps run in one transaction; deleting a task list checks ownership first | 0.5 |
| FLAW-16 | Dropped: the setup being open until the first account exists, and the demo accounts, are intended behaviour | (none) |
| FLAW-17 | Notes and folders can be shared with write access | 0.2 |
| FLAW-18 | Full-text search (SQLite FTS5) that respects access rights | 0.3 |
| FLAW-19 | ESLint in the frontend and in the image build, more frontend tests | 0.5 |
| FLAW-20 | `sqlite.go` and `server.go` split by domain; one access check for task lists | 0.4.1, 0.5 |
| FLAW-21 | The project got a license (The Unlicense, AGPL-3.0 since 0.49.0) | 0.3 |
| FLAW-22 | One-time stream tickets instead of the session token in WebSocket/SSE URLs; signing out cuts open streams | 0.5 |
| FLAW-23 | Transactions start with `BEGIN IMMEDIATE`, so parallel writers wait instead of failing with `SQLITE_BUSY` | 0.5 |
| FLAW-25, 26 | Block locks, presence, conflict copies instead of lost text, undo/redo per person | 0.2 |
| FLAW-27 | Access checks on all list item endpoints | 0.5 |
| FLAW-28 | Links in notes and task notes only open `http`, `https` and `mailto` | 0.6.0 |
| FLAW-29 | Security headers on every answer (Content Security Policy and others) | 0.6.0 |
| FLAW-30 | Password and sign-in address change only with the current password | 0.6.0 |
| FLAW-32 | IDs with 96 instead of 40 random bits, invite codes with 100 bits | 0.6.0 |
| FLAW-33 | The public demo sends nothing and keeps its shared accounts and server settings unchanged | 0.6.0 |
| FLAW-35 | `?token=` of the webhook ingest accepts API keys only, no session tokens | 0.6.0 |
| FLAW-36 | Size limits for request bodies on every endpoint | 0.6.0 |
| FLAW-37 | Deleting an account removes its server backups | 0.6.0 |
| FLAW-38 | Large downloads and uploads get longer timeouts instead of breaking off | 0.6.0 |
| FLAW-39 | Registration and "forgot password" are limited per address | 0.6.0 |
| FLAW-40 | An invite code cannot be redeemed twice at the same moment | 0.6.0 |
| FLAW-41 | The largest frontend files (`TasksView`, `WorkspaceView`, `App`, `lib/api.ts`) split into components, hooks and pure functions with tests | 0.69.38 |
| FLAW-42 | At most 20 realtime connections per account; the oldest is closed for a new one | 0.68.1 |

FLAW-31 and FLAW-34 are resolved in part (0.6.0) and stay in the overview above.

---

## Feature Ideas

### Capture
- **Natural Language Dates** during capture: "Dentist tomorrow 2pm" automatically sets the due date and time.
- **Email to Inbox:** A dedicated personal email address whose incoming emails become inbox thoughts.

### Tasks & Reminders
- **iCal Subscription or CalDAV** for due tasks (e.g. in Google/Apple Calendar); the calendar view inside MindSift exists.
- **Flexible Recurrence:** "every 2nd Tuesday", "on the last business day", "3 days after completion".

### Notes
- **View & Restore Version History:** The operations log (`doc_ops`) exists, but a dedicated UI is missing.
- **Templates** (e.g. "Weekly Review").
- **Graph View** based on backlinks.

### Lists
- **Sort by Store:** Arrange categories according to the physical layout of your local supermarket.
- **Suggest Frequent Items** while typing (based on completed entries).

### Account & Security
- **Admin Audit Log:** Detailed record of who modified accounts, roles, and settings, and when.

### Operations
- **Offsite Backup Destinations** (WebDAV, S3, SFTP) to survive local drive failures.
- **Update Notifications** in the admin interface when a new release image is available.
