# Architecture

## Overview

```
Browser (React SPA, PWA manifest)
   │  REST /api/v1/*           Authorization: Bearer <JWT | mindsift_sec_…>
   │  WebSocket /api/v1/ws     Fallback: SSE /api/v1/events, then Long-Polling /api/v1/events/poll
   ▼
Go server (chi)  ── internal/api   Handlers, middleware, alarm ticker
   │                internal/ws    Hub (rooms, user channels, SSE, long polling)
   │                internal/auth  JWT, bcrypt, API key hash
   ▼                internal/config
SQLite (modernc.org/sqlite, WAL)  ── internal/storage
```

The frontend is embedded into the binary via `go:embed` ([cmd/server/main.go](../cmd/server/main.go)). Unrecognized paths return `index.html` (SPA routing); `index.html`, `sw.js`, and `manifest.json` are served with `no-store`.

## Stack

| Layer | Technology |
|---|---|
| Backend | Go 1.27, `go-chi/chi` v5, `go-chi/cors`, `gorilla/websocket`, `golang-jwt/jwt` v5, `x/crypto/bcrypt` |
| Database | SQLite via `modernc.org/sqlite` (pure Go, no CGO), WAL, `foreign_keys=ON` |
| Frontend | React 18, TypeScript, Vite 5, Tailwind 3, framer-motion (triage cards), lucide-react, prismjs (code blocks) |
| Delivery | Multi-stage Dockerfile (Node 22 → Go 1.27 → Alpine 3.24), image `ghcr.io/mindsift-app/mindsift` |

## Directories

| Path | Contents |
|---|---|
| `cmd/server/` | `main.go`, embedded `dist/` |
| `internal/api/` | `server.go` (server, router with all routes, middleware, JSON helpers); handlers by domain in `handlers_*.go` (`auth`, `account`, `thoughts`, `documents`, `folders`, `lists`, `tasklists`, `teams`, `admin`, `integrations`), `realtime.go` (WebSocket/SSE/long polling), `alarms.go` (ticker and dispatch), `docsync.go`, `mail.go`, `netguard.go`, `password_reset.go` |
| `internal/storage/` | `sqlite.go` (store, schema, migrations); data logic by domain: `users.go`, `apikeys.go`, `thoughts.go` (incl. alarms), `tasklists.go`, `documents.go`, `folders.go`, `tags.go`, `lists.go`, `teams.go`, `system.go` (settings, statistics, export), plus `visibility.go`, `docsync.go`, `search.go`, `trash.go`, `backlinks.go`, `recurrence.go`, among others |
| `internal/domain/` | Structures (`models.go`), ID generation, tag extraction |
| `internal/ws/` | `hub.go` |
| `internal/collab/` | Core note synchronization without database: block tree, operations and conflict rules, order keys, leases, long-polling notification |
| `internal/auth/` | Tokens and passwords |
| `internal/config/` | Environment variables |
| `frontend/src/app/` | App shell around `App.tsx`: header and page tabs (`AppHeader.tsx`), mobile navigation, profile menus, Quick Dump sheet, install prompt; hooks for session and counters (`useSessionBootstrap`), scroll position per page, search keyboard shortcuts |
| `frontend/src/features/` | `triage`, `workspace`, `lists`, `teams`, `settings` (sections in `settings/user/` and `settings/admin/`), `capture`, `auth`, `help`. Each major view is a shell of subcomponents and hooks; pure logic resides in dedicated modules with tests (e.g. `triage/taskListing.ts`, `workspace/workspaceListing.ts`, `lists/listItems.ts`) |
| `frontend/src/lib/` | `api/` (API client: `client.ts` with token and `request()`, REST calls by domain in `auth.ts`, `tasks.ts`, `workspace.ts`, `lists.ts`, `teams.ts`, `admin.ts`, `data.ts`, assembled in `rest.ts` as `api`; `realtime.ts` with transport switching WS/SSE/long polling), `types.ts`, `markdown.tsx`, `theme.ts` |
| `frontend/src/lib/docSync/` | Note synchronization in the browser: port of `internal/collab` (`model.ts`, `orderKey.ts`), editor list to operations comparison (`diff.ts`), `engine.ts`, IndexedDB (`persist.ts`), HTTP (`transport.ts`) |
| `e2e/` | Browser tests with Playwright against a live server (`e2e/run.sh`); safety net for refactorings: `e2e/refshots.sh` (reference screenshots and workflows `drag`, `ws`, `lists`) |
| `frontend/src/themes/` | CSS per theme |

## Startup and Runtime

1. `config.Load()` reads the environment (see below).
2. `storage.NewStore()` opens SQLite (`busy_timeout`, WAL, max 8 connections) and executes `migrate()`.
3. SMTP values from the environment are imported into `system_settings` if none are present.
4. When the demo flag is set, `EnsureDemoAccounts` creates the `admin/admin` and `user/user` accounts.
5. `api.NewServer` starts the **alarm ticker** (every minute), the **note log compaction** (on startup, then every 6 hours), the **retention cleanup** (2 minutes after startup, then hourly; disabled in demo mode), and builds the router. Server timeouts: read 15 s, write 30 s, idle 60 s. Graceful shutdown on termination.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `./data` (container: `/data`) | Database directory |
| `DATABASE_URL` | empty | `sqlite:///path/file.db` or path; defaults to `DATA_DIR/mindsift.db`. Postgres URLs are **not** supported (see note) |
| `JWT_SECRET` | randomly generated, saved in `$DATA_DIR/jwt.secret` | Signing key for tokens; known placeholders are ignored |
| `TRUSTED_PROXIES` | `private` | Proxies whose `X-Forwarded-For`/`X-Real-IP` headers are trusted (`private`, `all`, `none`, CIDR list); `internal/api/clientip.go` |
| `LOGIN_PROTECTION` | `true` | Login lockout after failed attempts and rate limits for registration and "forgot password" (`internal/api/loginguard.go`), `false` = disabled |
| `BASE_URL` | `http://localhost:<PORT>` | Base URL of the instance; explicitly setting this is required for password reset via email |
| `TZ` | `Europe/Berlin` | Timezone for due dates and alarms; timezone data is embedded in the binary (`time/tzdata`) |
| `REGISTRATION_MODE`, `REGISTRATION_DOMAINS` | empty | Registration without invitation (`closed`, `approval`, `domain`, `domain+approval`, `open`) and allowed email domains. When set, they override `system_settings` and are locked in the admin UI (`registrationPolicy` in `internal/api/registration.go`). Pending accounts: `is_active = 0` plus a row in `pending_registrations` (Migration 10) |
| `REGISTRATION_VERIFY_EMAIL` | empty | Email verification for new accounts created without an invitation (only works with SMTP and `BASE_URL`). Token is stored only as SHA-256 in `email_verifications` (similar to password reset links, Migration 11), valid for 48 hours; afterward, compaction deletes the unverified account. In approval modes, admins are notified only after verification |
| `ALLOW_REGISTRATION` | `false` | `true` = `REGISTRATION_MODE=open`; `false` (default in templates) delegates the choice to the admin UI |
| `LOG_LEVEL` / `DEBUG` | `info` / `false` | `debug`, `info`, `warn`, `error`; `DEBUG=true` forces `debug` |
| `MINDA_DEMO` (also `MINDSIFT_DEMO`, `DEMO_MODE`) | `false` | Create demo accounts. Demo mode sends nothing (no alarms, test or notification emails, webhooks), server settings are read-only, password, email, and accounts of shared demo accounts cannot be changed and their data cannot be deleted in one go (`notInDemo` in `internal/api/demo.go`). |
| `DEMO_RESET_MINUTES` | `20` | Demo mode: periodic reset to sample data (`0` = disabled). Fixed IDs for demo accounts (`usr_demo_admin`, `usr_demo_user`) keep sessions valid; active requests lock the reset (`internal/api/demo.go`, streams excluded); afterwards `DEMO_RESET` is sent to all connections, `/auth/status` returns `demoNextReset`/`demoResetInSeconds`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TLS` | empty / `587` / `true` | Email sending, also configurable in the admin UI |
| `SMTP_FROM_NAME` | `MindSift` | Sender display name when `SMTP_FROM` is only an email address (`From: "MindSift" <address>`, the SMTP envelope remains the bare address); a name in `SMTP_FROM` takes precedence |
| `SMTP_SKIP_VERIFY` | `false` | Do not verify the mail server's certificate (only for internal servers with self-signed certificates) |
| `NOTIFY_DIGEST_MINUTES` | `5` | Notifications (shares, watched tasks, etc.) are queued and sent bundled at most once every this many minutes |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | – | Key pair for Web Push; generated once and stored in `push_keys` if not specified |
| `VAPID_SUBJECT` | `BASE_URL` (if https) | Contact for push services (`mailto:` or `https://`) |
| `MEDIA_MAX_IMAGE_MB`, `MEDIA_MAX_AUDIO_MB` | `15` / `50` | Maximum image and audio file size in notes in MB |
| `MEDIA_QUOTA_MB` | `0` | Storage quota for media per user in MB (`0` = unlimited) |
| `MEDIA_DEMO_MAX_MB` | `3` | Demo mode only: maximum file size for media uploads in MB |
| `DEFAULT_LANGUAGE` | `de` (demo: `en`) | Start value of the server's default language (`de`, `en`, `es`, `fr`, `it`; sign-in screen, new accounts, browsers in other languages) until the setup wizard or an admin picks one in Administration → Server & Isolation. In demo mode it is also the language of the demo accounts |
| `MCP_ENABLED` | empty | `false` disables `/api/v1/mcp` (returns `404`, even unauthenticated) and thus OAuth; `true` keeps it permanently enabled. Empty: toggle "Allow AI agents (MCP)" in Administration → Server & Isolation (default: enabled) |
| `RETENTION_ALLOW_NEVER` | empty | `false` prohibits "never" in retention policies (Account Settings → Retention); users who had selected "never" will fall back to the section default. `true` permanently allows it. Empty: toggle in Administration → Server & Isolation (default: allowed) |
| `STT_URL` | empty | Dedicated speech-to-text: base URL of an OpenAI-compatible Whisper server (e.g. `http://whisper:8000`, speaches). When set = server mode, otherwise browser speech recognition; always browser in demo mode |
| `STT_MODEL`, `STT_LANGUAGE`, `STT_API_KEY` | `deepdml/faster-whisper-large-v3-turbo-ct2` / empty / empty | Model, language (empty = app language of the person speaking, a code such as `de` = fixed for everyone, `auto` = Whisper detects it), API key if required by the Whisper server |
| `STT_DISABLED` | `false` | `true` hides voice input everywhere |
| `STT_ALLOW_BROWSER` | `true` | `false` disallows browser speech recognition (Chrome/Edge send recordings to Google/Microsoft). With a Whisper server, the option "Whisper Server / Browser" in account settings is omitted; without a Whisper server (and in demo mode), voice input is completely disabled. With `true`, each user can choose; the default is the Whisper server. |
| `STT_MAX_SECONDS`, `STT_MAX_UPLOAD_MB` | `600` / `25` | Maximum recording duration (stops in browser), maximum upload size |
| `STT_MAX_PARALLEL`, `STT_PER_USER_PER_HOUR`, `STT_TIMEOUT_SECONDS` | `1` / `60` / `120` | Concurrent transcriptions (others queue), transcriptions per user per hour, maximum duration including queue wait |
| `STT_VAD_FILTER` | `true` | Requests the Whisper server to skip silence (`vad_filter`, speaches); reduces hallucinated repetitions. Set to `false` if the server rejects this field. Independently, MindSift strips verbatim repeated trailing passages. |
| `LEGAL_IMPRINT_URL`, `LEGAL_PRIVACY_URL` | empty | Legal notice / Privacy policy as an external link (`http(s)` only) |
| `LEGAL_IMPRINT_CONTENT`, `LEGAL_PRIVACY_CONTENT` | empty | Legal notice / Privacy policy as Markdown, displayed in a reader modal |
| `LEGAL_IMPRINT_CONTENT_FILE`, `LEGAL_PRIVACY_CONTENT_FILE` | empty | Path to a file in the container with Markdown content for the legal notice or privacy policy. Without URL or text, the link remains hidden. |
| `LEGAL_CUSTOM_LINK_LABEL`, `LEGAL_CUSTOM_LINK_URL` | empty | Custom link in the global desktop footer (`https://` only, otherwise ignored) |

Note: `DATABASE_URL` with `postgres…` causes the default path in `DATA_DIR` to be used; Postgres is not implemented.

## Authentication

- **Login** with email or username (`login`). New accounts get their username from the display name ("Sandro Dach" → `sandro.dach`, a number appended when taken; migration 20 did the same for existing accounts), changeable in the profile and by admins ([storage/username.go](../internal/storage/username.go)). A login typed like a display name is read as the username; the email prefix still works. Passwords: bcrypt (`DefaultCost`).
- **Login protection:** Failed attempts are tracked in memory across three buckets: account + IP (3), account (20), IP (30), each within 15 minutes; if one is exhausted, `429` with `Retry-After` is returned for 15 minutes. Unknown usernames count as accounts (prevents user enumeration). Success clears account buckets; a password reset (email or admin) clears the lockout. Client IP is only derived from trusted proxies (`TRUSTED_PROXIES`). The same buckets limit registrations (20) and "forgot password" requests (10) per IP per 15 minutes; here every request counts.
- **Invitation codes:** `INV-` plus 100 random bits in Base32. Registration claims the code before the account is created (preventing race conditions / double redemption).
- **JWT and sessions:** HS256, claims `userId`, `email`, `displayName`, `tokenVersion`, `jti`. Each login creates a row in `sessions` (device, IP, last used); `jti` is its ID. A token is only valid if the session is active (not terminated, unused for at most 30 days), the account is active, and `tokenVersion` matches `users.token_version`. If the token is older than 24 hours, the server returns a new one for the same session in the `X-Session-Token` header; the frontend adopts it (`request()` in `lib/api/client.ts`). Active devices stay logged in, unused ones expire after 30 days (`internal/api/sessions.go`). New passwords must be at least 8 characters (`auth.ValidatePassword`). `token_version` is incremented on password changes, role changes, deactivation, and "terminate all sessions".
- **Logout** terminates the device's session; `GET /auth/sessions` lists active devices, `DELETE /auth/sessions/{id}` logs one out. Changing the password or login email requires the current password (`currentPassword`, failed attempts count towards login lockout); a new password logs out all other devices, and the current device receives a new token via `X-Session-Token`. If SMTP is configured, a notification email is sent to the previous address.
- **API keys:** `mindsift_sec_<hex>`, stored as SHA-256, only the prefix remains visible. The key is accepted as a Bearer token or in `X-API-Key`. Scopes `webhook:*` ingest data (`POST /inbox`, `POST /webhooks/ingest`); agent scopes `tasks:read`, `tasks:write`, `lists:read`, `lists:write` apply exclusively to the MCP endpoint (`POST /mcp`, `internal/api/mcp.go`); each tool validates its scope, and `tools/list` only displays permitted tools. All other endpoints respond with `403` for API keys. Keys can only access notes via MCP (`notes:read`: list, read, search; `notes:create`: create new, content as Markdown via `MarkdownToBlocks`; `notes:write`: edit bullets via note sync operations, `internal/api/mcp_write.go`, bullets actively being edited by someone remain untouched), never via REST. Likewise only via MCP: `inbox:read` (open inbox entries) and `inbox:write` (convert or discard via `UpdateThoughtTriage`, only for entries with status `inbox`).
- **OAuth for MCP** (`internal/api/oauth.go`, `internal/storage/oauth.go`): MindSift acts as its own OAuth server using `BASE_URL` for `/api/v1/mcp` (RFC 9728/8414 discovery, dynamic client registration, code flow with PKCE S256, rotating refresh tokens), allowing claude.ai and ChatGPT to connect. The consent screen is part of the app (`/oauth/authorize`, `OAuthConsentView`), as authentication state resides in `localStorage`. Consent creates an entry in `api_keys` (`kind = 'oauth'`); tokens (`mindsift_oat_`/`mindsift_ort_`) are linked to it and valid only at the MCP endpoint, sharing the same permissions and provenance as API keys. Expired tokens and idle connections (`OAUTH_IDLE_DAYS`) are cleaned up by the hourly background job. Disabled in demo mode and when MCP is turned off (`MCP_ENABLED` or admin toggle).
- **Forgot password:** Available only when SMTP and `BASE_URL` are configured (disabled in demo mode; `passwordReset` in `/auth/status`). `POST /auth/forgot-password` returns a uniform response and dispatches the email in the background, rate-limited to once every 2 minutes per account. The link `BASE_URL/?resetToken=…` is single-use and valid for one hour; only its SHA-256 hash is stored (`password_reset_tokens`). `POST /auth/reset-password` updates the password, invalidates all pending reset links for the account, and increments `token_version` (terminating all sessions). The app immediately strips the token from the URL bar.
- **Registration:** Permitted only with an invitation code or when `allow_registration` is enabled. The first account is created via `/auth/setup` and becomes administrator.

## Languages

- **Frontend:** i18next (`frontend/src/i18n`). Texts live in `frontend/src/locales/<code>/<area>.json`; German is bundled and the fallback, other languages load on first use. The help is one content file per language (`features/help/content/<code>.tsx`). Dates, times and sorting go through `lib/format.ts`. A test checks that every language has the German keys and placeholders and that every `t('…')` in the code exists; the ESLint rule `i18next/no-literal-string` rejects fixed text in JSX.
- **Language choice:** `users.language` (empty = browser, then default language; accounts from before the choice are `de`), the admin's `default_language` system setting, `DEFAULT_LANGUAGE` as start value. `internal/i18n` lists the supported codes and matches `Accept-Language`.
- **Backend:** server texts are written in German in the code; `internal/i18n/messages_<code>.go` holds a catalog per language keyed by the German text, with `{name}` placeholders (`i18n.T`). `languageMiddleware` puts the request language in `Content-Language`, where `writeError` and `tr` read it; MCP uses English. Errors carrying values (a folder name) are `i18n.Localizer`s and go through `trErr`/`i18n.Text`. A test scans the code for German texts in error answers and fails when a catalog lacks one. Messages to a person (mails, push, Discord/webhook alarms, the daily summary, notifications) and texts the server writes into their data (journal titles, board columns of new task lists, untitled notes, export folders) use their language (`userLanguage` in the API, `MessageLanguage` in the store: own choice, else the default language); dates and times in them come from `internal/i18n/format.go`. Invitations go out in the language of the one inviting.
- **Adding a language:** locale files and help content for the code, an entry in `LANGUAGES` (`frontend/src/i18n/index.ts`) with a loader, the code in `Supported` (`internal/i18n/i18n.go`) a server catalog in `internal/i18n/messages_<code>.go`, registered in `catalogs` (`messages.go`), and date formats in `internal/i18n/format.go`.

## Media in Notes

Images and audio files are stored in `$DATA_DIR/media/<docId>/<id>.<ext>`, tracked in the `media` table (Migration 5, `internal/storage/media.go`). A block references them via its content, e.g. type `image` with `![Caption](media:med_…)`; this allows references to pass through synchronization, undo, and conflict resolution without altering the sync model. Uploading (`POST /documents/{id}/media`) requires write access to the note; reading (`GET /media/{id}`) requires read access to either the file's note or any note whose blocks reference it (copied blocks). File formats are detected by content inspection (JPEG, PNG, GIF, WebP; WebM, Ogg, MP3, WAV, M4A); SVG and other formats are rejected; responses include a strict CSP with `sandbox`. The server fetches external images once (`POST /documents/{id}/media/fetch`, https only, public IP addresses only as with webhooks, disabled in demo mode). Quotas/limits: `MEDIA_MAX_IMAGE_MB`, `MEDIA_MAX_AUDIO_MB`, `MEDIA_QUOTA_MB`, and `MEDIA_DEMO_MAX_MB` in demo mode. Backup ZIP (`media/<id><ext>`) and Markdown archives (`attachments/`, embedded as `![Caption](../attachments/…)` relative to the note) include the files belonging to the user's notes; during import, they are assigned new IDs. Obsidian import handles images and audio embedded alone in a bullet (`![[file.png]]` or `![](path/file.png)`); other files are listed as skipped in the preview. Compaction (every 6 hours) deletes files no longer referenced by any block (including trashed blocks or log history), at the earliest one day after upload. Demo reset empties `media/`.

## Restructuring Notes

`internal/storage/restructure.go`: **Extract branch** reads the subtree and creates a new note (ensuring a unique title, inheriting direct and group shares; the original note's owner receives write access). The editor replaces the branch in the original note with `[[Title]]` (hashtags remain attached to the link) as a dedicated change through the sync engine, avoiding collisions with pending unsent inputs and allowing Ctrl+Z to undo it; `/extract/undo` moves the newly created note to the trash. **Move branch** copies a bullet with its children to the end of another note through the target's sync operations and points tasks and subtasks linked to these checkboxes at the copies (`converted_ref_id`, `SubTask.BlockID`); like extracting, the editor removes the branch from the source itself (dragging the bullet onto a note in the sidebar, or choosing an existing note in the extract popover, which leaves a link to the moved bullet behind), and `/move/undo` reverses the target side when the editor undoes its own change. **Merge notes** appends the source note as an `h2` heading with its bullets as children to the target note (also via sync operations, updating active editors in real time) and moves the source note to the trash; "Undo" deletes the heading along with its sub-bullets and restores the source note. The action runs under the editor client's ID (`clientId`), preventing its own block locks from interfering. Images and audio recordings continue to function because access is checked against notes displaying them.

## Notifications

`internal/api/notify.go`, `internal/storage/notifications.go` (Migration 7). Each user selects notification channels per event type—personal email (alarm address, falling back to account address), personal Discord webhook, custom webhook (`customWebhookUrl`, JSON via POST), and Web Push to registered devices (`internal/api/push.go`, Migration 9, table `push_subscriptions`; devices unrecognized by the push service (404/410) are pruned)—stored as JSON in `users.notification_settings` (`GET /auth/me`, `PATCH /auth/settings` → `notificationSettings`). Events: `due` (due date alarm, dispatched immediately via the alarm ticker), `shared` (note, folder, task list, or list shared; all group members notified for team shares), `taskDone` (task completed in a shared task list), `watched` (any update to a watched task, `task_watchers`, `POST/DELETE /tasks/{id}/watch`). Everything except `due` is queued in `notification_queue`; a minute-interval job dispatches a bundled digest per user once the oldest event reaches `NOTIFY_DIGEST_MINUTES` (default 5) in age (email as text + HTML, Discord as an embed limited to 10 lines, custom webhook as JSON `{"event":"digest","heading","items":[{"kind","title","text"}],"link","timestamp"}`; due tasks are dispatched individually as `{"event":"task_due",…}`), discarded after 3 failed attempts. Actions performed by the user never trigger notifications for themselves, except for watched tasks with `includeOwnWatched`. `paused` mutes everything, including alarms. **Daily digest:** at the configured time (server timezone, within a 30-minute window, once daily), summarizes overdue, today's, and tomorrow's open tasks along with the count for the next 7 days; no due tasks → no message. Jobs are disabled in demo mode.

## Link Previews

Bullets containing a bare https URL display a card above them (`LinkPreviewCard`, `lib/linkPreview.ts`). `GET /link-preview?url=` fetches the web page server-side with the same security checks as webhooks (https only, no private/internal IP addresses, redirects verified), parses `og:*`/`twitter:*`, `<title>`, `description`, and the icon from `<head>` (max 1 MB HTML, image 2 MB, icon 100 KB, no SVG), and caches everything in `link_previews` (Migration 6): successful fetches for 7 days, failed/empty fetches for 1 day, pruned after 30 days. Images are served via `GET /link-preview/{key}/image|icon` with authentication. Maximum 300 requests per IP per 15 minutes (cache hits do not count). Dismissing a card converts the bare URL into `[Title](url)` (named markdown links do not show preview cards), syncing the preference with the note; "Show link previews" under Appearance is a per-device setting. Disabled in demo mode.

## Speech Recognition

Admins configure it via environment variables (`STT_*`, see above); Administration → Server & Isolation displays the active mode, Whisper server health, and provides a test recording tool. When a Whisper server is configured, each user can choose between Whisper (default) and browser recognition under Account Settings → Voice Input (`users.voice_input`), unless `STT_ALLOW_BROWSER` is set to false; `/auth/status` indicates `voice.browserAllowed`, and the app applies the preference in `lib/voice.ts`. All microphone buttons (Quick Dump bar, mobile capture sheet, holding the + button) share the `useVoiceInput` hook (`frontend/src/lib/voice.ts`, `useVoiceInput.ts`): `server` records and displays "Transcribing..." (Quick Dump, capture sheet, and hold-to-talk stream audio in chunks while speaking, mimicking dictation), `browser` streams transcribed text in real time while speaking and finishes after 5 s of silence, and `off` or an unsupported browser hides the microphone button. In server mode, waveform bars reflect real microphone levels (`VoiceWave`), and recordings automatically stop after `STT_MAX_SECONDS`. The browser records using `MediaRecorder` (WebM/Opus, or MP4/AAC in Safari) and POSTs audio to `/voice/transcribe`; MindSift proxies it to `STT_URL/v1/audio/transcriptions` (`model`, `language`) and returns only the transcript. Nothing is stored or logged except errors (`internal/api/voice.go`). On startup, MindSift waits for the Whisper server and initiates model download if not already cached (`POST /v1/models/<id>` on speaches).

`docker-compose.yml` includes the `whisper` service (speaches 0.8.3, CPU) as a commented-out block: uncomment it, set `STT_URL=http://whisper:8000` in `.env`, and run `docker compose up -d`; model data resides in `./whisper` (directory owned by UID 1000). Benchmark on a 16-core desktop CPU (int8) for a 4-second sentence: `Systran/faster-whisper-small` takes 1.6 s, `deepdml/faster-whisper-large-v3-turbo-ct2` takes 8 s with significantly higher accuracy (RAM approx. 1 GB vs. 2 GB). On shared vCPUs, expect higher latency.

## Background Job: Alarms

`startAlarmTicker` checks every minute for all open, unnotified tasks with due dates. Once the alarm time is reached (due time or 9:00 AM for all-day tasks, minus user lead time, evaluated in timezone `TZ`), it sends notifications across user-configured channels (`email`, `discord`, `webhook`) and marks `alarm_sent` once at least one channel succeeds. After 3 unsuccessful attempts, it stops retrying (`alarm_failures`). Details and limitations: [modules/tasks.md](modules/tasks.md).

## Background Job: Note Sync Compaction

`startCompaction` runs at startup and every 6 hours thereafter: purges expired leases and in-memory sessions, log entries older than 30 days (private notes: 7 days), tombstones older than 30 days, and idempotency results older than 90 days. Details: [database.md](database.md#note-log-compaction).

## Build

```
Stage 1  node:22-alpine   tsc, vitest, vite build            → frontend/dist
Stage 2  golang:1.27      go vet, go test, go build          → /app/mindsift (dist is embedded)
Stage 3  alpine:3.24      binary only, ca-certificates, tzdata
```

**Image tags (CI):** Push to `dev` → `:dev`; Push/merge to `main` → `:latest`; Git tag `v*` (e.g. `v1.2.0`) → `:v1.2.0` and `:stable`; pre-releases (`v1.2.0-rc.1`) only `:v1.2.0-rc.1`, `:stable` remains unchanged. Other branches are not built.

**Security scan (CI):** `ci/trivy-scan.sh` runs Trivy on the image before it is pushed and fails on known HIGH/CRITICAL vulnerabilities that have a fix, or on leaked secrets. It runs for every tag, and for branches only when `Dockerfile`, `go.mod` or `go.sum` differ from the image last published under that tag (label `io.mindsift.deps`, decided in `ci/build-plan.sh`). `.github/workflows/security-scan.yaml` scans the published `:stable` and `:latest` every Monday and reports to GitHub's security tab.

**Versioning:** From v0.6.0 onwards following [Semantic Versioning](https://semver.org/spec/v2.0.0.html): `MAJOR.MINOR.PATCH`, three-part tags prefixed with `v` (`v0.6.0`, `v1.0.0-rc.1`). While major version is 0, breaking changes (API, data formats, configuration) increment the minor version, bug fixes increment the patch version. Any user- or operator-facing change is recorded in [CHANGELOG.md](../CHANGELOG.md) under "Unreleased" (following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)); upon release, the section becomes the version heading with date, and `frontend/package.json` is updated with the version number.

The displayed version (app header) is injected by build arg `APP_VERSION`: CI supplies the tag name on Git tags (`v0.6.0`), otherwise the app displays the version from `frontend/package.json` with `-dev` suffix (`v0.6.0-dev`). Implemented in `frontend/vite.config.ts` and `frontend/src/version.ts`.

Tests run during image build (frontend: `npm run test:run`, backend: `go test -v ./...`); failures abort the build. Frontend tests are located under `frontend/src/**/__tests__/` (Vitest + jsdom + Testing Library, setup in `frontend/src/test/setup.ts`).

## Background Job: Backups

[backups.go](../internal/api/backups.go) / [backup.go](../internal/storage/backup.go): When "Automatic Backups" is enabled in admin settings, the job runs once daily at the configured time (`backup_time`, timezone `TZ`; missed runs due to restarts are made up on the same day):
- `backups/system/mindsift-db-YYYY-MM-DD-HHMM.db.gz`: Complete database dump via `VACUUM INTO` (consistent snapshot even while writes occur), gzipped.
- `backups/users/<id>/mindsift-backup-….zip`: The same ZIP as generated by "Download Backup" for every active user account, including images and audio from personal notes under `media/`.
- **Note:** The database dump does not include media files. When backing up the host server, back up the entire `data/` folder (database, `media/`, `backups/`).
- Files older than `backup_retention_days` (default 3) are pruned subsequently. Files are written via `.part` and renamed atomically; partial backups never appear in the list. The API only serves files matching this exact naming scheme.
- Backup schedules are disabled in demo mode. Restoring a database snapshot: stop the container, replace `mindsift.db` with the uncompressed file, start the container. Users can restore their individual backups in account settings, optionally scoped to individual modules (notes, tasks, lists, inbox, themes).

## Background Job: Retention

[retention.go](../internal/storage/retention.go), initialized in `internal/api/done_cleanup.go`: Each user can configure retention in Account Settings → Retention per domain: 7, 14, 30, 90, 365, or 730 days, or never. Every hour, completed tasks exceeding the retention period are moved to the tasks trash (`trashed_tasks`); items in the tasks trash, triage trash (discarded thoughts), notes trash, and checked-off list items are permanently purged once expired. In shared task lists, lists, and notes, the owner's retention period governs. Items already completed or trashed when retention was introduced count from that point in time (`system_settings.retention_since`). Setting `RETENTION_ALLOW_NEVER=false` (or disabling "Allow permanent retention" in Administration → Server & Isolation) removes the "never" option; existing "never" selections fall back to the section default.

## Offline (PWA)

- **Service Worker** ([public/sw.js](../frontend/public/sw.js)): Network-first strategy for navigation requests with the last-cached `index.html` as fallback, assets under `/assets/` (content-hashed names) served cache-first, icons and manifest served stale-while-revalidate. API requests are never intercepted. Stale caches are invalidated when a new `VERSION` activates; asset bundle cache is capped at 80 entries.
- **Read Cache** ([lib/offline.ts](../frontend/src/lib/offline.ts)): Every successful GET response is cached per user in IndexedDB (`mindsift-offline`). When offline, `request()` returns the latest cached response, allowing the app to open offline in an authenticated state with thoughts, tasks, and lists accessible. Exceptions: streams, long polling, note sync (dedicated storage, [modules/collaboration.md](modules/collaboration.md)), exports, search. Logging out purges cache and queues, and the stored notes (see below); a rejected session (401) purges cache and queue but keeps the stored notes, so text typed offline survives an expired session.
- **Outbox Queue:** Thoughts captured offline (`POST /inbox`) and checked/unchecked tasks or list items (`PATCH`) are queued in `localStorage`; rapid toggles only send the final state. Queued actions are replayed in order upon the `online` event, on app launch, and every 30 s while items remain pending; requests rejected by the server with 4xx errors are dropped. Other modifications still require an active connection.
- **New Version Detection:** Each build writes `version.json` (version and build commit) next to `index.html`, never cached. The app compares it with its running version when switching back to the tab/app, every 5 minutes, when the browser is online again, and after server restarts (reconnected real-time channel), displaying "New version available" with an "Update now" prompt ([lib/useUpdateCheck.ts](../frontend/src/lib/useUpdateCheck.ts)).
- **Per-Tab State:** Active view (triage, workspace, tasks, etc.), active note, and selected list are preserved in `sessionStorage` ([lib/viewSession.ts](../frontend/src/lib/viewSession.ts)) across page reloads.
- **Status Indicator:** A banner above the bottom navigation displays "Offline" along with the pending change count, or "Syncing...".
- **Connection Status in Header** ([lib/useConnectionState.ts](../frontend/src/lib/useConnectionState.ts)): Determined by the app-wide real-time connection status rather than `navigator.onLine`, reliably detecting server outages. WebSocket or SSE: **online**. Long polling only (e.g. proxy buffering SSE): **degraded**, updates arrive with slight delay. If all connections drop for more than 4 s (smoothing over initial launch and momentary reconnects), the app pings `/api/v1/health` (then polls every 15 s): if the server responds, status is **degraded**, otherwise **offline**. If device network is disconnected, status becomes **offline** immediately. Rendered as a green/yellow/red dot: desktop shows text below user name, mobile displays indicator on avatar.

## App Icons, PWA & Social Preview (Open Graph)

MindSift uses a unified app icon design across all platforms, matching the icon in the mobile app header:
- **Design & Geometry:** Softly rounded square (`rx=108` on a 512x512 canvas or `rounded-xl`), primary blue (`--accent-primary: #2563eb`) background, and centered Lucide Brain icon in pure white (`--text-on-accent: #ffffff`).

### Asset Matrix (`frontend/public/`)

| File | Purpose & Target Platform | Details |
|---|---|---|
| `icon.svg` | Modern default icon & SVG favicon | Vector original with rounded corners |
| `icon-192x192.png`, `icon-512x512.png` | PWA installation (`purpose: "any"`), desktop Linux/Windows | Required for Chromium on Linux (otherwise fails to generate `.desktop` icon) |
| `icon-maskable-192x192.png`, `icon-maskable-512x512.png`, `icon-maskable.svg` | Android adaptive icons (`purpose: "maskable"`) | Full-bleed background (`#2563eb`) without transparent corners, brain in 80% safe zone |
| `apple-touch-icon.png` (180x180) | iOS Safari ("Add to Home Screen") | Opaque background prevents black borders during Apple's automatic squircle masking |
| `favicon.ico`, `favicon-32x32.png`, `favicon-16x16.png` | Browser tabs, bookmarks, history | Multi-resolution ICO (16/32/48) for all desktop browsers |
| `og-image.png` (1200x630), `og-image-square.png` (512x512) | Link previews in WhatsApp, Discord, Telegram, X/Twitter | Dark `#0b0f19` background with icon & claim; file size < 120 KB (WhatsApp limit < 300 KB) |

### Dynamic OpenGraph URL Injection

Messenger crawlers (especially WhatsApp) often fail to resolve relative image URLs in `og:image`. When serving `index.html`, the Go SPA handler in [`internal/api/server.go`](../internal/api/server.go) dynamically substitutes relative paths (`/og-image.png`, `og:url`) with the absolute server origin (`scheme://host`), determined via `X-Forwarded-Proto` and `X-Forwarded-Host` or `req.Host`.
