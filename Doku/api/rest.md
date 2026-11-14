# REST API

Base: `/api/v1`. Responses are JSON; errors take the form `{"error": "Text"}`, some with a stable `code` for clients to react to (`email_unverified` on login). Error texts follow `Accept-Language` when MindSift speaks it, else the server's default language (the admin's choice or `DEFAULT_LANGUAGE`), else English, so a script or `curl` without the header gets English errors on a server nobody set a language for; the language used is returned as `Content-Language`. Unexpected failures (`500`) say only "Internal error"; their details (SQL, paths) go to the server log, not to clients or agents. A path under `/api/` that does not exist answers `404` with JSON. Every `GET` route also answers `HEAD` (same status and headers, no body), so `curl -I` and uptime monitors work on `/api/v1/health` and `/`; an API key needs the same scope for it as for `GET`. MCP always answers in English. Authentication via `Authorization: Bearer <JWT>`. **API keys** (`Bearer mindsift_sec_…` or header `X-API-Key`) have scopes that apply equally to REST and [MCP](#mcp-for-ai-agents-post-apiv1mcp), see [API Keys](#api-keys-scopes-and-origin). Everything else, including notes, settings, and live streams, responds to an API key with `403`. Timestamps are ISO-8601 (UTC). Request bodies are limited to 2 MB (note sync 8 MB, imports 101 MB). In demo mode, endpoints that send messages/emails, modify server settings, or alter shared demo accounts respond with `403` "Disabled in demo". The source of truth is the route definitions in [server.go](../../internal/api/server.go); [openapi.json](openapi.json) lists every route with a short description, and a test (`internal/api/openapi_test.go`) fails when a route is missing there or an entry has no route. Request and response schemas are not in it yet.

## Public

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check; `?db=1` also asks the database (at most 2 s) → `{"database": "ok"}` or `503` with `"unreachable"`. Outside `/api/v1`: `GET /metrics` (Prometheus text format) only with `METRICS_TOKEN`, sent as `Authorization: Bearer …` (`401` otherwise); without the variable `/metrics` is `404` |
| GET | `/auth/status` | `needsSetup`, `setupCodeRequired` (`true` while no account exists and the server logged a setup code, i.e. not in demo mode and without `ADMIN_USER`), `allowRegistration`, `instanceName`, `demoMode`, `sharingMode`, `legal` (`imprintUrl`, `hasImprintContent`, `privacyUrl`, `hasPrivacyContent`, `customLinkLabel`, `customLinkUrl`), `voice` (`mode` = `server`/`browser`/`off`, `maxSeconds`, `browserAllowed`), `mcpEnabled`, `mcpConnectorUrl`, `passkeys` (the login offers "Sign in with a passkey": `BASE_URL` with https or `http://localhost`, not in demo mode), `oidc` (`enabled`, `name`: the login offers "Sign in with <name>"), `passwordLogin` (`false` with `OIDC_PASSWORD_LOGIN=false`: only administrators sign in with a password, at `/?login=password`), `defaultLanguage` (the server's default language: admin setting, else `DEFAULT_LANGUAGE`, else `de`); `setup` only while no account exists, for the first-boot wizard: `smtpConfigured`, `smtpViaEnv` (`SMTP_HOST`), `baseUrlSet`, `emailLinks` (mails with links can go out), `backupDir` (as `GET /admin/setup/status`, without the host) |
| GET | `/legal/{imprint\|privacy}` | Stored Markdown text (`content`), without login; `404` if none set |
| POST | `/share-target` | PWA Web Share Target fallback: redirects to `/` (`303 See Other`) if service worker is still inactive |
| POST | `/auth/setup` | First administrator account (`email`, `password`, `displayName`, `instanceName`, `allowRegistration`, `sharingMode`, `createSampleData`, `defaultLanguage`: becomes the server's default language and the admin's own, `400` for unknown codes; `backupEnabled`, `backupTime` (`HH:MM`, server time zone), `backupRetentionDays` (1–365): daily backups as in the admin settings, left out = unchanged (off, `03:00`, 3 days on a new server), `400` for another time format or retention, before the account is created; `timeZone`: the server's time zone as in the admin settings (IANA name, `""` = not set), in effect at once, left out = unchanged, `400` for an unknown zone; `smtp`: the mail server with the field names of the admin settings (`smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, `smtpFrom`, `smtpFromName`, `smtpTls`, `smtpSkipVerify`), stored into them, left out = unchanged, `400` without host or with a port outside 1–65535); only while no accounts exist (`403` afterwards, also when `ADMIN_USER`/`ADMIN_PASSWORD` created the admin at startup). `setupCode`: the one-time code the server writes to its log at startup when it has no account (not in demo mode, not with `ADMIN_USER`), `XXXX-XXXX-XXXX`, case, spaces and dashes do not matter; kept in memory only (a restart makes a new one) and gone once the admin exists. Without it `403` with `code` `setup_code_required`, a wrong one `403` `setup_code_invalid`; three wrong codes from one address lock wrong codes out for 15 minutes (`429` with `code` `setup_locked`); the right code still goes through from a locked address (behind a proxy everyone may share one). The code is checked before anything else of the body. The body must be sent as `Content-Type: application/json` (`415` otherwise). Sample data comes in German for German accounts, otherwise in English |
| POST | `/auth/verify-email` | Link from verification email (`token`): activates account or forwards it to pending approval (`{"verified","pending","message"}`) |
| POST | `/auth/confirm-email` | Link from the mail confirming a new login address (`token`, no sign-in needed): takes the address (`{"confirmed","kind":"account","message"}`); `400` for an unknown, used or expired link (48 hours), `409` if the login address got taken meanwhile. A confirmed login address also tells the previous address |
| POST | `/auth/resend-verification` | Resend verification link (`email`); always responds identically, at most once every 2 minutes per account |
| POST | `/auth/register` | Registration (`email`, `password`, `displayName`, `inviteCode`); always allowed with code, otherwise depending on registration mode. `201` with token or `202 {"pending":true,"verify","message"}` if email verification (`verify`) and/or admin approval is required (login returns `403` until then); `429` after 20 attempts per address in 15 minutes or when more than 50 accounts are pending approval. With `OIDC_PASSWORD_LOGIN=false`: `403` `password_login_off`. While no account exists: `403` `setup_required` (the first account comes from `/auth/setup` or `ADMIN_USER`) |
| POST | `/auth/login` | Login (`login`/`email`/`username`, `password`) → `{token, user}`. `login` is the email address or the username; typed like a display name ("Sandro Dach") it is read as the username (`sandro.dach`), and the part of the email before the @ still works. The display name itself does not sign in. With two-factor sign-in on and no valid `trustTokens` (the browser's trusted-device tokens, at most 10 are looked at) the answer is `{mfaRequired: true, mfaToken, methods, expiresIn}` instead of a token; the second step follows. Two-factor sign-in is on when the account has an authenticator app or a passkey; `methods` lists `totp` (app on), `passkey` (account has passkeys and the server offers them) and always `recovery`. With `OIDC_PASSWORD_LOGIN=false` only administrators (emergency access): everybody else gets `403` `password_login_off` after a right password (a wrong one answers as before); the same for the passkey sign-in. An account created through the OIDC provider has no password and never signs in here |
| POST | `/auth/login/mfa/passkey/options` | Second step with a passkey, part 1: `{mfaToken}` → `{options}` for `navigator.credentials.get()` (the account's passkeys in `allowCredentials`, `userVerification: "required"`); each call replaces the challenge of the one before. `401` `mfa_expired` as below, `409` without passkeys, `404` (`passkeys_off`) when the server offers none |
| POST | `/auth/login/mfa/passkey` | Second step with a passkey, part 2: `{mfaToken, credential, trustDevice}` (`credential`: the browser's `PublicKeyCredential` as JSON, binary fields base64url) → as `/auth/login/mfa` with `method: "passkey"`. The challenge is used up by every answer; a refused answer is `401` `mfa_invalid` and counts like a wrong password |
| POST | `/auth/oidc/start` | Sign-in through the OpenID Connect provider: `{return}` → `{url, bind, expiresIn}`. `url` is the provider's authorization address (code flow, PKCE S256, `state`, `nonce`), `bind` a random value the app keeps until the return (it is checked against its hash at the exchange; no cookies). `return` is an own path to come back to (`/`, `/oauth/authorize?…`; anything else becomes `/`). `404` while OIDC is off (not configured, no `BASE_URL`, demo), `503` `oidc_unavailable` while the provider's discovery fails, `403` before the first setup, `429` (60 per address and 15 minutes, with the exchanges) |
| GET | `/auth/oidc/callback` | Where the provider sends the browser (redirect URI `<BASE_URL>/api/v1/auth/oidc/callback`). Exchanges the code, checks the ID token, finds, links or creates the account, then `303` to the return path with `?oidc=<ticket>` (one-time, 2 minutes) or `?oidc_error=<code>`: `cancelled`, `expired` (unknown or used `state`, flow older than 10 minutes), `unavailable`, `failed` (a check failed; details in the server log), `no_account` (`OIDC_AUTO_CREATE=false`), `disabled`, `pending`, `unverified`, `setup`; after `/auth/oidc/confirm` also `wrong_account`, `not_fresh` (the provider did not ask for the sign-in again), `linked_elsewhere`, `already_linked` |
| POST | `/auth/oidc/exchange` | `{ticket, bind}` → `{token, user}` after a sign-in: a session started through the provider (`via: oidc`), never asked for a second factor by MindSift. After a confirmation or link, sent with the session that asked for it (`Authorization`): `{confirmed: true, linked, expiresIn: 300}`. `401` `oidc_expired` for an unknown, used or expired ticket, a `bind` that does not match, or another session |
| POST | `/auth/login/passkey/options` | Sign-in without password, part 1: → `{token, options, expiresIn}`: a challenge for any passkey of this server (no `allowCredentials`, also for `mediation: "conditional"`, the autofill of the login field), valid 5 minutes and once. Says nothing about accounts. `404` (`passkeys_off`) without an https `BASE_URL` and in demo mode |
| POST | `/auth/login/passkey` | Sign-in without password, part 2: `{token, credential}` → `{token, user}`. User verification is required, so the passkey alone counts as both factors (no second step, no trusted device needed). The same account checks as the password login (`403` with `email_unverified`, waiting for approval, disabled). `401` `passkey_invalid` (unknown passkey, wrong origin or relying party, no user verification, signature counter went back; counts like a wrong password, `429` when locked) or `passkey_expired` (unknown, used or expired `token`) |
| POST | `/auth/login/mfa` | Second step: `{mfaToken, code, trustDevice}` → `{token, user, method, recoveryCodesLeft, trustToken?, trustedDeviceId?}`. `code` is the app's six digits or a recovery code (any case, with or without dash); each app code and each recovery code works once. `trustDevice` returns a `trustToken` that spares the code on this device for 30 days (send it as `trustTokens` at the next login). `401` with code `mfa_invalid` for a wrong code (counts like a wrong password, `429` when locked) or `mfa_expired` when the mfaToken is unknown, older than 5 minutes, used, took 5 wrong codes or the password changed meanwhile (sign in with the password again) |
| POST | `/auth/forgot-password` | `{email}` → always `{ok: true}`; email with link sent only if the account exists. `503` if SMTP or `BASE_URL` is missing; `429` after 10 requests per address in 15 minutes |
| POST | `/auth/reset-password` | `{token, password}` (8 to 1024 characters, as for every new password) → new password, terminates all sessions and ends trusted devices; two-factor sign-in stays on; `400` on invalid or expired link |
| POST | `/webhooks/ingest` | Ingest via webhook, key as `X-API-Key` (recommended), Bearer or `?token=` (URL parameter accepts only API keys, no session tokens). Body: `title`/`content`/`text`/`message`, `priority`, `source`, `tags`, `dueDate`; `target` (or `type`): `triage` (default, inbox), `task` (optional `taskListId`), `list_item` (`listId`, `category`, `quantity`). Plain text body is treated as content. `403` without matching scope or without write permission on the list. The alternative field names (`title`/`content`/`text`/`message`, `dueDate`/`due_date`, `target`/`type`) are accepted on purpose, so the payloads of different tools work without a mapping |
| GET | `/ws`, `/ws/lists/{id}` | WebSocket, see [websocket.md](websocket.md); `?ticket=` or `Authorization` header |
| GET | `/events` | SSE fallback; `?ticket=` or `Authorization` header |

## Account and General (Authenticated)

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/me` | User profile and metrics (`user.tourOffered`: the app already asked about the guided tour, see `PATCH /auth/settings`); `setupPending` (admins only) when the first admin came from `ADMIN_USER` and the wizard's instance settings are still open (`POST /admin/setup`); `mfaSetupRequired` when the administration requires a second factor (`mfaRequired` in `/admin/settings`) that the account has not set up yet. Until it is, a session gets `403` with code `mfa_setup_required` from every request except `GET /auth/me`, `POST /auth/logout` and `/auth/mfa…`, the live streams (`/ws`, `/events`) and `POST /webhooks/ingest` included (API keys are not affected). `user.noPassword` (an account from the OIDC provider without a password of its own) and `user.oidc` (linked to the provider); `mfaSetupRequired` is never set for a session started through the provider |
| GET | `/third-party-licenses` | The licenses of the third-party software in this build as `text/plain` (`THIRD_PARTY_LICENSES.txt` next to the binary); signed-in only, as it names every dependency's version. `404` where there is none (development) |
| POST | `/events/rooms` | Join/leave SSE room (`sseId`, `room`, `action`); own `sseId` only, rooms with read access only |
| POST | `/events/poll` | Open long-polling connection (`rooms` optional) → `{pollId}`; requires session |
| GET | `/events/poll/{pollId}?wait=25` | Retrieve buffered events, waits up to `wait` s → `{events}`; `404` = expired |
| POST | `/auth/stream-ticket` | One-time ticket (60 s) for WebSocket/SSE |
| POST | `/voice/transcribe` | Only in server mode for voice recognition: `multipart/form-data` with `file` (recording, e.g. WebM/Opus or MP4/AAC) → `{text}`. `404` without `STT_URL`, `413` too large, `429` hourly rate limit, `503` busy, `502` Whisper error (details in log) |
| POST | `/auth/logout` | Terminate session of this device |
| GET | `/auth/sessions` | Logged-in devices: `[{id, createdAt, lastUsedAt, userAgent, ip, current}]` |
| DELETE | `/auth/sessions/{id}` | Log out a device; `404` on unknown session or one belonging to another user |
| POST | `/auth/revoke-all` | Terminate all sessions (`token_version` +1); also ends the trust of every trusted device |
| GET | `/auth/mfa` | Two-factor state: `{available (false in demo mode), enabled (app or passkey), totp: {enabled, enabledAt}, passkeys: [{id, name, createdAt, lastUsedAt, synced}], passkeysOff, recoveryCodesLeft, trustedDevices: [{id, userAgent, createdAt, expiresAt, lastUsedAt}], trustDays}`. `passkeysOff` says why passkeys cannot be used here (`demo`, `no_base_url`, `not_https`, `ip_address`), empty when they can; `synced`: the passkey is kept in a backup (password manager, iCloud, Google) |
| POST | `/auth/mfa/totp/setup` | `{password}` → `{secret, uri}`: a new secret (base32) and its `otpauth://` address for the QR code, waiting for the first code; `403` for a wrong password (counts like a failed login), `409` while the app is on. When the account has passkeys a second factor is needed too (`code` with a recovery code, or `passkeyToken` and `passkey`, see `/auth/mfa/passkeys/challenge`). `403` in demo mode |
| POST | `/auth/mfa/totp/confirm` | `{code}` → `{recoveryCodes, enabledAt}`: the first code switches the app on; the ten recovery codes are returned only here, and only when the app is the account's first second factor (with passkeys the codes stay and `recoveryCodes` is empty). `400` (`mfa_invalid`) for a wrong code, `409` without a waiting setup or when already on. `403` in demo mode |
| POST | `/auth/mfa/totp/disable` | `{password, code}` (`code`: the app's or a recovery code; or `passkeyToken` and `passkey` instead) → `{disabled, mfaOff}`: removes the app; without passkeys also the recovery codes and the trusted devices (`mfaOff: true`, two-factor sign-in is off). `403` for a wrong password or second factor (`mfa_required`, `mfa_invalid`; both count like failed logins), `409` when off. `403` in demo mode |
| POST | `/auth/mfa/recovery-codes` | `{password, code}` (or `passkeyToken` and `passkey`) → `{recoveryCodes}`: ten new codes, the earlier ones stop working. Errors as for `disable` |
| POST | `/auth/mfa/passkeys/challenge` | → `{passkeyToken, options}`: a passkey confirms a sensitive change instead of a code. Answer the options with `navigator.credentials.get()` and send `passkeyToken` and the answer as `passkey` with the change (`setup`, `disable`, `recovery-codes`, passkey `register/options` and `DELETE`). Valid 5 minutes and once, bound to the account. `409` without passkeys, `404` (`passkeys_off`) when the server offers none |
| POST | `/auth/mfa/passkeys/register/options` | Add a passkey, part 1: `{password}` plus a second factor (`code` or `passkeyToken` + `passkey`) when the account has one → `{token, options}` for `navigator.credentials.create()`: discoverable credential (`residentKey: "required"`), `userVerification: "required"`, no attestation, the account's passkeys in `excludeCredentials`. The user handle is the account id. Errors as for `totp/disable`; `404` (`passkeys_off`) |
| POST | `/auth/mfa/passkeys` | Add a passkey, part 2: `{token, name, credential}` → `201 {passkey, recoveryCodes?}`. `name` up to 60 characters (`400` when empty). The account's first second factor (no app, no passkey yet) returns ten recovery codes, only here. `400` `passkey_invalid` (wrong origin or relying party, no user verification), `409` `passkey_expired` (unknown, used or expired `token`), already set up, or more than 20 passkeys |
| PATCH | `/auth/mfa/passkeys/{id}` | Rename: `{name}` → `{name}`; `404` for a passkey of another account. `403` in demo mode |
| DELETE | `/auth/mfa/passkeys/{id}` | Remove: `{password}` plus a second factor (`code` or `passkeyToken` + `passkey`) → `{removed, mfaOff}`. The last second factor (no app, no other passkey) switches two-factor sign-in off: the recovery codes and trusted devices go too (`mfaOff: true`). Errors as for `totp/disable`, `404` when unknown. `403` in demo mode |
| DELETE | `/auth/mfa/trusted-devices` | Forget every trusted device (each asks for a code again). `403` in demo mode |
| DELETE | `/auth/mfa/trusted-devices/{id}` | Forget one trusted device; `404` when unknown. `403` in demo mode |
| POST | `/auth/oidc/confirm` | `{return, link?, password?, code \| passkeyToken + passkey}` → `{url, bind, expiresIn}`, sessions only. Without `link`: sign in at the provider again (`prompt=login`, `max_age=0`) to confirm sensitive changes; after `/auth/oidc/exchange` the session counts as confirmed for 5 minutes. Needed where the server answers `403` `oidc_confirm_required`: a new address, password, deleting data or the account, second factors of an account without a password of its own, and creating an API key in a session from the provider without a second factor in MindSift. `409` when the account is not linked. With `link: true`: ties the account to the provider (for an account whose address differs); needs the password and second factor first (errors as for `PATCH /auth/settings`), `409` when already linked |
| PATCH | `/auth/settings` | `displayName` (`""` stores the username as the name), `username` (2–32 characters, lower case letters, digits, `.`, `-`, `_`; `400` with code `username_invalid`, `409` with `username_taken`, also when another request took the name a moment earlier; `403` in demo mode), `email`, `password`, `avatarUrl`, `alarmChannels`, `discordWebhookUrl`, `customWebhookUrl`, `notifyBeforeMinutes`, `retention` (`doneTasks`, `taskTrash`, `triageTrash`, `noteTrash`, `listDone`: days selected from 7, 14, 30, 90, 365, 730, or 0 = never; always all five, `400` on other values or for 0 if the server has disabled "never"), `voiceInput` (`""` = Whisper server, `browser`), `voiceLanguage` (language spoken into the microphone: `""` (default) or `auto` = Whisper detects it, `app` = the app language, or one of Whisper's language codes such as `ru`; `400` for unknown codes), `language` (`de`, `en`, `es`, `fr`, `it` or `""` = follow the browser, then the server's default; `400` for other codes; `GET /auth/me` returns it as `language`), `doneRetentionDays` (legacy single field for `retention.doneTasks`), `tourOffered` (`true` once the app asked whether to take the guided tour, whatever the answer; ignored in demo mode, where each browser remembers it). `GET /auth/me` includes `retention`, `retentionNeverAllowed` and `tourOffered` (`false` for a new account; accounts that existed before the offer count as asked). `notificationSettings` (`paused`, `includeOwnWatched`, `events.{due,shared,assigned,mentioned,taskCreated,taskDone,watched}.{email,discord,webhook,push}`, `dailySummary.{enabled,time,email,discord}`) for notifications. New `email` or `password` requires `currentPassword` (`403` if incorrect, `429` if login locked; wrong guesses count like failed logins), and with two-factor sign-in on also a second factor: `code` (the app's or a recovery code) or `passkeyToken` and `passkey` (see `/auth/mfa/passkeys/challenge`); without one `403` with code `mfa_required`, a wrong one `403` `mfa_invalid`. A new `email` (login address, `409` if taken) is not taken at once: it waits for the click on a link mailed to it and shows as `pendingEmail`, the old address stays in use (without a mail server it keeps waiting; `emailLinks` says whether links can go out). Mail alarms and summaries go to the login address; there is no address of their own (an `alarmEmail` sent along is ignored). `avatarUrl` is `""`, an emoji or an uploaded picture as `data:image/(png|jpeg|webp);base64,…` up to 300 KB (`400` otherwise); after password change, other devices are logged out and the new token is returned in the `X-Session-Token` header |
| POST | `/auth/alarms/test` | Test alarm (`channel`: `email`/`discord`/`webhook`, optional `target` for Discord and webhook). E-mail tests always go to your confirmed login address, a `target` is ignored; 5 tests per person within the lock window (`429`) |
| DELETE | `/user/email-change/{kind}` | Drop the waiting new login address (`kind`: `account`); the current one stays |
| POST | `/user/email-change/{kind}/resend` | Mail the link for the waiting address again (at most every 2 minutes; `503` without mail server; `403` in demo mode) |
| GET | `/users/directory`, `/collaborators` | People whose names you may see: everyone you may share with (`findable: true`, only while people search is on) and everyone you work on something together with (`findable: false`); `/collaborators` without yourself ([sharing-and-permissions.md](../sharing-and-permissions.md)). Only public profile per person: `id`, `username`, `displayName`, `avatarUrl`, `findable` – no e-mail address and no private details (webhooks, alarm email, role, organizations). Member and share lists of notes, folders, lists, task lists and groups carry names only, no addresses |
| GET | `/notifications?limit=50` | Notification center: `items` (newest first: `id`, `kind`, `title`, `text`, `targetType` `task`/`note`/`list`/`tasklist`/`folder`, `targetId`, `blockId`, `createdAt`, `read`) and `unread`. Holds every event regardless of channels and pause; own actions and muted lists stay out; entries are removed after 14 days |
| POST | `/notifications/read` | Mark as read: `ids` (none: all). `204`; sends `NOTIFICATIONS_READ` to the person's other apps |
| DELETE | `/notifications` | Delete all of one's entries. `204`; sends `NOTIFICATIONS_CLEARED` |
| GET | `/mentions/candidates?docId=…` \| `?taskId=…` \| `?taskListId=…` | People for the @-mention picker at that place: the directory plus everyone with access, without yourself; `hasAccess` says whether the person can see the place (the others are shown greyed out). `404` without access to the place |
| POST | `/users/lookup` | One person by exact e-mail address or username (`login`), for sharing without people search or when the address is typed in (the answer carries `email` only if `login` was one); `404` alike for unknown people and people you may not share with; 30 lookups per user and address within the lock window |
| GET | `/stats` | Counters for the dashboard (including `inboxCount`, `tasksOpenCount`, `listItemsOpenCount` = open items across all visible lists) |
| GET | `/search?q=` | Global FTS5 search across accessible notes (title & blocks), tasks, and lists → `{thoughts, documents, listItems, hits, counts}`. Open tasks and list items appear before completed ones. Optional: `type` (`document`/`thought`/`list_item`), `limit` (matches per type, default 40, max 200), for tasks `taskStatus` (`open`/`done`), `taskListId` (`personal` = without list), `priority`, `due` (`today`/`overdue`/`week`), for notes `folder` (including subfolders), for lists `listId`, `itemStatus` (`open`/`done`). Matches in bullets include `content` (raw text of the bullet), with `context=1` also `before`/`after` (text of adjacent bullets); `documents` holds only `id`, `title` and `icon` of the matched notes; `counts` = matches per type in this response |
| GET | `/export` | Data export as JSON; with `?format=zip`, the same data as `mindsift-backup.json` inside a ZIP, next to it the workspace as a Markdown vault in `Obsidian/` (same content as `/export/markdown`, images and audio in `Obsidian/attachments/`; used by UI for backup downloads) |
| GET | `/export/markdown` | Obsidian-compatible ZIP (`mindsift-vault-DATE.zip`), streamed directly: notes as `.md` with YAML frontmatter in user's folder hierarchy (including shared ones), `Aufgaben/<List>.md` in Tasks plugin format (`📅`, `⏫`/`🔺`), `Listen/<List>.md` (folder names in the user's language, e.g. `Tasks/`, `Lists/`; the import reads them in every language) |
| GET/POST | `/themes` | Custom CSS themes; create or update with `id` (`name`, `css`, max 200 KB) |
| DELETE | `/themes/{id}` | Delete custom theme |
| POST | `/import/mindsift`, `/import/obsidian` | Import (multipart field `file`, max 100 MB): MindSift JSON/archive or Obsidian vault ZIP; `?preview=1` returns only the summary (`folders`, `notes`, `taskLists`, `tasks`, `lists`, `listItems`, `inbox`, `skipped`). Limits: 500 MB unpacked in all, 2 MB and 20,000 bullets per note, 100 MB per image or recording, 20,000 files, 100,000 tasks and list items; an entry that unpacks to more than 100 times its packed size (over 1 MB) is skipped. Notes and files over a limit are listed in `skipped` with the reason. One import per person and two per server at a time (previews and `/backups/{name}/restore` included), otherwise `429` with `Retry-After` |
| — | `/import/mindsift?mode=restore` | Restore: deletes all own notes, folders, tasks, thoughts, and lists prior to import (only after the file has been completely read and validated) |
| DELETE | `/user/data` | Delete all personal user data, account remains (`{"password"}` required, with two-factor sign-in on also `code` or `passkeyToken` + `passkey` as for `PATCH /auth/settings`; wrong guesses count like failed logins: `403`, then `429`; 403 in demo mode) |
| DELETE | `/user/account` | Delete user account along with all data (`{"password"}` required, plus the second factor as for `/user/data`); `403` for the last server admin. `/auth/me` provides `isLastAdmin` for this purpose |
| GET | `/backups`, `/backups/{name}` | List or download own automatic server backups |
| POST | `/backups/{name}/restore` | Restore server backup: `mode=merge` or `restore` (clears selected sections beforehand), `sections=notes,tasks,lists,inbox,themes`, `preview=1` |
| GET/POST | `/keys` | List or create API keys (plain text revealed only upon creation); `POST` with `name` and `scopes` (`webhook:triage`, `webhook:task`, `webhook:list`, `tasks:read`, `tasks:write`, `lists:read`, `lists:write`, `notes:read`, `notes:create`, `notes:write`, `inbox:read`, `inbox:write`; default `["webhook:triage"]`; an empty body creates such a key, a body that is not valid JSON gives `400`). A key never asks for a second factor, so with two-factor sign-in on, creating one needs it: `code` or `passkeyToken` + `passkey` (`403` `mfa_required` / `mfa_invalid`) |
| POST | `/mcp` | MCP endpoint for AI agents, see below |
| GET/DELETE | `/mcp` | `405`: no server stream and no sessions (Streamable HTTP, stateless) |
| PATCH | `/keys/{id}` | Update name (`name`) and/or permissions (`scopes`); the key itself remains unchanged |
| DELETE | `/keys/{id}` | Delete API key |

### Global Search (`GET /api/v1/search?q=`)

Performs a full-text search via SQLite FTS5 with BM25 relevance ranking.
- Searches tasks/thoughts (content, notes, subtasks), notes (titles and contents of active blocks), and list items.
- Strictly enforces all access rules: only own thoughts/tasks and those in accessible task lists; only own and shared notes (directly, via groups, or shared folders); only own and shared lists.
- Title matches are weighted higher than body matches.
- Returns backward-compatible collections (`thoughts`, `documents`, `listItems`) as well as structured `hits` with snippets and `<mark>` highlighting:
  ```json
  {
    "thoughts": [...],
    "documents": [...],
    "listItems": [...],
    "hits": [
      {
        "type": "document",
        "id": "blk_123",
        "title": "Project Planning",
        "snippet": "... important note for <mark>Release</mark> ...",
        "docId": "doc_abc",
        "blockId": "blk_123"
      }
    ]
  }
  ```

### MCP for AI Agents (`POST /api/v1/mcp`)
<a id="mcp-für-ki-agenten-post-apiv1mcp"></a>

MindSift is an [MCP](https://modelcontextprotocol.io) server (Streamable HTTP, stateless, JSON-RPC 2.0 only via `POST`; no server stream, `GET` returns `405`, batches are rejected). Authentication as everywhere via `X-API-Key` or `Authorization: Bearer`; a user session can do everything, an API key is restricted to the tools matching its scopes, and `tools/list` only exposes those tools. Protocol versions `2025-06-18`, `2025-03-26`, `2024-11-05`. Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`; notifications return `202`. Tool errors are returned as `isError` results so the agent can read them; results are returned as `structuredContent` (lists as `{items}`) and as JSON text.

The admin settings (`GET`/`PUT /admin/settings`) carry `defaultLanguage`: a supported code; empty in a `PUT` leaves it unchanged, an unknown code gives `400`. Registration and first-time setup start the new account in the browser's language (`Accept-Language`) when MindSift speaks it, otherwise in the default language.

Administrators can disable MCP (`MCP_ENABLED=false` or toggle in administration settings, field `mcpEnabled` in `/admin/settings`). In that case, the endpoint responds with `404`, OAuth is likewise disabled, and `GET /auth/status` returns `mcpEnabled: false`.

| Tool | Scope | Purpose |
|---|---|---|
| `list_task_lists` | `tasks:read` | Task lists with `permission`, open tasks, and board columns (`columns`: valid values for `kanbanStatus`) |
| `create_task_list` | `tasks:write` | Create own task list with default columns (`title`, `icon`) |
| `list_tasks` | `tasks:read` | Tasks (`taskListId`, `status` open/done/all, `dueBefore` YYYY-MM-DD, `limit`); due tasks first |
| `get_task` | `tasks:read` | A single task |
| `create_task` | `tasks:write` | Create task (`content`, `taskListId`, `priority`, `dueDate`, `notes`, `reminders`); source `agent` |
| `update_task` | `tasks:write` | Update fields (`content`, `isCompleted`, `dueDate`, `priority`, `notes`, `kanbanStatus`, `taskListId`, `tags`, `reminders`) |
| `complete_task` | `tasks:write` | Mark completed (`completed` false = reopen) |
| `add_subtask` | `tasks:write` | Append subtask (`taskId`, `title`) |
| `update_subtask` | `tasks:write` | Check off subtask (`completed`), rename (`title`), or remove (`delete`) |
| `delete_task` | `tasks:write` | Delete task (e.g. created accidentally); moves it to task trash |
| `list_lists` | `lists:read` | Shared lists with open items |
| `create_list` | `lists:write` | Create list (`title`, `icon`, `listType` shopping/checklist/vacation) |
| `get_list` | `lists:read` | List with items |
| `add_list_item` | `lists:write` | Add item (`listId`, `content`, `category`, `quantity`) |
| `check_list_item` | `lists:write` | Check off item (`completed` false = revert) |
| `update_list_item` | `lists:write` | Change text, category, quantity |
| `list_notes` | `notes:read` | Notes without content, most recently modified first (`folder` including subfolders, `query` in title, `limit`) |
| `get_note` | `notes:read` | A single note; `content` consists of bullets formatted as an indented Markdown list (tab per level, `- [ ]` for to-dos, tables as Markdown tables, images and audio recordings as placeholders, drawings described in words), `bullets` contains the same bullets with `id`, `level`, `type`, `text`, `checked` |
| `create_note` | `notes:create` | New note (`title`, `content` as Markdown like in import, `folderPath`, `icon`); creating in shared folders requires write permission. Every line of plain text becomes a bullet of its own; `content` may also be a list of strings (one bullet each), and doubly escaped `\n` is read as line breaks. If `content` yields no bullets or the call has unknown arguments, the result carries `warnings` (the note is still created) Fenced ```` ```mermaid ```` blocks become drawings, Markdown tables (header, separator row, rows) become one table bullet. |
| `update_note` | `notes:write` | Change title, icon, or folder of a note |
| `add_note_bullet` | `notes:write` | Add bullet: after a bullet (`afterId`), as the last child (`parentId`), or at the end; `type` text/todo/h1–h3/numbered/callout/warning/error/table, `checked`; `type: table` takes a Markdown table as `text` (stored as the editor writes it); `type: drawing` takes Mermaid (flowchart/graph or mindmap, laid out by the server) or a drawing model (JSON) as `text` |
| `update_note_bullet` | `notes:write` | Update text, checked state, or type of a bullet (`bulletId` from `get_note`); a drawing is replaced as a whole by a new one (`text` as Mermaid or model) and keeps its type; a bullet turned into a table gets its text as a table |
| `delete_note_bullet` | `notes:write` | Remove bullet including sub-bullets |
| `delete_note` | `notes:write` | Move own note to trash (recoverable); shared notes and notes in trash cannot be deleted this way |
| `search` | a read scope | Full-text search across tasks, list items, and notes (only within the scope of the key); notes returned as `notes` with `noteId`, `title`, `snippet` |
| `capture_to_inbox` | `webhook:triage` | Capture thought to inbox |
| `list_inbox` | `inbox:read` | Open inbox items, newest first (`query` in text, `limit`) |
| `convert_inbox_item` | `inbox:write` | Convert inbox item as in triage: `to` task (with `taskListId`, `dueDate`), note, or list_item (with `listId`) |
| `discard_inbox_item` | `inbox:write` | Discard inbox item (triage trash, recoverable) |

`icon` (`create_note`, `update_note`, `create_task_list`, `create_list`) must be a single emoji or empty (default icon); anything else is an error. With `BASE_URL` set, notes, tasks and lists in results carry a `url` that opens them in the app (`<BASE_URL>/?note=<id>`, `?task=<id>`, `?list=<id>`; search hits for notes as well); the server instructions ask agents to pass it on to the user.

Tools modify note bullets using the same operations as the editor (note synchronization): Anyone with the note open sees the change immediately; a bullet currently being edited by someone else is not touched (error message returned, try again later). Inbox tools accept only open inbox items; tasks remain out of reach for them. List items cannot be deleted via MCP, only checked off (they have no trash).

Items created or modified by an agent receive a permanent origin (`origin`, see [API Keys](#api-keys-scopes-and-origin)). `create_task` also works with `webhook:task`, and `add_list_item` with `webhook:list`.

Sharing permissions apply just as for the user: read-only lists cannot be modified, and other users' private lists remain invisible. Setup in Claude Code, for example: `claude mcp add --transport http mindsift https://mindsift.example.com/api/v1/mcp --header "X-API-Key: mindsift_sec_…"`; settings display the variants for Codex (`config.toml`) and JSON configurations (Claude Desktop, Cursor). claude.ai and ChatGPT connect via OAuth (next section).

### OAuth for claude.ai and ChatGPT

Clients unable to set an `X-API-Key` header connect via OAuth 2.1 in accordance with the MCP specification (authorization, as of 2025-06-18). In claude.ai, only `<BASE_URL>/api/v1/mcp` needs to be added as a custom connector; the client handles the rest. Prerequisite is `BASE_URL` (issuer and resource); without `BASE_URL`, in demo mode, or when MCP is disabled, all endpoints respond with `404`. `GET /auth/status` provides the address as `mcpConnectorUrl` (empty when OAuth is disabled).

| Method | Path (without `/api/v1`) | Purpose |
|---|---|---|
| GET | `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/{path}` (e.g. `/api/v1/mcp`) | Resource metadata (RFC 9728): `resource`, `authorization_servers`, `scopes_supported` |
| GET | `/.well-known/oauth-authorization-server` | Server metadata (RFC 8414) |
| POST | `/oauth/register` | Dynamic client registration (RFC 7591), JSON `client_name`, `redirect_uris` (only `https://` or `http://localhost`/`127.0.0.1`, max 10). All clients are public (`token_endpoint_auth_method: none`); rate limited to 20 registrations per address per 15 minutes |
| GET | `/oauth/authorize` | Consent page in the app (login, select scopes, allow/deny). Required: `response_type=code`, `client_id`, `redirect_uri` (exact match with registration), `code_challenge` with `code_challenge_method=S256`; optional: `state`, `scope` (space-separated scopes), `resource`. The response to the client contains `code`, `state`, and `iss` or `error` |
| POST | `/oauth/token` | Form: `grant_type=authorization_code` (`code`, `client_id`, `redirect_uri`, `code_verifier`) or `refresh_token` (`refresh_token`, `client_id`). Errors returned as `{"error":"invalid_grant",…}` |
| GET | `/api/v1/oauth/authorize` | For the consent page (signed in, no API keys): client, scopes and `knownHost` of an authorization request |
| POST | `/api/v1/oauth/authorize` | For the consent page: allow (`approve`, with the chosen scopes) or deny → `{redirect}`, the address to send the browser back to |
| POST | `/oauth/revoke` | Revoke token (RFC 7009); revoking a refresh token terminates all tokens associated with the connection. `503` with `server_error` when the token could not be revoked |

The consent page uses `GET`/`POST /api/v1/oauth/authorize` (requires user login, cannot be accessed with API keys). `GET` also returns `knownHost`: whether the way back leads to a known AI service (claude.ai, claude.com, anthropic.com, chatgpt.com, openai.com) or this computer (localhost); otherwise the page warns, because anybody can register a client under any name.

- **Scopes:** Same as for API keys; offered scopes include `tasks:read`, `tasks:write`, `lists:read`, `lists:write`, `notes:read`, `notes:create`, `notes:write`, `webhook:triage`, `inbox:read`, and `inbox:write`. If the client does not request specific scopes, read and write for tasks and lists are preselected.
- **Connection = Entry under `/keys`** with `kind: "oauth"` and name "<Client> (OAuth)". Modifying scopes, renaming, and deleting work like any other API key; origin (`origin`) carries this name. Re-consenting by the same client reuses the existing entry.
- **Tokens:** Code valid for 10 minutes (single-use), access token (`mindsift_oat_…`) valid for 1 hour, refresh token (`mindsift_ort_…`) valid for 90 days and rotated upon each refresh. If an already superseded refresh token is reused, all tokens for that connection are immediately invalidated. Access tokens are valid only for `POST /mcp`, not for REST or webhooks.
- **Expiration:** A connection that remains unused for `OAUTH_IDLE_DAYS` (default 90, `0` = never) is deleted.
- Without a valid token, `/mcp` responds with `401` and `WWW-Authenticate: Bearer resource_metadata="…"`.

### API Keys: Scopes and Origin
<a id="api-schlüssel-rechte-und-herkunft"></a>

A key is only permitted to access the following endpoints and requires one of the specified scopes:

| Scope | Meaning | REST | MCP Tools |
|---|---|---|---|
| `webhook:triage` | Populate inbox | `POST /inbox`, `POST /webhooks/ingest` (target `triage`) | `capture_to_inbox` |
| `tasks:read` | Read tasks | `GET /task-lists`, `GET /tasks` | `list_task_lists`, `list_tasks`, `get_task`, `search` |
| `webhook:task` | Create tasks | `POST /inbox` or `/webhooks/ingest` with target `task` | `create_task` |
| `tasks:write` | Modify tasks (includes creation) | plus `PATCH`/`DELETE /thoughts/{id}` | plus `update_task`, `complete_task`, `delete_task`, `create_task_list` |
| `lists:read` | Read lists | `GET /lists`, `GET /lists/{id}` | `list_lists`, `get_list`, `search` |
| `webhook:list` | Add list items | `POST /lists/{id}/items`, `/webhooks/ingest` with target `list_item` | `add_list_item` |
| `lists:write` | Modify lists (includes adding items) | plus `PATCH`/`PUT /lists/{id}/items/{itemId}` | plus `check_list_item`, `update_list_item`, `create_list` |
| `notes:read` | Read notes | – | `list_notes`, `get_note`, `search` |
| `notes:create` | Create notes | – | `create_note` |
| `notes:write` | Modify notes | – | `update_note`, `add_note_bullet`, `update_note_bullet`, `delete_note_bullet`, `delete_note` |
| `inbox:read` | Read inbox | – | `list_inbox` |
| `inbox:write` | Triage inbox | – | `convert_inbox_item`, `discard_inbox_item` |

Each area provides Read, Create, and Write tiers; in settings, enabling "Write" automatically includes the corresponding "Read" scope. Notes as well as reading and triaging the inbox are available exclusively via MCP; they remain blocked for API keys via REST. Notes do not carry an `origin`.

The `webhook:…` scope IDs originate from the time when keys could only ingest data, and remain unchanged for existing keys.

`GET /tasks` supports filters for scripts and smart home integrations: `status=open|done|all` (default `all`), `due=today`, `due=overdue` (open only), or `due=YYYY-MM-DD` (due on or before date); days are evaluated in the server's time zone (admin setting `timeZone`, else `TZ`, else UTC). Without parameters, the response remains unchanged as before.

**Origin:** Anything created or modified by a key includes the `origin` field on the task, thought, or list item: `createdVia`/`createdKey` (creation) and `changedVia`/`changedKey`/`changedAt` (last modified via key), with `api` or `mcp` as the access method and the name of the key; a key deleted since has no name and sets `createdKeyDeleted`/`changedKeyDeleted`. The origin is preserved permanently, even if a user subsequently edits the item manually, and is carried over during triage conversion (including into a list item). An MCP request executed from an authenticated user session counts as `mcp` without a key.

## Thoughts, Triage, Tasks

| Method | Path | Purpose |
|---|---|---|
| POST | `/inbox` | Quick capture. Body: `content`, `priority`, `source`, `dueDate`, `target` (`inbox`/`task`/`list_item`/`document`), `targetListId`, `taskListId` (snake_case variants are accepted) |
| GET | `/thoughts?status=` | Thoughts (`inbox`, `kept`, `converted`, `discarded`, `all`) |
| GET/PATCH/DELETE | `/thoughts/{id}` | Retrieve item; partial update (`content`, `isCompleted`, `dueDate`, `priority`, `taskListId`, `kanbanStatus`, `notes`, `subtasks`, `tags`, `assignees`, `recurrence` = `daily`/`weekly`/`monthly`/`yearly`/empty, `reminders` = minutes before the due date that replace each recipient's lead time, from `0`, `15`, `30`, `60`, `120`, `1440`, `2880`, `4320`, `10080`, `20160`, `43200` (one calendar month); whole days count as calendar days, `[]` = the lead time again, other values `400`; tasks return `reminders`); delete: a task is moved to the task trash, while a thought from inbox or triage trash is permanently deleted. `assignees` replaces all assignments; only users with access to the list, otherwise `403` |
| DELETE | `/thoughts/discarded/purge` | Empty triage trash (discarded thoughts) |
| GET | `/triage/deck` | Inbox deck (max 100) |
| PATCH | `/triage/{id}` | `action`: `keep`/`discard`/`restore`; with `convertTo`: `task`/`document`/`list_item` |
| GET | `/tasks?taskListId=&status=&due=` | Tasks (optionally filtered by list; filters see [API Keys](#api-keys-scopes-and-origin)) |
| POST | `/tasks/clear-done` | Move completed tasks to task trash (`taskListId`, empty = all editable) → `{deleted}` |
| GET | `/tasks/trash?taskListId=` | Task trash (for a list, otherwise all visible): `id`, `content`, `taskListId`, `isCompleted`, `trashedAt`, `trashedBy` (name, empty = automatic), `canEdit` |
| POST | `/tasks/trash/{id}/restore` | Restore task unchanged (with assignees; if the original list was deleted, it becomes a personal task for its creator) → task |
| DELETE | `/tasks/trash/{id}` | Permanently delete (requires edit permission on the list, otherwise `403`) |
| POST | `/tasks/trash/empty` | Empty trash (`taskListId`, empty = all editable) → `{deleted}` |
| POST | `/tasks/reorder`, `/task-lists/{id}/tasks/reorder` | Update task order/column (`items[{id, sortOrder, kanbanStatus}]`) |
| POST | `/tasks/{id}/unlink` | Unlink from note block |
| POST/DELETE | `/tasks/{id}/watch` | Watch or unwatch a task → `{watching}`; `404` without access. Task responses include `isWatching` |

## Task Lists

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/task-lists` | Lists (`permission` per list: `owner`/`editor`/`viewer`) in the person's own order (see `PUT /task-lists/order`); create (`title`, `icon`, `color`, `teamId`; `icon: ""` = no icon, if omitted: 📋) |
| PUT | `/task-lists/order` | Own order of the task list tabs (`ids`); per person, also for shared lists. Lists without a position (new ones) follow, most recently changed first. `204` |
| PUT/DELETE | `/task-lists/{id}` | Update (`title`, `icon`, `color`, `teamId`, `columns`) – not allowed for viewers; delete allowed for owner only. Lists in answers carry their standard columns (`todo`, `in_progress`, `waiting`, `done`) in the request's language as long as they still have a standard name in any language (`storage.LocalizeColumns`) |
| PUT/DELETE | `/task-lists/{id}/mute` | Mute / unmute the list for the requesting person (`{"muted": bool}`, `404` without access). A muted list sends no list-wide notifications (new task, completed, due date of unassigned tasks); assignments, mentions and watched tasks still come. `GET /task-lists` returns `isMuted` per list |
| GET | `/task-lists/{id}/shares` | Sharing permissions |
| POST | `/task-lists/{id}/shares` | Owner only. Body: `targetType` (`team`/`user`), `targetId`, `permission` (`editor`/`viewer`, default `editor`). Re-submitting for the same target updates the permission tier |
| DELETE | `/task-lists/{id}/shares/{shareId}` | Owner only |

Write attempts by viewers on lists or their tasks return `403` ("No write permission for this task list (read-only)").

## Workspace

| Method | Path | Purpose |
|---|---|---|
| GET/POST/DELETE | `/folders` | Folder list; create (`path`); delete (deleting an own folder moves it along with all subfolders and notes as a single entry to trash) |
| POST | `/folders/trash/{id}/restore` | Restore folder from trash (with all subfolders, even empty ones, and notes) → `restoredDocIds` |
| DELETE | `/folders/trash/{id}` | Permanently delete folder in trash along with notes |
| POST | `/folders/move` | `sourcePath`, `targetParentPath` |
| GET/POST | `/workspace/folders/shared` | Shared folders; create (`name`, `mountPath`) |
| GET/DELETE | `/workspace/folders/shared/{id}` | Retrieve; delete |
| PUT | `/workspace/folders/shared/{id}/mount` | Change own mount path (`mountPath`) |
| GET/POST | `/workspace/folders/shared/{id}/shares` | Shared folder permissions (`permission`: `read`/`write`) |
| DELETE | `/workspace/folders/shared/{id}/shares/{shareId}` | Remove share of a shared folder |
| GET | `/workspace/tags`, `/workspace/tags/{tag}` | Tag overview and details |
| PUT | `/workspace/tags/{tag}/note` | Save tag note page (`content`) |
| GET/POST | `/documents` | List notes; create (`title`, `icon`, `folderPath`, `blocks`, `tags`, `isPinned`; `icon: ""` = no icon, if omitted: 🗒️) |
| GET/PUT/DELETE | `/documents/{id}` | Retrieve; update `title`, `icon`, `folderPath`, `isPinned` (updating blocks here returns `400`, as they are handled via `/docs/{id}/sync`); delete = move to trash (owner) or leave share (others) |
| GET/DELETE | `/documents/trash` | List trash (`id`, `kind` `note`/`folder`, `title`, `icon`, `folderPath`, `deletedAt`, `isOwner`, for folders `noteCount`; notes from a deleted folder are contained within its trash entry) or empty trash (notes and folders) |
| GET | `/documents/{id}/backlinks` | Notes containing a link to this note (`[[Title#doc_id…]]`, older links without id by title) (visible notes only, excluding trash): `docId`, `title`, `icon`, `folderPath`, up to 5 `blocks` (`id`, `content`), `more` |
| POST | `/documents/{id}/restore` | Restore from trash (missing folder is recreated) |
| DELETE | `/documents/{id}/permanent` | Permanently delete note from trash |
| PUT | `/documents/{id}/move` | Move to another folder (`folderPath`) |
| POST | `/documents/{id}/blocks/{blockId}/enhanced-task` | Turn a block into a linked task (`content`, `checked`) |
| GET/POST | `/documents/{id}/shares` | Note shares (`userId`/`email`/`teamId`, `permission`: `read`/`write`) |
| DELETE | `/documents/{id}/shares/{userId}` | Remove note share |
| POST | `/documents/{id}/extract` | `{blockId, clientId}`: creates a new note from the bullet and its sub-bullets; the bullet stays the note's first bullet (title = its text without hashtags, "New note" for drawings, images, code and other bullets without usable text; same folder, shares inherited, non-owner recipient receives write permission) → `{document, link}`. The server does not modify the source note; the editor itself replaces the sub-tree with `link` (standard local change, Ctrl+Z possible). Requires write permission; `409` if someone else is currently typing in the branch; `400` if the bullet is now only a link to a note (optionally with hashtags) |
| GET | `/push/key` | `{enabled, publicKey}` – public VAPID key for `pushManager.subscribe` (`enabled: false` in demo) |
| GET | `/push/devices` | Own registered push devices → `{devices: [{id, endpoint, device, createdAt}]}` |
| POST | `/push/subscribe` | `{endpoint, keys: {p256dh, auth}, device}` – register device (only `https` endpoints) |
| POST | `/push/unsubscribe` | `{endpoint}` – unregister device |
| POST | `/push/test` | Send test notification to all own devices → `{devices}`; `400` if no devices |
| GET | `/journal` | Days in own journal, newest first → `{days: [{date, docId, empty}]}` (`empty`: note has no text yet; days in trash are excluded) |
| POST | `/journal/{date}` | Open journal note for date (`YYYY-MM-DD`); if none exists yet, it is created (title e.g. "Friday, October 30, 2026", icon 📅) → document, `201` if newly created. Journal notes are standard notes (sharing, search, sync) |
| POST | `/documents/{id}/extract/undo` | Moves extracted note `{id}` back to trash (creator only) |
| POST | `/documents/{id}/branches/move` | `{blockId, targetId, clientId}`: copies the bullet with its sub-bullets to the end of note `targetId` (through the target's sync operations, open editors follow live) and moves links of tasks and subtasks on these checkboxes along → `{targetId, targetTitle, rootId, moved}` (`moved`: new block ID in the target → block ID in the source). The server does not modify the source note; the editor removes the branch itself (or leaves a link `[[Title#^rootId]]` when extracting into an existing note), so Ctrl+Z works. Requires write permission on both notes; `400` same note, `404` bullet not found, `409` someone else is typing in the branch. The earlier address `POST /documents/{id}/move` still works |
| POST | `/documents/{id}/branches/move/undo` | Body: the result of `branches/move` plus `clientId`: removes the branch from the target note again and gives the task links back to the source note's checkboxes (which the editor restores by its own undo) |
| POST | `/documents/{id}/move`, `/documents/{id}/move/undo` | Earlier addresses of `branches/move` and its undo, kept for apps with older code (`PUT /documents/{id}/move` moves the note into a folder) |
| POST | `/documents/{id}/inline` | `{blockId}`: counterpart to `extract` for a bullet consisting solely of a link to a note (`[[Note#doc_id]]` or older `[[Note]]`, optionally with hashtags) → `{sourceId, content, head?, blocks}`: text for the bullet (title plus hashtags) and note bullets with new IDs (`level` 0 = directly beneath the bullet). For a note made by `extract` (a single top-level bullet that names the note), `head` is that bullet: it replaces the link bullet (type and props), `content` is its text plus the link's hashtags, and `blocks` are its children. The linked note is moved to trash; undo with `POST /documents/{sourceId}/restore`. The editor modifies the source note locally. `400` not a link bullet (a link to a single bullet, `[[Note#^id]]`, does not count), `404` note not found, `403` another user's note, `409` still referenced by other notes |
| POST | `/documents/{id}/merge` | `{sourceId}`: appends (own) source note as a heading with sub-bullets to this note, moves source to trash → `{targetId, sourceId, sourceTitle, headingId}` |
| POST | `/documents/{id}/merge/undo` | `{sourceId, headingId}`: removes section, restores source note |
| POST | `/documents/{id}/media` | Upload image or audio for a note (`multipart/form-data`, field `file`; requires write permission) → `{id, kind, mime, size, url}`. `415` invalid format, `413` too large or storage quota exceeded |
| POST | `/documents/{id}/secrets` | Hide a value (`/secret`): `{value}` (up to 4096 bytes; requires write permission) → `{id, ref}`; only `ref` (`{{secret:<id>}}`) goes into the bullet text |
| GET | `/documents/{id}/secrets/{secretId}` | Reveal a hidden value → `{value}`. Allowed to everyone who can see the note it belongs to; from another note only if a bullet there holds the reference and the caller can also see the original note (the value moves along when the original note no longer holds the reference and the caller may edit both notes; reading alone never moves it). `404` with `code: secret_gone` when deleted, `409` `secret_unreadable` when the key changed. Never cached offline |
| PUT | `/documents/{id}/secrets/{secretId}` | Change a hidden value: `{value}`; requires write permission on the note it belongs to (from another note on both) |
| POST | `/documents/{id}/media/fetch` | Copy external image: `{url}` (https only, no internal addresses; disabled in demo) → same response as above |
| GET | `/media/{id}` | Retrieve file (requires read permission on a note referencing it), supports HTTP range requests; otherwise `404` |
| GET | `/link-preview?url=https://…` | Preview of a webpage (`title`, `description`, `siteName`, `hasImage`, `hasIcon`, `ok`, `key`), fetched by server and cached for 7 days; `422` without https, `403` in demo, `429` rate limit exceeded |
| GET | `/link-preview/{key}/{kind}` | Image (`kind` = `image`) or icon (`icon`) for a preview |

Note content (blocks) is modified exclusively via `POST /docs/{id}/sync`. `POST /documents` still accepts an initial block list upon creation; this is internally converted into operations.

## Collaborative Note Editing
<a id="gemeinsames-bearbeiten-von-notizen"></a>

Concept and rules: [modules/collaboration.md](../modules/collaboration.md). Access via role `owner`/`editor`/`viewer` (`Store.DocRole`); `404` without a role.

| Method | Path | Purpose |
|---|---|---|
| GET | `/docs/{id}/snapshot` | Complete block tree including tombstones, `title`, `titleVersion`, `headSeq`, `role`, `shared` |
| POST | `/docs/{id}/sync` | Single round-trip: submit local operations, acquire/release leases, fetch log starting at `lastSeq` |
| GET | `/docs/{id}/changes?since=N&wait=S` | Long polling: returns immediately if `headSeq > N`, otherwise on next change (including leases/presence) or after at most 25 s. Response `{headSeq, changed}`; client then retrieves data via `/sync` |
| POST | `/docs/{id}/leave` | Terminate session, release all client leases (`{clientId}`) |
| GET | `/docs/{id}/drawings/{blockId}/live` | State of a live drawing session: `active`, `host`, `participants`, `watchers`, `els` (with `ver`, `nonce`, tombstones), `order`, `grid`, `seq`; read access |
| POST | `/docs/{id}/drawings/{blockId}/watch` | Watch a live drawing over SSE or long polling: `{sseId}` joins the room `drawing:<docId>:<blockId>` and counts as watching, returns the state with `you` (`429` when joining and watching too fast); `{sseId, leave: true}` ends it, only for a connection of the caller (else `403`). Drawing along needs the WebSocket, see [websocket.md](websocket.md#live-drawing) |

`/sync` request:

```json
{
  "clientId": "tab-7f3…",
  "lastSeq": 412,
  "ops": [
    { "opId": "c1a…", "kind": "set_content", "blockId": "b9…", "baseVersion": 7, "content": "Milk and bread" },
    { "opId": "c1b…", "kind": "insert", "blockId": "bA…", "parentId": "b2…", "orderKey": "a0V", "type": "bullet", "content": "" }
  ],
  "leases": { "hold": ["b9…", "bA…"], "release": [] }
}
```

- Operation kinds: `insert`, `set_content`, `set_props` (`patch`: `type`, `checked`, `collapsed`, `lang`, `clearConflict`), `move`, `delete`, `restore` (`ids`), `set_title` (`baseVersion`, `title`).
- `leases.hold` is the complete list of blocks the client intends to hold; all other leases belonging to the client are released. Newly inserted blocks and conflict copies are automatically granted to the author.
- At most 500 operations per request. Viewers cannot submit operations (`403`), but may query.
- A note holds at most 20,000 live bullets and 40,000 including deleted ones (they are purged after the retention period). An operation that would add one more (insert, restore, a conflict copy) is answered `rejected` with reason `note_full`; creating a note with more bullets (`POST /documents`, import, MCP) answers `400`. Every sync and snapshot loads the whole note, so its size is the cost of each change.
- `skipLog: true` suppresses returning the operation log; intended for single mutations without an active editor (e.g. checking off items in the to-do overview).

`leases.others[]` carries `live` (everyone drawing, host first) when a live drawing session holds the bullet.

Response: `results` (per operation: `status` `applied`/`conflict`/`rejected`, optionally `conflictBlockId`, `version`, `seq`), `ops` (log entries `{seq, opId, userId, clientId, effect}` from `lastSeq`, at most 1000; `hasMore` if more exist), `headSeq`, `resync` (reload snapshot: the client is ahead of the server, or its `lastSeq` precedes the compacted boundary `log_floor`; submitted operations are applied regardless), `role`, `shared`, `sessions`, `presence`, `leases` (`granted`, `denied`, `others`).

Duplicate operations (same `opId`) are not reapplied; the response returns the previously stored result.

## Shared Lists

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/lists` | Lists in the person's own order (see `PUT /lists/order`); create (`title`, `icon`, `listType`; `icon: ""` = no icon, if omitted: 🛒) |
| PUT | `/lists/order` | Own order of the list tabs (`ids`), like `/task-lists/order`. `204` |
| GET/DELETE | `/lists/{id}` | Retrieve with items; delete |
| PATCH | `/lists/{id}` | Rename: `title`, `icon` (owner and editors; `403` for viewers, `404` without access); sends `LIST_UPDATED` |
| GET/POST | `/lists/{id}/shares` | Retrieve or create shares (`targetType`, `targetId`, `role`: `editor`/`viewer`) |
| DELETE | `/lists/{id}/shares/{shareId}` | Remove share |
| POST | `/lists/{id}/items` | Add item (`content`, `category`, `quantity`) |
| PATCH | `/lists/{id}/items/{itemId}` | Check off item (`isCompleted`) |
| PUT | `/lists/{id}/items/{itemId}` | Update item (`content`, `category`, `quantity`) |
| DELETE | `/lists/{id}/items/{itemId}` | Delete item |
| POST | `/lists/{id}/items/{itemId}/move` | Move to another list (`targetListId`); requires edit permissions on both lists; item is placed at the top |
| POST | `/lists/{id}/items/reorder` | Order/category (`items[{id, sortOrder, category, content}]`); `PUT` does the same and stays for older clients |
| PUT | `/lists/{id}/items/reorder` | Same as `POST` (kept for older clients) |
| POST | `/lists/{id}/clear-completed` | Remove completed items |

## Groups

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/teams` | Own groups; create (`name`, `description`, `organizationId`) – creator becomes group admin; the group belongs to one of the creator's organizations (`organizationId` required in `organizations` mode when the creator is in several, `400` otherwise); blocked in `private` mode |
| PUT/DELETE | `/teams/{id}` | Group admin only |
| POST | `/teams/{id}/members` | Add member (`userId` or `email`, `role`); only people the group admin may share with and, in `organizations` mode, members of the group's organization, otherwise `404` |
| PUT/DELETE | `/teams/{id}/members/{userId}` | Change role (`admin`/`member`); remove |

## Administration (`role = admin`, partly `manager`)

Routes marked **S** are open to server admins and user managers (`role = manager`); all others to server admins only. User managers look after members only: they cannot edit, lock or delete admins or other managers, cannot change a role, e-mail address or username (`403`), and every account they create is a member.

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/admin/users` | **S** List users (with `organizationIds`; without alarm targets – webhooks, channels – and token version); create (`email`, `password`, `displayName`, `role` (`member`/`manager`/`admin`), optional `organizationIds`); `400` "Ungültige E-Mail-Adresse" for an address that is not a plain `name@domain` (checked as in `/auth/settings`), `409` if the address belongs to another account. Control characters in `displayName` (line breaks, tabs) become a space and bidirectional controls (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F, U+061C) are dropped, here and wherever a name is saved; a name that is empty after that becomes the account's username, also at registration, setup, a first OIDC sign-in, `ADMIN_USER` and in `/auth/settings` |
| GET/POST | `/admin/organizations` | **S** Organizations with `memberCount`; create (`name`) |
| PUT/DELETE | `/admin/organizations/{id}` | **S** Rename (`name`); delete (shares only this organization allowed go) |
| POST | `/admin/organizations/{id}/members` | **S** Add a person (`userId`) |
| DELETE | `/admin/organizations/{id}/members/{userId}` | **S** Take a person out; removes shares, group memberships and assignments that no other common organization allows. `?dryRun=true` only counts them (`affected`) |
| PATCH/DELETE | `/admin/users/{id}` | **S** `displayName`, `username` (rules and errors as in `/auth/settings`), `email` (`400` "Ungültige E-Mail-Adresse" if not valid, `409` if another account has it; in both cases nothing of the request is applied; `""` removes the address), `role`, `isActive`, `discordWebhookUrl`; delete (for pending accounts = reject). `GET /admin/users` flags pending accounts with `pendingApproval` and accounts with a second factor with `mfaEnabled` |
| POST | `/admin/users/{id}/mfa/reset` | Removes every second factor of another account (authenticator app, passkeys, recovery codes, trusted devices), e.g. after a lost phone; it signs in with the password alone again and is told by mail. `400` for the own account, `403` for managers on admins and managers. `403` in demo mode |
| POST | `/admin/users/{id}/approve` | **S** Approve pending account; the user receives an email (`409` if not pending) |
| PUT | `/admin/users/{id}/password` | Reset password (server admins only) |
| GET/POST | `/admin/invites` | **S** List or create invitations (`email`, `organizationIds`, `validDays`, `maxUses` 1–1000; multi-use invites are not bound to an email address). Invites always create members; a `role` field is ignored. Response includes `maxUses`/`useCount`, `organizationIds`/`organizationNames`, and for used-up or expired invites `removeAt`: 30 days after that, the daily cleanup deletes them. As link: `/?invite=<CODE>` opens registration with code pre-filled |
| POST | `/admin/invites/{id}/send` | **S** Send invitation via email (`email`); binds single-use codes to this address; requires SMTP |
| DELETE | `/admin/invites/{id}` | **S** Revoke/delete invitation |
| GET/PUT | `/admin/settings` | `instanceName`, `allowRegistration`, `sharingMode` (`private`/`organizations`/`open`), `peopleSearch`, `publicLinks`, `publicLinkMaxDays` (1–14), `pushKnownServicesOnly` (web push only via the push services of Google, Mozilla, Apple and Microsoft; default `false`), `mfaRequired` (who must sign in with a second factor: `""` nobody, `admins`, `all`; `400` for other values), SMTP fields, `timeZone` (the server's time zone as an IANA name, e.g. `Europe/Berlin`; `""` = not set, then `TZ`, else UTC; left out = unchanged; `400` for an unknown name; in effect at once); changing mode cleans up shares. Values fixed by the environment come with `…ConfiguredViaEnv` and are not changed by `PUT`. `smtpPass` is never returned (`smtpPassSet` indicates whether one is stored); empty = unchanged. Read only: `oidc` (`configured`, `enabled`, `reason` (`no_base_url`, `demo`), `name`, `issuer`, `clientId`, `redirectUrl`, `scopes`, `adminGroup`, `autoCreate`, `passwordLogin`, `reachable`, `error`, `linkedUsers`): the sign-in through the OpenID Connect provider as `OIDC_*` sets it; `serverTime` (`zone`: the zone in effect, `source`: `setting`, `env` (`TZ`) or `default` (UTC), `now`: the server's time in RFC 3339 with the offset, `fallback`: the zone without the setting), ignored in a `PUT` |
| POST | `/admin/setup` | Rest of the first-time setup after an admin from `ADMIN_USER`: the wizard's instance settings (`instanceName`, `allowRegistration`, `sharingMode`, `createSampleData`, `defaultLanguage`, `backupEnabled`, `backupTime`, `backupRetentionDays`, `timeZone`, `smtp`, as in `/auth/setup`, with the same `400`s) and `email` for an account without one (no `ADMIN_EMAIL`): like a changed login address it waits for the click on the link mailed to it, which goes out right away when a mail server (the one in `smtp` is stored first) and `BASE_URL` are set, otherwise as soon as an admin sets up the mail server in the administration; `400` for an invalid address, `409` for one in use, ignored when the account has an address. Answers `done`, with an `email` also `pendingEmail` and `confirmationSent`. Once, while `/auth/me` says `setupPending`; `409` afterwards |
| GET | `/admin/setup/status` | For the summary of the setup wizard: `smtpConfigured` (by `SMTP_HOST` or the admin settings), `smtpViaEnv`, `smtpHost`, `baseUrlSet`, `emailLinks` (mail server and `BASE_URL`: mails with links can go out), `backupDir` (folder of the daily backups on the server) |
| GET | `/admin/settings/sharing-impact?mode=` | Dry run: how many shares and group memberships a mode change would remove (`affected`) |
| POST | `/admin/smtp/test` | Test email (`toEmail`); with `smtp` (fields as in `/auth/setup`) through that mail server without storing it (setup wizard), `400` without host. `502` with the mail server's answer when sending fails |
| GET | `/admin/voice` | Active voice recognition (`mode`: `server`/`browser`/`off`), settings from `STT_*` without secrets, limits, and in server mode fresh health status (`status.reachable`, `status.modelReady`) |
| GET/POST | `/admin/backups` | List database dumps or create backup immediately (database dump + all user backups) |
| GET | `/admin/backups/{name}` | Download database dump |
| GET | `/admin/backups/deleted` | Kept backups of deleted accounts (`userId`, `displayName`, `email`, `deletedAt`, `removeAt`, `files`) |
| GET | `/admin/backups/deleted/{userId}/{name}` | Download one backup of a deleted account (ZIP) |
| DELETE | `/admin/backups/{name}` | Delete database dump (returns remaining list; disabled in demo) |

## Public links to notes

The owner of a note shares it read only by link (`/p/<token>` in the app); see [sharing-and-permissions.md](../sharing-and-permissions.md). Not reachable with API keys or MCP.

| Method | Path | Purpose |
|---|---|---|
| GET | `/documents/{id}/public-link` | Owner only: `{enabled, maxDays, link}`; `link` = `{token, expiresAt, hasPassword}` or `null` |
| PUT | `/documents/{id}/public-link` | Owner only: new link (`hours`: 1, 24, 72, 168 or 336, at most `maxDays`; optional `password`). The previous address stops working. `403` when public links are off |
| DELETE | `/documents/{id}/public-link` | Owner only: the address stops working at once |
| GET | `/public/{token}` | No login. The note for visitors: `title`, `icon`, `expiresAt`, `headSeq`, `titleVersion`, `blocks` (as in the snapshot, without hidden values (`{{secret:hidden}}`), conflict copies, authors or the text of deleted bullets). `?since=<headSeq>` answers `204` when nothing changed. Password-protected links need the header `X-Public-Key` (`401` with code `password_required`). Unknown, expired, revoked and switched-off links: `404`. Answers carry `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer` |
| POST | `/public/{token}/unlock` | No login. `password` → `{key}` for `X-Public-Key`, valid 12 hours (at most until the link expires); `401` with code `password_wrong`; `429` with `Retry-After` after 10 tries per link and address, and after 50 wrong passwords for the link from all addresses together within 15 minutes (then for 15 minutes every try, the right password included) |
| GET | `/public/{token}/media/{mediaId}` | No login. An image or recording a living bullet of the note shows (with `X-Public-Key` when protected) |

## Examples

```bash
# Capture thought via API key
curl -X POST https://mindsift.example.com/api/v1/webhooks/ingest \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" \
  -d '{"title":"Buy milk #shopping","priority":"high","dueDate":"2026-11-01"}'

# What is due today (scope tasks:read), e.g. for a Home Assistant sensor
curl "https://mindsift.example.com/api/v1/tasks?due=today&status=open" -H "X-API-Key: mindsift_sec_…"

# Complete task (scope tasks:write)
curl -X PATCH https://mindsift.example.com/api/v1/thoughts/th_… \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" -d '{"isCompleted":true}'

# Add item to shopping list via API key (scope webhook:list or lists:write)
curl -X POST https://mindsift.example.com/api/v1/webhooks/ingest \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" \
  -d '{"target":"list_item","listId":"lst_…","content":"Oat milk","quantity":"2"}'

# Share task list as read-only
curl -X POST https://mindsift.example.com/api/v1/task-lists/tkl_…/shares \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"targetType":"user","targetId":"usr_…","permission":"viewer"}'
```
