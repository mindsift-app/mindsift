# Plan: OAuth for MCP Access (Draft)

As of 2026-11-01, **implemented in v0.51.0**. Goal: MindSift can be added as a connector in **claude.ai**, the mobile Claude app, and **ChatGPT in the browser**. These clients cannot set an `X-API-Key` header; instead, they require the OAuth flow defined in the MCP specification (authorization, as of 2025-06-18). To support this, MindSift becomes an OAuth server for its own MCP endpoint.

Not part of this plan: Logging in **to** MindSift via third-party providers (OIDC), see [registrierung-und-login.md](registrierung-und-login.md), Section 4.

## Current State

- MCP endpoint `POST /api/v1/mcp`, authenticated via `authMiddleware`: API key (`mindsift_sec_…`) as `X-API-Key` or `Authorization: Bearer`, alternatively an active session.
- A key has permissions (`tasks:read`, `lists:write` …), `mcpToolAllowed` exposes only permitted tools, changes are attributed with origin `mcp` alongside the key name.
- The session is stored in frontend `localStorage`, not in a cookie. Therefore, the server cannot determine who is logged in from a simple page load request.

## User Experience

1. In claude.ai: *Settings → Connectors → Add Custom Connector*, URL `https://<instance>/api/v1/mcp`.
2. The browser opens MindSift. Users who are not logged in log in as usual.
3. A consent page: **"Claude would like to access your MindSift"**, with permission checkboxes below (read tasks, modify tasks, read lists, modify lists, write to inbox), pre-selected according to what the client requests. **Allow** / **Deny** buttons.
4. Back in claude.ai, the tools are available.
5. In *Settings → API Keys*, the connection appears as a dedicated entry "Claude (OAuth)" with permissions, "last used" timestamp, and **Revoke**. Modifying permissions works just like for any API key.

Entities created by the agent bear a badge with the entry name, as is standard today.

## Core Idea: An OAuth Access Grant is an API Key

Consent creates a standard entry in `api_keys` (new column `kind = 'oauth'`, plus `oauth_client_id`). There is no key secret to copy or type: `key_hash` is assigned a random value known to no one. Tokens are associated with this entry.

This preserves permission checks (`mcpToolAllowed`, `apiKeyRouteDenied`), origin tracking (`origin`), "last used" timestamps, renaming, modifying permissions, and revocation without changes. If the entry is deleted, cascading foreign keys automatically remove the tokens.

## Endpoints

All accessible without authentication, except for consent.

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` (also with path suffix `/api/v1/mcp`) | Protected resource metadata (RFC 9728): `resource`, `authorization_servers`, `scopes_supported` |
| `GET /.well-known/oauth-authorization-server` | OAuth authorization server metadata (RFC 8414): endpoints, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported`, `token_endpoint_auth_methods_supported: ["none"]` |
| `POST /oauth/register` | Dynamic client registration (RFC 7591), as used by claude.ai and ChatGPT |
| `GET /oauth/authorize` | Serves the frontend app (like any page); the app renders the consent UI |
| `GET /api/v1/oauth/authorize` | Validates parameters and returns client name, redirect URI, and requested scopes for the consent page (authenticated) |
| `POST /api/v1/oauth/authorize` | Approve or deny; returns redirect URL with `code` and `state` (or `error=access_denied`), app redirects (authenticated) |
| `POST /oauth/token` | Exchange `authorization_code` for tokens, refresh `refresh_token` |
| `POST /oauth/revoke` | Revoke token (RFC 7009), optional, good practice |

At the MCP endpoint, MindSift responds without a valid token with `401` and
`WWW-Authenticate: Bearer resource_metadata="https://<instance>/.well-known/oauth-protected-resource"`. This signals to clients that they must initiate the OAuth flow. Currently, this header is missing.

No dedicated CORS needed for these endpoints: claude.ai and ChatGPT invoke them server-side. Browser clients like the MCP Inspector cannot reach the MCP endpoint anyway as long as `BASE_URL` restricts allowed origins.

## Detailed Flow

**Registration:** The client sends `client_name` and `redirect_uris`. MindSift stores it in `oauth_clients` and returns a `client_id`. Only public clients are supported (no client secret); security is provided by PKCE and strict redirect URIs.
- Redirect URIs must be `https://…` or `http://localhost`/`127.0.0.1` (desktop clients), no URI fragments allowed.
- Rate limiting per IP similar to login. Clients that receive no authorization consent within 24 hours of registration are purged during cleanup.

**Consent:** `response_type=code`, `client_id`, `redirect_uri` (must match registered URIs exactly), `code_challenge` with `code_challenge_method=S256` (required), `state`, `scope` (optional), `resource` (RFC 8707, if specified must match `<BASE_URL>/api/v1/mcp`).
- If `client_id` or `redirect_uri` do not match, the app displays an error and does **not** redirect. All other errors are redirected back as `error=…` to the redirect URI.
- Upon **Allow**, MindSift creates the entry in `api_keys` (Name = `client_name` + " (OAuth)", permissions = checked boxes). If the same user has already authorized the same client, the existing entry is reused and its permissions are updated to prevent duplicates.
- The authorization code is valid for 10 minutes, single-use only, and stored exclusively as a hash.

**Token:** The exchange validates code, `client_id`, `redirect_uri`, and `code_verifier`. Result:
- `access_token` `mindsift_oat_…`, valid for 1 hour
- `refresh_token` `mindsift_ort_…`, valid for 90 days, rotated on each refresh. If an already replaced refresh token is reused, all tokens for this entry are invalidated (theft detection/revocation).
- `scope` reflecting the actually granted permissions

**Usage:** `authenticateToken` detects `mindsift_oat_` and returns the user and `apiKeyAuth` of the associated entry. From there, everything proceeds like standard API key authentication. OAuth tokens are valid **only for the MCP endpoint** (for which they were issued), not for REST endpoints.

## Scopes

Existing permissions are reused directly as OAuth scopes (`tasks:read`, `tasks:write`, `lists:read`, `lists:write`, `webhook:triage`; granular `webhook:task`/`webhook:list` are not shown on the consent page). If a client requests no `scope` (as claude.ai often does), **Read and Write for Tasks and Lists** are pre-selected by default on the consent page; Inbox remains disabled. Notes remain inaccessible as they are today.

## Database

```sql
ALTER TABLE api_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'key';   -- key | oauth
ALTER TABLE api_keys ADD COLUMN oauth_client_id TEXT NOT NULL DEFAULT '';

CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,               -- client_id
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,       -- JSON array
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- access | refresh
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  replaced_at TEXT NOT NULL DEFAULT ''  -- refresh: timestamp when rotated (to detect reuse)
);
```

Expired codes and tokens are purged by the existing cleanup job. Applied as a migration via `schema_migrations`.

## Prerequisites and Limitations

- **`BASE_URL` must be configured.** It serves as `issuer` and resource identifier; constructing it from the `Host` header would be vulnerable to spoofing. Without `BASE_URL`, OAuth is disabled: no `WWW-Authenticate` challenge header, and endpoints respond with 404. Settings will indicate "OAuth requires `BASE_URL`".
- **Reverse proxy:** `/.well-known/` and `/oauth/` must reach MindSift. With the example configuration in [reverse-proxy.md](../reverse-proxy.md) (`location /`), this is already satisfied; a note will be added there.
- **Demo mode:** OAuth disabled (demo data is reset periodically, access grants would be meaningless).
- **CSP:** The consent page redirects via `window.location`, not via form submission, so no `form-action` changes needed.
- **No dedicated admin toggle** for OAuth. A toggle for MCP access as a whole is a separate task; if MCP is disabled, OAuth is also disabled.
- **Inactive grants expire:** An OAuth entry unused for 90 days is deleted during cleanup (along with its tokens). Configurable via `OAUTH_IDLE_DAYS` (default `90`, `0` = never).

## User Interface

- New **Consent** view (`/oauth/authorize`), mobile-friendly: logo, client name, clearly visible redirect domain ("Redirecting to claude.ai"), permission checkboxes with existing labels from `ApiKeysPanel`, Allow/Deny buttons (44 px). Not logged in → redirect to login, then back to consent (query parameters preserved).
- **API key list:** OAuth entries flagged with badge "OAuth" and client name; "Show/copy key" is omitted for them.
- Replace **help text** in `ApiKeysPanel`: instead of "claude.ai … is not yet supported", provide brief instructions "Add as connector in claude.ai: `<BASE_URL>/api/v1/mcp`" with a copy button.

## Tests

- Go: full flow (register → consent → code exchange → invoke MCP → refresh), invalid `redirect_uri`, invalid `code_verifier`, code reuse, expired tokens, refresh token reuse detection, entry revocation, OAuth token rejected at REST endpoints, disabled without `BASE_URL`, disabled in demo mode. Expiry tested using injected clocks across multiple `TZ`.
- Frontend: Consent page (pre-selected permissions, denial).
- Manual: Connection from claude.ai against `dev` instance and via MCP Inspector.

## Documentation and Release

- `Doku/api/rest.md` (MCP section, new OAuth endpoints), `Doku/architecture.md`, `README.md` (feature list), `Doku/reverse-proxy.md`.
- New feature → minor version bump, CHANGELOG "Added: MindSift can be connected as a connector in claude.ai and ChatGPT".
- The website may mention "claude.ai not yet supported"; flag this for update rather than changing directly.

## Execution Order and Effort (Rough Estimate)

1. Database, token storage, `authenticateToken` for `mindsift_oat_`, `WWW-Authenticate` – small.
2. Metadata endpoints, registration, token endpoint with PKCE and refresh – medium.
3. Consent page and API key list – medium.
4. Tests, documentation, verification with claude.ai – small to medium.

No new Go dependency required: Standard library suffices for server-side implementation (SHA-256 for PKCE, `crypto/rand`); `golang.org/x/oauth2` is a client library and offers little benefit here.

## Decisions (2026-11-01)

- If `scope` is omitted, Read and Write for Tasks and Lists are pre-selected by default.
- No dedicated OAuth toggle; disabling MCP entirely will be handled separately.
- Refresh token validity: 90 days, rotated on every refresh.
- Inactive OAuth entries expire after 90 days, configurable via `OAUTH_IDLE_DAYS`.
