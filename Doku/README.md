# MindSift Technische Dokumentation

Referenz für Entwickler und Administratoren. Alle Angaben wurden gegen den Code im Branch `dev` geprüft (Stand Oktober 2026). Abweichungen zwischen Doku und Code melde bitte als Fehler in [flaws.md](flaws.md).

## Inhalt

| Dokument | Inhalt |
|---|---|
| [architecture.md](architecture.md) | Aufbau, Technologie-Stack, Start, Konfiguration, Build |
| [database.md](database.md) | SQLite-Schema, Migrationen, Datenmodell |
| [api/rest.md](api/rest.md) | Alle REST-Endpunkte |
| [api/websocket.md](api/websocket.md) | Echtzeit über WebSocket und SSE, Ereignisse |
| [modules/triage.md](modules/triage.md) | Schnellerfassung und Triage |
| [modules/tasks.md](modules/tasks.md) | Aufgaben, Kanban, Alarme |
| [modules/workspace.md](modules/workspace.md) | Outliner-Notizen, Ordner, Tags |
| [modules/collaboration.md](modules/collaboration.md) | Gemeinsames Bearbeiten von Notizen: Log, Sperren, Konflikte, Offline, Transport-Stufen |
| [modules/lists.md](modules/lists.md) | Geteilte Listen |
| [sharing-and-permissions.md](sharing-and-permissions.md) | Rollen, Gruppen, Freigaben |
| [reverse-proxy.md](reverse-proxy.md) | Nginx, Traefik, Caddy, Cloudflare |
| [theming.md](theming.md) | Themes und Design-Variablen |
| [ui-patterns.md](ui-patterns.md) | Einheitliche Bedienelemente: Personensuche, Profilbild-Stapel, Zähler |
| [flaws.md](flaws.md) | Bekannte Schwachstellen und technische Schulden |

## Überblick in 60 Sekunden

- **Ein Go-Binary** liefert REST-API, WebSocket/SSE und das eingebettete React-Frontend (`go:embed`). Es gibt genau einen Container und eine SQLite-Datei (`/data/mindsift.db`).
- **Datenhaltung:** vollständig in SQLite. Es gibt keine `.md`-Dateien auf der Platte; Markdown wird bei Bedarf aus den Blöcken erzeugt (`documents.markdown_cache`, Export als `.md`).
- **Echtzeit:** ein Hub mit Räumen und Benutzer-Kanälen (WebSocket, SSE als Ersatz). Verteilt werden Ereignisse nach Änderungen.
- **Notizen gemeinsam bearbeiten:** server-autoritatives Operations-Log mit Versionen und Sperren pro Bullet, Konfliktkopien statt Überschreiben, Offline-Warteschlange in IndexedDB, Abgleich auch hinter restriktiven Proxys ([modules/collaboration.md](modules/collaboration.md)).
- **Auth:** JWT (HS256) mit serverseitiger Sitzung (`sessions`, gleitend 30 Tage) und `token_version`, dazu API-Keys (`mindsift_sec_…`) für Webhooks.
- **Freigaben:** Aufgabenlisten, geteilte Listen, Notizen und Ordner jeweils mit Rolle Bearbeiter oder Leser.

## Entwickeln

```bash
# Backend (Go 1.23)
go vet ./... && go test ./...

# Frontend (Node 22)
cd frontend && npm ci && npx tsc --noEmit && npm run test:run && npm run build
```

Das Frontend wird für das Binary nach `cmd/server/dist` gebaut (siehe `Dockerfile`). Die CI läuft zweimal mit demselben Build-Plan (`ci/build-plan.sh`): im privaten Gitea (`.gitea/workflows/`, Tests und Images vor der Veröffentlichung) und auf GitHub (`.github/workflows/`, öffentliche Images unter `ghcr.io/mindsift-app/mindsift`).
