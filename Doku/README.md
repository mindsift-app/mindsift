# MindSift Technical Documentation

Reference for developers and administrators. It describes the current development state (branch `dev`); released versions are on `main`, and the [changelog](../CHANGELOG.md) says what changed since the last release. Please report discrepancies between the documentation and code as a [GitHub issue](https://github.com/mindsift-app/mindsift/issues); known weak spots are in [flaws.md](flaws.md).

## Contents

| Document | Description |
|---|---|
| [architecture.md](architecture.md) | Structure, technology stack, design decisions, startup, configuration, build |
| [database.md](database.md) | SQLite schema, migrations, data model |
| [api/rest.md](api/rest.md) | All REST endpoints |
| [api/openapi.json](api/openapi.json) | Every route with a short description (OpenAPI 3.1, checked against the router by a test) |
| [api/websocket.md](api/websocket.md) | Real-time communication via WebSocket and SSE, events |
| [modules/triage.md](modules/triage.md) | Quick capture and triage |
| [modules/tasks.md](modules/tasks.md) | Tasks, Kanban, reminders |
| [modules/workspace.md](modules/workspace.md) | Outliner notes, folders, tags |
| [modules/collaboration.md](modules/collaboration.md) | Collaborative note editing: log, locks, conflicts, offline, transport tiers |
| [modules/lists.md](modules/lists.md) | Shared lists |
| [sharing-and-permissions.md](sharing-and-permissions.md) | Roles, groups, sharing permissions |
| [operations.md](operations.md) | Running MindSift: install script, first admin, backups, updates, rolling back and restoring, monitoring, image tags |
| [oidc.md](oidc.md) | Single sign-on through an OpenID Connect provider: settings, accounts, provider examples |
| [security.md](security.md) | What protects the data, security scan of the image |
| [performance.md](performance.md) | Load test on 1 CPU core and 1 GB RAM |
| [reverse-proxy.md](reverse-proxy.md) | Nginx, Traefik, Caddy, Cloudflare |
| [theming.md](theming.md) | Themes and design variables |
| [i18n.md](i18n.md) | Languages: where texts live, adding a language |
| [ui-patterns.md](ui-patterns.md) | Standard UI elements: user search, avatar stack, counters |
| [flaws.md](flaws.md) | Known flaws and technical debt |

## 60-Second Overview

- **Single Go binary** serves the REST API, WebSocket/SSE, and the embedded React frontend (`go:embed`). There is exactly one container and one SQLite file (`/data/mindsift.db`).
- **Data storage:** Entirely in SQLite. There are no `.md` files on disk; Markdown is generated on demand from blocks (`documents.markdown_cache`, export as `.md`).
- **Real-time:** A hub with rooms and user channels (WebSocket, SSE as fallback). Broadcasts events following changes.
- **Collaborative note editing:** Server-authoritative operation log with versions and per-bullet locks, conflict copies instead of overwrites, offline queue in IndexedDB, synchronization even behind restrictive proxies ([modules/collaboration.md](modules/collaboration.md)).
- **Auth:** JWT (HS256) with server-side sessions (`sessions`, sliding 30-day expiry) and `token_version`, plus API keys (`mindsift_sec_…`) for webhooks.
- **Sharing:** Task lists, shared lists, notes, and folders each with Editor or Viewer roles.

## Development

```bash
# Backend (Go 1.27)
go vet ./cmd/... ./internal/... && go test ./cmd/... ./internal/...

# Frontend (Node 26)
cd frontend && npm ci && npx tsc --noEmit && npm run test:run && npm run build

# Everything at once in containers (podman, no local Go or Node): the checks above plus ESLint,
# gofmt and golangci-lint (.golangci.yml, with staticcheck); E2E=1 adds the browser tests
ci/local-checks.sh
```

The frontend is built to `cmd/server/dist` for inclusion in the binary (see `Dockerfile`). CI runs twice using the same build plan (`ci/build-plan.sh`): on private Gitea (`.gitea/workflows/`, images of `main` only, without tests) and on GitHub (`.github/workflows/`, public images at `ghcr.io/mindsift-app/mindsift`, for amd64 and arm64; only the build of `main` runs the tests, all other builds rely on `ci/local-checks.sh` before the push). On GitHub, a version tag also gets its release page from the matching `CHANGELOG.md` section (`.github/workflows/release.yaml`, `ci/release-notes.sh`; versions before 0.80.0 are in `CHANGELOG-archive.md`), with the server binaries for Linux attached (`ci/release-binaries.sh`).
