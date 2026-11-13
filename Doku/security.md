# Security

What protects the data on a MindSift server, and how the image is scanned. The README has the short version; how sign-in, sessions and the second factor work inside is in [architecture.md](architecture.md#authentication), sign-in through a provider in [oidc.md](oidc.md). To report a vulnerability, follow [SECURITY.md](../SECURITY.md).

MindSift is meant to be reachable from the internet behind a reverse proxy ([reverse-proxy.md](reverse-proxy.md)). The whole code base was reviewed for security in November 2026 (v0.94.0), and the findings are fixed (see the [changelog](../CHANGELOG.md)). Sign-in through OpenID Connect, two-factor sign-in and passkeys came after that review; they have their own browser tests ([e2e/](../e2e/README.md)).

## What protects your data

### Sign-in

- **Passwords** are hashed with bcrypt over a SHA-256 of the whole password, so long passphrases count to the last character.
- **Two-factor sign-in** with an authenticator app (TOTP), passkeys or both, plus ten one-time recovery codes, can be switched on per person or required by the administration for admins or for everyone; a device can be trusted for 30 days. With it on, a new password or address, deleting data or the account and creating an API key ask for the second factor too, every change to it is mailed to the account, and an administrator can reset it for somebody who lost it.
- **Passkeys** (WebAuthn, user verification required) also sign in without a password and cannot be phished: they are bound to the host of `BASE_URL` (https only).
- **OpenID Connect:** sign-in through a provider uses the authorization code flow with PKCE, state and nonce and checks the ID token completely (signature against the provider's keys, issuer, audience, expiry, nonce); the session token never appears in an address, the provider sends back a one-time ticket that only the browser that started the sign-in can trade.
- **Sessions:** every login is a server-side session tied to a signed token; sessions are listed under Settings → Security, can be ended one by one, end after 30 days without use and with any password change.
- **Rate limits:** failed sign-ins lock the account for that address after 3 tries, the account after 20 and the address after 30, each for 15 minutes; registration, "forgot password", the password asked before deleting data and the passwords of public links are limited the same way. A failed sign-in takes as long whether the account exists or not.

### Secrets never in plain text

API keys, OAuth tokens, reset and confirmation links and the tokens of public links are stored only as SHA-256 hashes. Hidden values in notes are encrypted with AES-256-GCM under a key kept apart from the database (`SECRETS_KEY`).

### Rights checked on every request

Notes, folders, lists and task lists resolve the caller's role (owner, editor, viewer) on each call ([sharing-and-permissions.md](sharing-and-permissions.md)). API keys and MCP connections reach only what their scopes allow, OAuth tokens only the MCP endpoint. Public links are read-only, live at most 14 days, can carry a password and hide names, hidden values and links to other notes.

### Addresses stay private

Others see names, usernames and profile pictures, never e-mail addresses. A new login address counts only once its owner clicks the link mailed to it, and mail alarms and test mails go only to that confirmed address, so the server cannot be used to mail strangers.

### Browser hardening

HSTS over https, a strict Content Security Policy (scripts only from MindSift itself, no embedding in other sites), links in notes limited to http(s) and mailto, uploads recognised by their content (no SVG, no scripts), media and previews served with a sandboxing policy. Profile pictures are uploaded, never loaded from other servers.

### Nothing reaches into your network

Every address the server contacts (webhooks, Discord, push services, link previews, image copies) is checked at connection time against localhost, link-local, cloud-metadata and private ranges, after DNS and after redirects (never from https down to http); private ranges only with an explicit admin switch. `X-Forwarded-*` headers only count from trusted proxies (`TRUSTED_PROXIES`, see [reverse-proxy.md](reverse-proxy.md)).

### Limits everywhere

Request bodies capped per endpoint, realtime connections capped per account, import archives checked for size and file count before anything is written.

### Quiet logs and errors

Tokens of public links and typed sign-in names stay out of the log; unexpected errors tell clients and AI agents nothing about the database or files.

### Supply chain

The image runs as an unprivileged user and every release is scanned with Trivy (below). `govulncheck` and `npm audit` report no vulnerability reachable from the code (November 2026).

## Security scan

The image is scanned with [Trivy](https://trivy.dev) for known vulnerabilities, leaked secrets and misconfigurations:

- **every tagged release** (`:stable`, `:vX.Y.Z`) before it is published, and every build that changes the base image, the Go version or the Go modules. A known high or critical vulnerability that already has a fix, or a leaked secret, stops the release;
- **the published `:stable` and `:latest` every week**, because new vulnerabilities become known after a release. The [badge in the README](../README.md#security) shows the last weekly run, its log the result.

How the scan runs in CI is described under [Build](architecture.md#build).

### Base images and pinning

The base images (`golang:1.27-alpine`, `alpine:3.24`) are referenced by tag, not by digest, so each build gets their security fixes without manual updates (Node, `node:26.13.0-alpine`, only builds the frontend and is pinned to a release); the last stage also runs `apk upgrade`. The application's own dependencies are pinned: `npm ci` installs exactly what `package-lock.json` lists, and the Go modules are checked against `go.sum`.

### When you scan the image yourself

```bash
docker run --rm aquasec/trivy image ghcr.io/mindsift-app/mindsift:stable
```

- **A missing `USER` line is intended:** MindSift runs as the user `mindsift` (uid 1000) since v0.87.3. The image starts as root only to hand `data/` to that user, then drops the rights ([architecture.md](architecture.md#container-user)).
- **Entries for code MindSift does not call:** Trivy lists everything known about a module, for example the `openpgp` package of `golang.org/x/crypto`, of which MindSift only uses `bcrypt`. [govulncheck](https://go.dev/blog/govulncheck) follows the code that is actually called and reports nothing that affects MindSift.

### SQLite

Neither tool sees **SQLite itself**: it is built in through [modernc.org/sqlite](https://gitlab.com/cznic/sqlite), a Go translation of SQLite's C code, so scanners see only a Go module. That module is updated by hand when SQLite publishes fixes ([release notes](https://sqlite.org/changes.html)). The log names the SQLite version at startup (`Database opened sqlite=3.54.1`), so you can compare it with SQLite's [list of known vulnerabilities](https://sqlite.org/cves.html).

## Known limits

- **No end-to-end encryption:** the server reads your data, because search, sharing and AI agents need it; only hidden values (`/secret`) are encrypted in the database. Protect the server and its disk.
- Further known weak spots (for example the sign-in token in `localStorage`) are listed in [flaws.md](flaws.md).
