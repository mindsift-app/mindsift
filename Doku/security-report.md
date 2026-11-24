# MindSift security review, November 2026

## Status (16 November 2026)

Checked against the development branch at `0c62f02` (15 November) and, for the new features, with a fourth
penetration test at `c2367f8` (16 November), before v0.96.0:

- **Rated findings (high, medium, low): none open.** All 16 are fixed; every fix commit is in the development branch
  and the fixed code and its regression test are still in place (see "Finding index" at the end).
- **Hardening notes: two accepted, none open.** The OIDC client without the internal-network guard and the default
  `TRUSTED_PROXIES=private` (see "Accepted trade-offs").
- **New features since the second re-test:** attacked in a fourth penetration test on 16 November (back-channel
  logout, calendar feed, outgoing proxy, required password change, operator command line, audit log, update check,
  `API_KEYS_ENABLED=false`). No rated finding; two hardening notes that are already covered and documented (see
  "Fourth run").
- **Two later findings (23 November), both fixed:** an existence oracle and a database message in the answers of
  note writes that checked access themselves (see "Later findings"; not counted in the 16 above).
- **The two observations of the status check of 15 November are settled:** the proxy's own address is now dialled
  only as the proxy (`b9e025d`, confirmed by the fourth run), and the calendar feed is switched off together with keys
  and AI connections when an administrator resets a password with "revoke keys" (`22cec2e`); the person's own
  password change and "sign out everywhere" keep it, as documented.

## Summary

On 13 and 14 November 2026 MindSift went through two code reviews, three penetration tests with fuzzing and a re-test
of all of them, all of its own code and all against local throwaway instances:

- a review of everything added after v0.95.0 (morning of 13 November),
- a review of the changes of that day (evening of 13 November),
- three penetration test runs with fuzzing (evening and night of 13 November, the third finishing on 14 November),
- a re-test of every regression script against the fixed code, run twice on 14 November: after the fixes of
  13 November and again after the fixes of the re-test's own findings and of the final review.
- a fourth penetration test of the features added since then, on 16 November (no rated finding).

Each review read the code and then checked its findings against a running instance; each penetration test run
attacked the running instance and re-tested everything fixed before it. The re-test found no regression in any of the
fixes. Every finding rated high, medium or low is fixed. Of the twelve hardening notes, ten are fixed and two are
accepted trade-offs (see below). The fixes are in the public history (commits below); none of them is in v0.95.0,
they ship with v0.96.0.

| Severity | Found | Fixed | Accepted | Open |
|---|---|---|---|---|
| High | 1 | 1 | 0 | 0 |
| Medium | 4 | 4 | 0 | 0 |
| Low | 11 | 11 | 0 | 0 |
| Hardening notes | 12 | 10 | 2 | 0 |
| **Total** | **28** | **26** | **2** | **0** |

On 15 November every fix was checked again against the current development branch (`0c62f02`): each fix commit is
part of it, the fixed code is unchanged in substance and the regression tests are still there.

**How this was counted:** every distinct problem counts once, in the round that first reported it, even when later
rounds reported it again (for example, the wrong status for a taken address was found in the second penetration test
and confirmed in the third; the note on file ids was raised in the evening review and tested again through imports in
the third penetration test). Observations that the reports themselves marked as not security-relevant (database
growth, test tooling, the length of a placeholder text) and one apparent finding that turned out to be an artefact of
the test set-up are not counted, nor are the correctness fixes of a final review before the release (see "Further
hardening"). The full review of 10 November (20 findings, fixed in `730309b`) is not counted either; its notes were
not kept, see "History" below.

**What this is not:** an external audit. The reviews, the penetration tests and the fixes were done with AI
assistance and checked by the maintainer. Nobody outside the project has reviewed the code yet.

## Scope

- **Code:** Go server (`internal/`, `cmd/`), React frontend (`frontend/src`), Dockerfile, CI workflows and build
  scripts, install script.
- **Running instances:** local throwaway containers built from the reviewed commit: demo mode, a fresh server without
  any account, a normal server with an administrator from `ADMIN_USER` and several accounts, an organization and
  groups, a server with a required second factor, plus a local OpenID Connect provider and a local mail sink. Never
  against a production server or the public demo.
- **Areas:** sign-in (passwords, TOTP, recovery codes, passkeys, OIDC, trusted devices, required second factor,
  step-up confirmation), password reset and change of the login address, first-time setup, sessions and API keys with
  scopes, the MCP endpoint and its OAuth grant, permissions on notes, lists, tasks, folders, organizations, groups and
  public links, files and media, hidden values in notes, real-time sync over WebSocket and its fallback, live
  drawing, import and export, link previews and webhooks (SSRF), mails, metrics, backups and restore, headers and
  Content Security Policy, the service worker, supply chain (dependencies, CI).

## Method

1. **Reading the code** of every area above, with attention to permission checks on every route, input limits and
   what reaches logs, mails and error responses.
2. **Dynamic checks** against the local instances: scripted HTTP and WebSocket requests from a second and third
   account, with and without permission, with oversized and malformed input, and with concurrency (for example eight
   simultaneous setup attempts, two address changes racing for the same address).
3. **Browser checks:** stored cross-site scripting payloads in every block type and in drawings, opened in a headless
   Chromium both on a public page and signed in; passkey ceremonies with a virtual authenticator; the OIDC flow
   against a local provider.
4. **Fuzzing:** Go-native fuzzing of the parsers (later runs also with invariants), REST fuzzing of request bodies
   and of every GET path and query parameter, WebSocket fuzzing, corrupt and crafted uploads and archives.
5. **Load checks** of single features against the local instance only (large notes, many live drawing sessions,
   metric label growth, archive imports), watching memory and response times.
6. **Regression:** every fixed finding has a re-test script that runs again in later rounds; on 14 November all of
   them ran again against the fixed code.
7. **Static analysis in every build:** TypeScript in strict mode, ESLint (including the React hooks rules) with zero
   warnings, `go vet`, golangci-lint (with staticcheck), `govulncheck`, `npm audit`, and a Trivy scan of the image
   (on every tag, and weekly for `:stable` and `:latest`).

## Findings and fixes

### High

- **Unbounded metric series from any HTTP method** (unauthenticated memory growth). Any request with a new HTTP
  method created a new metric series. Fixed in `962103c`: unknown methods are counted as `other`, request headers
  are capped at 64 KiB.

### Medium

- **Live drawing: memory per user without a limit.** Each live drawing session held about 1 MB for ten minutes, with no
  limit on sessions per person. Fixed in `897e6f4`: one drawing per connection, eight per person, at most 256
  sessions and 32 MiB on the whole server, join rate limit. Since 15 November a drawing is edited alone by default;
  a live session is only started on purpose (`a2d87ec`).
- **Live drawing: read access was enough to remove other people from a session.** Fixed in `897e6f4`: a connection
  can only leave its own session.
- **References between bullets: one bullet could write thousands of index rows.** A new index of file and secret
  references (introduced the same day, never released) stored every reference in a bullet. A long bullet full of
  made-up references made one sync request hold the database for about half a minute. Fixed in `9bb80f7` before
  any release: at most 64 references per bullet, written in one statement.
- **Archive import: memory spike from a small archive** (third penetration test). An import unpacked the notes of an
  archive before it checked their total size, kept several copies of them, and any number of imports could run at
  once. An archive well under 1 MB made the server hold about 0.8 GB for a few seconds, three at once about 2.4 GB,
  enough to get the process stopped on a small host. Any account allowed to import could do it. Fixed in `4895ebf`
  and `9a4dae0`: entries are checked by their declared size before anything is unpacked (500 MB together; entries
  that pack better than 100:1 are skipped), notes are read and converted one at a time, the real bytes are counted
  again while reading, and one import per person and two per server run at a time (others get 429).

### Low

- **Required second factor did not cover WebSocket, server-sent events and the ingest webhook** when used with a
  session. Fixed in `796d8a8` (API keys keep working as documented).
- **Setup code lock behind a shared address.** Behind a proxy that does not pass the client address, wrong setup codes
  from anyone could lock the setup wizard for everyone. Fixed in `80f4b49` (never released): the right code always goes
  through.
- **Hidden values: a reader could take one over** (found in the evening review, older than that day's changes).
  Someone with read access to a shared note who copied the reference to a hidden value into a note of their own could
  change the value from there, and took it over once the owner deleted the bullet: the reader kept it after the share
  was revoked, the owner lost it. The reader knew the value already. Fixed in `61c6003`: reading moves nothing, and
  changing or moving a value needs write access to the note it belongs to. Since then a bullet copied into another
  note takes its own copy of the hidden value along (`a9aa709`, `cb5cf06`, migration 46): the copy belongs to the
  new note, and changing either one leaves the other alone.
- **Wrong HTTP status for client mistakes and missing access** (first penetration test). Empty titles, list items and
  inbox entries, and changing or sharing a note without access, were answered as internal errors (500, with a generic
  message) instead of 400 or 404. Fixed in `2821e80`.
- **Deleting a list told a foreign list from a missing one** (first penetration test): different error texts for
  "exists but belongs to someone else" and "does not exist". Both now answer the same 404; only people who can see a
  shared list learn that just its owner may delete it. Fixed in `2821e80`.
- **A link-preview text helper could panic** for a length below one (found by fuzzing). Not reachable through the API
  as the code stood, since every caller passes a fixed positive length. Fixed in `2821e80`; the crash input is kept
  as a regression test.
- **A taken address in the user administration was answered as an internal error** (second penetration test,
  confirmed in the third). Creating a user, or giving one an address another account already had, returned 500 with
  a generic message. Fixed in `6f69fda`: 409, also when two requests take the same address at once.
- **The password of a public link was limited per visitor address only** (third penetration test). A visitor who can
  claim a different address for every try (possible only from a network range the server trusts as a proxy, see
  `TRUSTED_PROXIES` below) could keep guessing. Fixed in `0078a3c`: wrong passwords also count per link from all
  addresses; after 50 within 15 minutes the link takes no passwords for 15 minutes, while visitors who already unlocked
  it keep reading. The security documentation, which promised the same limit as for sign-ins, was corrected in
  `79c8de4`.
- **An import on a new server held the database and made other sign-ins fail** (re-test). On a newly set-up server
  the query planner kept the statistics of the first start, taken with nearly empty tables. An import then scanned the
  whole full-text index for every note, so each note took longer than the one before (1,000 small notes: about 50
  seconds on the second run instead of 20), and sign-ins of other people failed with 500 while it ran, until the next
  restart. Introduced on 14 November by a performance change (`330d70b`), never released. Fixed in `96215f1`: no
  statistics are kept for tables analyzed with fewer than 1,000 rows or for the internal tables of the full-text index.
- **Two imports at once could leave one half done** (re-test; already in v0.95.0). Two people importing at the same
  time competed for the database, and one import could stop with "database is locked" and keep the notes it had
  created so far. Fixed in `11ef45d`: imports are written one after the other, and an import that fails removes what
  it created.
- **MCP answered "Internal error" for someone else's task** (re-test). `update_task` and `complete_task` on a task the
  caller may not see changed nothing, but answered with an internal error instead of "not found". Fixed in `9560820`:
  both look the task up first, and a missing row answers "Not found or no access". This was also the cause of a log
  line the third penetration test could not trace.

### Hardening notes (no direct vulnerability)

**Fixed (10):**

- The OIDC option that linked accounts by email address, which could take over an account with its own second factor,
  was removed (`7ce4bbd`).
- Queries over the reference index check that bullet and note belong together (`9bb80f7`).
- CI actions are pinned to the commit hashes of their releases (`7b99553`).
- A note editor could send the client id of a live drawing (`draw:<bullet>`) or of the server's own writers and
  write into the drawing or take its lease; such ids are now refused in every editing route (`2792470`).
- A license build script quotes file names (`44f548e`).
- The database copies taken before migrations are deleted after 90 days, the newest included, so deleted accounts do
  not live on in them (`a1c9f27`).
- The list of third-party licenses, which named the exact version of every dependency, is served to signed-in people
  only (`f836fda`).
- The Content Security Policy loads images only from MindSift itself; `https:` was dropped from `img-src`, so an image
  address smuggled into shared content cannot act as a tracking pixel or a way out for data (`107d554`).
- Control characters in display names (a line break started a line of its own in the plain-text part of mails) are
  removed when a name is saved, and names in mails stay on one line (`6f69fda`); invisible text-direction characters
  are removed too (`f18bbbc`).
- **A file id worked as a key.** Whoever knew the id of someone else's picture or recording could put a reference to
  it into a note of their own (by writing the bullet or by importing a note) and read the file; a public link of that
  note made it readable for anyone. Ids are 96-bit random and cannot be guessed, but they travel with copied text.
  Fixed in `a4f32d3`: a bullet only keeps files its writer uploaded or may read at that moment, on every way in
  (editor sync, MCP, notes created through the API, Obsidian and MindSift imports, backups, restoring a personal
  backup); references to any other file become their caption or a placeholder, and import previews list the notes
  concerned.

**Accepted (2)**, see "Accepted trade-offs":

- The identity provider (OIDC) is fetched without the internal-network guard that every other outbound request uses.
- The default `TRUSTED_PROXIES=private` trusts every device in the local network to state a client address.

### Further hardening in the same period (not counted above)

These did not come from a rated finding of the rounds above (the first item came from a final review of the changes
before the release):

- The final review found two ways files could be lost, both from changes of the same unreleased cycle, and both were
  fixed before any release. Files a bullet shows beyond the cap of 64 indexed references (see the medium finding on
  the reference index) were not seen by the media cleanup and the backups, so they could be deleted or left out
  (`cf14a3a`). And since the file check of `a4f32d3`, a change to a task by someone who cannot read the note the task
  lives in (a shared task list) removed the owner's picture from the task's bullet, after which the cleanup deleted
  the file; files the bullet already shows are now kept, only new ones are checked (`879aeec`).
- The SMTP password of the administration is stored encrypted with `SECRETS_KEY`, so database and backups no longer
  contain it in plain text (`fd49e90`, migration 43); `SMTP_PASS` from the environment is not copied into the
  database at all (`0ac526b`). This resolves the stored-password part of FLAW-34.
- The server warns at start when the secrets key does not open the encrypted values it finds, including the SMTP
  password (`8bd4330`, `087e42e`).
- Backups are flushed to disk before and after they are renamed into place (`5b39a0a`).
- While `SMTP_PASS` is set, the SMTP password field in the administration is locked, and a password sent anyway is
  ignored (`2870950`).
- Usernames are unique in the database itself, so two accounts created at the same moment cannot share one
  (`aeab2f9`, migration 45).
- Email addresses are validated in the user administration (`aeab2f9`), at registration and in the setup wizard
  (`7fa4bcc`).
- Administrators can switch link previews off for the whole server; the server then fetches no pages for them and
  forgets the cached ones (`a2307c6`, `0ac526b`).
- Note text is stored once instead of up to five times (`ae168a6`, migration 44). The first penetration test had
  observed that 17.8 MB of note text grew the database by about 220 MB; it is about 50 MB now.

Also unrelated to findings, the rounds of 13 November replaced substring searches over all bullets by an index
(`0765bfd`) and made background jobs stop with the server (`ed9ac84`).

## Since the penetration tests

Between the second re-test (`2d8d958`, 14 November) and this status check (`0c62f02`, 15 November) the development
branch got 216 more commits. The security-relevant ones, each with its own Go tests, read for this check but not
attacked in a penetration test:

- **OpenID Connect back-channel logout** (`d80bd73`, `84f3a5a`): a new public endpoint
  `POST /api/v1/auth/oidc/backchannel-logout`. The logout token is checked as the specification asks: signature with
  the provider's keys, `iss`, `aud`, a recent `iat`, the logout event, `sub` or `sid`, a `jti` that is accepted once
  (replay memory capped at 10,000), no `nonce` (an ID token cannot pass as one), body at most 16 KiB, refused tokens
  limited per address. It ends only sessions started through the provider. `OIDC_BACKCHANNEL_LOGOUT=false` turns it
  off. A role changed by the provider's admin group now ends earlier sessions and live connections (`564992d`).
- **Sessions:** signing out takes effect at once, every token is checked against its session (`b514b67`); idle tabs
  of an ended session fall back to the sign-in (`89b2fda`).
- **Operator command line** in the server binary (`3740dfc`, `b784d24`): accounts, a new password for a locked-out
  account, the admin role, an integrity check. It needs access to the host or container, never migrates the database,
  refuses to run in the demo, reads passwords only from a file or stdin (never from the command line) and records its
  changes in the audit log.
- **Audit log of the administration** (`ab037a2`, `b66397b`, `ab72a05`, migration 60): admin changes, the command
  line and sign-up events are recorded; for passwords and webhook addresses only the fact of a change is stored.
  Readable by administrators only (`GET /admin/audit`).
- **Password reset options** (`a6d6d6a`): an administrator can require a new password at the next sign-in; until then
  the session gets nothing but that step, streams and webhook deliveries included (same gate as the required second
  factor). Organization names are unique.
- **Outgoing proxy with address check** (`854d9a6`): with `HTTP(S)_PROXY` set, webhooks, push, link previews, image
  copies and the update check go through the proxy. Before a request is handed over, the server resolves the target
  itself and refuses it when any of its addresses is in a blocked range; each redirect is checked again. What remains
  (documented in `Doku/security.md`): the proxy may resolve a name differently. See the observation below.
- **Calendar feed** (`bb9bf37`, `1ec5949`): a read-only iCalendar feed of one's open tasks at
  `/calendar/<token>.ics`. 256-bit token, looked up by its SHA-256 hash, stored encrypted with `SECRETS_KEY`; one feed
  per person, a new address revokes the old one; only active accounts; unknown tokens limited per address,
  `Referrer-Policy: no-referrer`. API keys and MCP cannot create or read a feed. Administrators can switch feeds off
  (`CALENDAR_FEEDS`). See the observation below.
- **Update check** (`5c658b7`): once a day the server asks GitHub's API for the latest release through the guarded
  client. It sends no data about the instance (only `MindSift/<version>` as User-Agent), accepts only plain release
  versions, and the release link shown to administrators must start with the project's release page.
  `UPDATE_CHECK=false` turns it off; the demo and non-release builds never ask.
- **API keys limited to MCP** (`bf75a40`): `API_KEYS_ENABLED=false` keeps personal keys away from the REST API.
- **MCP:** parallel large requests are limited (`c454b5d`).

**Observations from this status check** (not rated, not counted above), both settled before v0.96.0:

- **The proxy's own address was not checked:** a request that did not use the proxy (a `NO_PROXY` target or
  `localhost`) and named exactly the proxy's `host:port` reached the proxy directly. Only that port was reachable and
  the request arrived as TLS, so the effect was small. Fixed in `b9e025d`: the proxy's address is dialled only as the
  proxy, never as a direct target; confirmed by the fourth penetration test.
- **A calendar feed survives a new password and "sign out everywhere".** Like a public link, the address is the access
  and is not tied to a session. An administrator's password reset with "revoke keys" now switches it off together with
  API keys and AI connections (`22cec2e`); the person's own password change and "sign out everywhere" keep it, as
  documented. The owner can renew the address at any time.

## Later findings

Found on 23 November 2026 in a code review of the request handling (a shared check of write access to a note), not in
a penetration test; rated low and fixed the same day in `1a25f13`. Since then every request that changes a note checks
access in one place (`requireDocEdit` in `internal/api/doc_access.go`).

- **Note writes told someone else's note from a missing one.** Restructuring (extract, move, merge, inline and their
  undo), uploading and fetching pictures and creating hidden values checked access themselves and answered 403 "no
  write access" for someone else's note but 404 for a missing one, so any account could learn whether a note id
  exists. Both now answer the same 404; 403 is left for a note shared with the caller for reading. The MCP tools, the
  transcription of a recording and live drawing use the same check.
- **Merging and undoing an extraction answered 500 with a database message.** Merging someone else's or a missing
  note into one's own, or taking back the extraction of one, failed with an internal error whose text was the raw
  `sql: no rows in result set`. They answer 404 now; other failures of restructuring keep their details in the server
  log (`writeRestructureError`).

## Penetration tests with fuzzing

Three runs on 13 and 14 November 2026 and a re-test of all of them, plus a fourth run of the newer features on
16 November, all against local throwaway instances built from the development branch. Nothing was pointed at a
production or public host. Together the Go fuzzers ran about 83 million executions.

### First run (13 November, evening)

- **Attacked:** cross-account access (IDOR) to notes, bullets, folders, lists, task lists, files, hidden values,
  public links and shares including revocation, organization and group boundaries, API key scopes, token tampering
  (unsigned, altered signature and payload); sign-in rate limits and the setup code; injection and cross-site
  scripting through note, Markdown and import content against the Content Security Policy; server-side request
  forgery through link previews, image copies and webhooks (every address encoding: octal, hex, decimal, IPv6,
  IPv4-mapped, trailing dot, other schemes; a local sink was never reached); uploads and archive imports (content
  sniffing, SVG and script payloads, path traversal, zip slip, zip bombs, entry limits); the real-time channel
  (foreign rooms, malformed, oversized and flooding messages); resource limits; response headers.
- **Fuzzing:** 18 Go fuzz targets over the parsers (drawing model and SVG, Mermaid, due dates, email normalization,
  Markdown, Obsidian and JSON import including ZIP archives, tables, wiki links, mention, file and secret references,
  link-preview HTML), about 22 million executions, one crash (fixed, above); 28 REST endpoints with malformed input
  (broken and deeply nested JSON, duplicate keys, wrong content types, oversized, NUL and Unicode values), no dropped
  connection; 1,500 malformed WebSocket messages plus an oversized message and a flood, server healthy and memory
  flat; corrupt and polyglot uploads.
- **Result:** 0 high, 0 medium, 3 low (all fixed in `2821e80`), one hardening note (accepted). The two issues fixed
  earlier that day were attacked again and held.

### Second run (13 November, night)

- **Same code** as after the fixes of the first run. It re-tested every earlier fix and added three areas that had
  only been read in the code before.
- **MCP endpoint and its OAuth grant** (48 checks): keys and tokens stay within their scopes and routes, tool
  parameters cannot reach another account's notes, tasks, lists or list items, a revoked key stops at once; the OAuth
  flow enforces PKCE, binds the redirect address, treats authorization codes as single-use and invalidates the whole
  grant when a refresh token is reused.
- **OIDC sign-in against a local provider:** state and nonce are single-use and bound to the browser, ticket replay is
  refused, the callback address comes from the server's configuration, the return path cannot redirect to another
  site, an existing password account is never taken over by address, and the admin role comes only from the
  signature-checked identity token.
- **Passkeys with a virtual authenticator** (13 checks): registration and sign-in, a replayed registration is refused,
  a tampered origin is refused, passkey names are never rendered as markup, and removing the last factor under a
  required second factor blocks every further write until a new one is set up.
- **Also:** notification webhooks against the same SSRF encodings (no connection reached the sink), organization and
  group boundaries on a clean instance, the per-account connection limit under 60 parallel WebSocket attempts.
- **Fuzzing:** the same 18 targets for longer, about 25.5 million executions, no crash.
- **Result:** 0 high, 0 medium, 1 low (the taken address in the user administration, fixed later in `6f69fda`).

### Third run (13 to 14 November)

- **Account flows with a local mail sink:** password reset (same answer for known and unknown addresses, single-use
  links, tokens stored only as hashes, links built from `BASE_URL` and not from request headers, sessions ended
  afterwards), change of the login address (single-use confirmation, two requests racing for one address), TOTP
  replay, recovery codes, trusted devices bound to their account and revoked by a new password, step-up
  confirmation, sessions, sign-in and account lockouts (the account lockout held against made-up addresses).
- **Stored cross-site scripting in a real browser:** payloads in every block type, wiki links, mentions, hashtags,
  tables and drawings, opened on a public page and signed in; nothing ran.
- **Mails:** no header injection through display names, the HTML part escapes them.
- **Imports:** zip bombs, nested archives and the memory used while importing (where the medium finding came from).
- **Fuzzing:** 27 Go targets (the 18 earlier ones plus 9 new ones with invariants: sync operations keep a note valid,
  backup paths stay inside their folder, active content is never accepted as media, and parsers for recovery codes,
  scopes, email domains, reminders, media references and mount paths), about 36 million executions, no crash and no
  broken invariant; 75,728 GET requests over every documented path and query parameter from two accounts, no server
  error and no internal detail in any answer; the body fuzzing of the first run again, clean.
- **Result:** 0 high, 1 medium (archive import memory), 1 new low (public link password per address) and the low
  from the second run still open at that point; all three are fixed now (above). Side observations led to three of
  the hardening notes (image sources in the Content Security Policy, control characters in display names, the
  `TRUSTED_PROXIES` default), and the import path of the file-id note was tested here.

### Re-test against the fixed code (14 November)

- **Code:** the development branch at `895c6c1`, with the fixes for every finding of 13 November above (the fixes for
  the re-test's own findings came after it).
- **What ran:** every regression script of the earlier rounds, 24 scripts on separate fresh instances, about 300
  individual checks: permissions and IDOR, API key and MCP scopes, setup code, account flows with a local mail sink
  (including the two reset checks the rate limit had blocked in the third run), mails, uploads, SSRF, zip bombs and
  import memory (peak about +3 to +6 MB where it had been +813 to +2,359 MB), live drawing, metrics, the second factor
  on streams, stored XSS in a browser, passkeys with a virtual authenticator, REST and WebSocket fuzzing and again the
  75,728 GET requests (no server error). Where a fix changed an answer on purpose, the expectation was changed with it
  (for example, a reference to someone else's file now gives 404 instead of the picture, and a public link takes no
  passwords after 50 wrong ones).
- **Not run:** the penetration-test OIDC script against a local provider (no scripted set-up for it in this round),
  Go fuzzing. The OIDC sign-in itself is covered by the Go tests and by a browser test against a local Dex provider
  (`e2e/oidc.e2e.mjs`), which run before every release.
- **Result:** no regression in any security fix; every earlier finding stays fixed. New: 0 high, 0 medium, 3 low (an
  import on a new server, two imports at once, the MCP answer for someone else's task), all fixed (above), and one
  observation that is not security-relevant (fixed in `bd74bc7`). All of them were found and fixed the same day.

### Second re-test (14 November, evening)

- **Code:** the development branch at `2d8d958`, with the fixes for the re-test's own findings and for the final
  review, among them the reserved client ids of live drawing (`2792470`).
- **What ran:** the same scripts again on fresh instances, plus a new check that a note editor cannot use the client
  id of a running live drawing or of the server's own writers (49 checks).
- **Result:** 366 checks passed, none failed; no regression. Imports on a new server no longer slow down sign-ins, and
  two imports at once both succeed in every run.

### Re-test against the current code (15 November)

- **Code:** the development branch at `0c62f02`, image built from it, local throwaway containers only (demo, a server
  with `ADMIN_USER`, a fresh server without an account, a server with a required second factor).
- **What ran:** permissions and IDOR (50 checks), the extra checks for the taken address, the public link password and
  foreign file ids (23), SSRF in every encoding (11, no connection reached the sink), uploads (10), MCP and API key
  scopes (60), REST fuzzing (40 rounds, no server error, no dropped connection), setup code (20), reference index and
  hidden values (20), time zone and license list (26), zip bombs (4), the second factor on streams and the ingest
  webhook (5), live drawing (a reader cannot remove others; 49 checks on reserved client ids), WebSocket fuzzing
  (healthy, no leak).
- **Not run:** account flows with a mail sink, stored XSS in a browser, passkeys, OIDC against a local provider, Go
  fuzzing, and every load or memory measurement (import memory, metric labels, live drawing sessions, reference
  amplification).
- **Result:** 275 checks passed and none failed in the counting scripts, plus the second factor on streams (5 of
  5), the reader check of live drawing and the WebSocket fuzzing without findings; no regression of any fix. Plus the
  check of the outgoing proxy described under "Since the penetration tests".

### Fourth run (16 November)

- **Code:** the development branch at `c2367f8`, image built from it, local throwaway containers only, with a fake
  OpenID Connect provider (RS256 keys, full code flow) and an observing fake HTTP(S) proxy.
- **What ran:** the back-channel logout (17 checks: signature and algorithm, `none` and HS256 refused, wrong key id,
  an ID token passed as logout token, `jti` replay, missing claims, only provider sessions ended), the calendar feed
  (15: iCalendar injection through titles and notes, token lookup, revocation on renewal, deletion and an
  administrator's reset with revoked keys, no access with API keys, shared lists taken away), SSRF through the
  outgoing proxy (5: the proxy's own address, internal and reserved targets in every encoding, `localhost`), and 25
  further checks of the required password change (REST, streams, sync, webhook ingest), the operator command line,
  the audit log (administrators only, no secrets), the update check and `API_KEYS_ENABLED=false`. Note templates,
  image paste and list suggestions were looked at along the way.
- **Result:** all 62 checks passed, no rated finding. Two hardening notes, not counted in the table: (1) the two new
  public endpoints inherit the `TRUSTED_PROXIES` rule, so their per-address limits do not hold for clients inside a
  trusted range (same trade-off as L2, documented in `Doku/security.md`; covered by the provider's signature and
  256-bit feed tokens); (2) the replay memory of logout tokens lives in the process, so after a restart a captured,
  still fresh token could be replayed once, which only ends sessions that are already ended.
- **Not run:** a real OIDC provider (Keycloak, Authentik), DNS rebinding with a controllable resolver, a live
  man-in-the-middle of the update check, load and memory measurements, browser fuzzing of the audit log.

## Checked and found in order

- **First-time setup:** the one-time setup code has 60 bits from `crypto/rand`, is compared in constant time, never
  appears in responses, metrics or error messages, is rate-limited per address; eight parallel setup attempts with the
  right code create exactly one administrator; neither registration nor OIDC can create the first account.
- **Sign-in and accounts:** forged, altered and unsigned tokens are refused; sign-in locks after a few failures; the
  same answer for an unknown name and a wrong password; TOTP codes cannot be replayed; recovery codes work once;
  sensitive changes ask for the second factor; a new password ends the other sessions and the trust of devices.
- **Backups before migrations:** files `0600`, folder `0700`, not reachable through any download or restore endpoint,
  path tricks rejected; a full disk or a database from a newer version stops the start and leaves the database
  unchanged.
- **Time zone setting:** path-like names, `Local`, NUL bytes and over-long names are rejected; only administrators can
  change it, not in the demo.
- **Permissions:** every cross-account read and write is refused with the same 404 as for a missing object; a
  read-only share cannot write, add hidden values, set a public link, re-share or delete; revoking a share cuts access
  at once (on open realtime connections since 23 November, see History); foreign block ids are rejected in sync; an id prefix gives no access; hidden values need rights on their
  note of origin and never appear on public pages.
- **Files in shared notes:** a file is readable for whoever may read a note that shows it. A bullet may only point to
  files its writer uploaded or may read; references to other files are dropped on every way in (`a4f32d3`). A copy
  made while a note was shared keeps its picture after the share ends, like copied text (see
  [sharing-and-permissions.md](sharing-and-permissions.md#files-in-shared-notes)).
- **Outbound requests:** link previews, image copies, webhooks and push services resolve and check every address at
  connection time; loopback, link-local, metadata and private ranges are blocked in every encoding tried.
- **Frontend and headers:** no new HTML sinks; the Content Security Policy is strict (`script-src 'self'`, no
  framing, images only from MindSift); no cookies, so no cookie-based request forgery; no cross-origin reflection;
  `no-store` on API answers; the language loader only loads known languages; the service worker caches only HTML as
  the app page; the SVG export of drawings takes colours from a fixed palette and escapes text.
- **Supply chain:** no dependency runs install scripts; a renamed dependency of the emoji picker comes from the same
  maintainer and makes no network calls; the pull request workflow runs with read-only rights on `pull_request`, not
  `pull_request_target`.
- **Logs:** the English log output contains no secrets, tokens or codes (the setup code appears once, on purpose).

## Accepted trade-offs

These were kept on purpose; the first three are documented in [flaws.md](flaws.md):

- **Session token in `localStorage`** (FLAW-31). Mitigated by a strict Content Security Policy and server-side
  sessions that can be ended; moving to HttpOnly cookies would need CSRF protection throughout.
- **Changing one's login address reveals taken addresses** (FLAW-44). The settings answer 409 when another account
  uses the new address. It needs an account and its current password, and someone who mistypes should learn why no
  mail arrives.
- **SMTP password readable with the key** (FLAW-34, rest). Whoever holds the database and the secrets key together can
  decrypt it; the server needs it to sign in to the mail server. Keeping `SECRETS_KEY` in the environment holds the key
  apart from the data folder.
- **The OIDC client does not use the internal-network guard.** The provider's address comes only from the operator's
  configuration, and self-hosted providers usually run in the same private network, which the guard would block. In
  the same spirit, sign-ins through the provider rely on the provider's own second factor.
- **`TRUSTED_PROXIES=private` stays the default.** It trusts every device in the local network to state a client
  address, which makes a proxy in the same Docker network work without configuration. The documentation (`0cfe782`)
  says what it trusts and recommends `none` without a proxy and the narrowest range with one; the limits per account
  and per link hold either way.
- **SQLite only**, one process. A load test on 1 CPU core and 1 GB RAM ran 800 people at once with 0.02 % errors;
  at 1,200 the core is full and everything slows down, with 0.03 % errors ([Doku/performance.md](performance.md)).
- **Own TOTP implementation** (RFC 6238, constant-time comparison, reuse protection, tests) instead of a library.
- **Base images by exact release tag, not digest**, with `apk upgrade` in the build and a weekly Trivy scan.

## Limits

- No external reviewer. No test on real devices other than the maintainer's.
- The security scripts were re-run twice on 14 November, the second time against the code with the fixes for the
  re-test's own findings and for the final review. Changes after that run (copying hidden values with a bullet,
  search and note list changes for performance, and the features under "Since the penetration tests") come with their
  own tests; on 15 November the fixes were checked again in the code and the re-test scripts ran against it, and on
  16 November the new features were attacked in a fourth penetration test.
- OIDC was attacked in the second run only, against a local provider, not a live one; the re-test did not run that
  script again. The sign-in flow is checked before every release by Go tests and a browser test against a local Dex
  provider. Passkeys were tested with a virtual authenticator (second run and re-test), not with a physical key.
- Not tested: the expiry of reset and confirmation links (not waited out), a speech-recognition backend (not
  configured), DNS rebinding with an attacker-controlled resolver (assessed from the code, which pins the connection
  to the checked address), a real reverse proxy in front of MindSift, the arm64 image, the install script and the CI
  workflows themselves.
- Load was kept bounded; there were no long-running or saturation tests.
- An update from an older release was simulated by rolling back the last migration in a test database, not by
  upgrading a real installation.

## Reproducing

The re-test scripts are kept with the maintainer and run against a local instance only; the static checks run with
`ci/local-checks.sh` in every change (see [CONTRIBUTING.md](../CONTRIBUTING.md)). Security issues: please report them
privately as described in [SECURITY.md](../SECURITY.md).

## History

- **10 November 2026:** full review of v0.94.0, 20 findings plus side notes, fixed in `730309b`; leftovers fixed on
  11 November (`70ba567`, `e886725`, `db3f1cd`). The working notes of this review were not kept.
- **11 November 2026:** large notes and collaboration: a cap on blocks per note (`16114d7`).
- **13 November 2026, morning:** review of everything after v0.95.0 (second factor, passkeys, OIDC, live drawing,
  metrics).
- **13 November 2026, evening:** review of the changes of that day (setup code, backups before migrations, time zone,
  reference index, license page, frontend dependency updates), followed by the first penetration test.
- **13 November 2026, night:** second penetration test (MCP and OAuth, OIDC, passkeys).
- **13 to 14 November 2026:** third penetration test (account flows, browser XSS, mails, import memory, GET fuzzing,
  fuzzing with invariants), followed by the fixes of 14 November.
- **14 November 2026:** re-test of every regression script against the fixed code (OIDC excepted) and a final review
  of the changes before the release; their findings were fixed the same day, followed by a second re-test of the
  fixed code (no regression).
- **15 November 2026:** status check before v0.96.0: every fix checked again in the current code, the
  features added since read for security (see "Since the penetration tests").
- **16 November 2026:** fourth penetration test of the features added since the second re-test (see "Fourth run");
  no rated finding.
- **23 November 2026:** found while reworking the realtime events: realtime rooms were checked only when a
  connection joined them, so a connection open while its person lost access (share removed, out of a group, list or
  note deleted, note moved out of a shared folder) kept receiving the list's entries (`ITEM_*`) and the note's live
  drawing (`DRAW_*`) until it closed. Fixed: every such change rechecks the rooms concerned and takes the connection
  out (`Hub.RecheckRooms*`, `internal/api/realtime_access.go`), a live drawing also leaves the session;
  `TestLostAccessLeavesTheRealtimeRooms`, `TestTeamMembershipChangesAreLive`, `TestRecheckRoomsDropsLostAccess`.
- **23 November 2026:** two low findings in the access checks of note writes, found in a code review and fixed the same
  day (see "Later findings").

## Finding index

Every counted finding with the id of the working notes, its round, and the evidence in the code of 15 November
(`0c62f02`). Rounds: AM = review of the morning of 13 November, AE = review of the evening, PT1–PT3 = penetration
tests, RT1 = first re-test, R23 = code review of 23 November (code and tests as of `1a25f13`).

| Id | Round | Severity | Finding | Status | Fix | Code and test today |
|---|---|---|---|---|---|---|
| A3 | AM | High | Metric series from any HTTP method | Fixed | `962103c` | `methodLabel` in `internal/api/metrics.go`, `MaxHeaderBytes` in `cmd/server/main.go`; `TestMetricsMadeUpMethodsShareALabel` |
| A2 | AM | Medium | Live drawing: memory per user without a limit | Fixed | `897e6f4` | `MaxUserSessions`, `MaxSessions`, `MaxTotalBytes` in `internal/drawlive/session.go`; `TestLiveDrawingLimits` |
| A1 | AM | Medium | Live drawing: readers removed others | Fixed | `897e6f4` | own connection only, `internal/api/drawlive.go`; `TestLiveDrawingLeaveOnlyOwnConnection` |
| N1 | AE | Medium | Reference index: thousands of rows per bullet | Fixed | `9bb80f7` | `maxBlockRefs = 64` in `internal/storage/block_refs.go`; `TestBlockRefsCappedPerBullet` |
| Z1 | PT3 | Medium | Archive import memory spike | Fixed | `4895ebf`, `9a4dae0` | declared sizes and ratio check (`packedTooWell`) in `internal/storage/import_markdown.go`, `importGate` (one per person, two per server) in `internal/api/importgate.go`; `import_limits_test.go`, `TestImportsRunOneAtATime` |
| A4 | AM | Low | Required second factor skipped streams and ingest | Fixed | `796d8a8` | `sessionRestricted` in `authenticateStream` (`realtime.go`) and the ingest webhook (`handlers_integrations.go`); `TestRequiredMFABlocksStreamsAndIngest` |
| N2 | AE | Low | Setup code lock behind a shared address | Fixed | `80f4b49` | right code first in `checkSetupCode`, `internal/api/setup_code.go` |
| N3 | AE | Low | Reader could take over a hidden value | Fixed | `61c6003`, `a9aa709`, `cb5cf06` | values never move: `secretFor` in `internal/api/secrets.go` needs the note of origin, copies get their own value; `TestSecretCopiedByAReaderIsTheirOwn` |
| P1 | PT1 | Low | Client mistakes and missing access as 500 | Fixed | `2821e80` | `writeStoreError`; `TestForeignNoteWritesAreNotFound` |
| P2 | PT1 | Low | Deleting a list: existence oracle | Fixed | `2821e80` | `handleDeleteList`, `internal/api/handlers_lists.go`; `TestDeleteListWithoutExistenceOracle` |
| P3 | PT1 | Low | Panic in a link-preview text helper | Fixed | `2821e80` | `cleanText` in `internal/api/linkpreview.go`; `FuzzCleanText` in `pentest_regression_test.go` |
| Q1 | PT2 | Low | Taken address in the user administration as 500 | Fixed | `6f69fda`, `aeab2f9`, `7fa4bcc` | `EmailInUse` → 409 in `handlers_admin.go` (create and update); `TestAdminUserEmailTakenIsConflict` |
| U1 | PT3 | Low | Public link password limited per address only | Fixed | `0078a3c`, `79c8de4` | `publicLinkFailures = 50` in `internal/api/publiclinks.go`; `TestPublicLinkPasswordLockedAcrossAddresses` |
| A1 (RT1) | RT1 | Low | Import on a new server held the database | Fixed | `96215f1` | `sqlDropMisleadingStats` in `internal/storage/sqlite.go`; `lookup_indexes_test.go` |
| A2 (RT1) | RT1 | Low | Two imports at once could leave one half done | Fixed | `11ef45d` | `importMu` in `ApplyImport`; `TestFailedImportIsTakenOut` |
| NB1 (RT1) | RT1 | Low | MCP "Internal error" for someone else's task | Fixed | `9560820` | lookup first in `internal/api/mcp.go`; `TestMCPForeignIDsAnswerNotFound` |
| W1 | R23 | Low | Note writes: existence oracle (403 against 404) | Fixed | `1a25f13` | `requireDocEdit` in `internal/api/doc_access.go`; `TestNoteWriteChecksAnswerLikeMissingNotes` |
| W2 | R23 | Low | Merge and extract undo: 500 with a database message | Fixed | `1a25f13` | `writeRestructureError` in `internal/api/restructure.go`; `TestNoteWriteChecksAnswerLikeMissingNotes` |
| H1 | AM | Note | OIDC link by email address | Fixed (removed) | `7ce4bbd` | only `TestOIDCLinkByEmailRemoved` (the setting is ignored with a log line) |
| H2 | AM | Note | Reserved client ids of live drawing | Fixed | `2792470` | `reservedClientID` in `internal/api/docsync.go` and `restructure.go` |
| H1 | AE | Note | A file id worked as a key | Fixed | `a4f32d3`, `cf14a3a`, `879aeec` | `mediaGate` in `internal/storage/media.go`; `media_gate_test.go` (remaining case accepted as FLAW-43) |
| H2 | AE | Note | Reference index joins without note check | Fixed | `9bb80f7` | `b.document_id = r.document_id` in `internal/storage/block_refs.go` |
| H3 | AE | Note | Pre-migration copies without retention | Fixed | `a1c9f27` | `preMigrationMaxAge = 90 days` in `internal/storage/migrations.go`; `TestPreMigrationBackupsExpire` |
| H4 | AE | Note | CI actions pinned by tag | Fixed | `7b99553` | every `uses:` in `.github/workflows/` pinned to a commit hash |
| H5 | AE | Note | License list with exact versions, public | Fixed | `f836fda` | `/api/v1/third-party-licenses` inside the authenticated routes; `TestThirdPartyLicenses` |
| H6 | AE | Note | License script with unquoted file names | Fixed | `44f548e` | `while IFS= read -r f` in `ci/third-party-licenses.sh` |
| M3 | PT3 | Note | Control characters in display names | Fixed | `6f69fda`, `f18bbbc` | `internal/domain/name.go` (`bidiControl`); `TestCleanDisplayName` |
| CSP | PT3 | Note | `https:` in `img-src` | Fixed | `107d554` | `img-src 'self' data: blob:` in `internal/api/headers.go` |
| H-a | PT1 | Note | OIDC client without the internal-network guard | Accepted | – | `internal/api/oidc.go` uses its own `http.Client`; see "Accepted trade-offs" |
| L2 | PT3 | Note | Default `TRUSTED_PROXIES=private` | Accepted | `0cfe782` (docs) | default unchanged in `internal/config/config.go`, `docker-compose.yml`, `.env.example` |
