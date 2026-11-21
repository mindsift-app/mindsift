# MindSift desktop

A Wails v3 shell around MindSift for Linux and Windows (no macOS). Phase 0 proved the approach, phase 1
added the server's desktop mode, phase 2 the start view with several instances and servers; it is not a
release yet.

- **Start view** (`/__desktop/start`): a view of the frontend (`features/desktop/DesktopStartView.tsx`),
  in the look of the sign-in page and the system's language. It lists the entries used lately (local
  instances and servers mixed, newest first), the instance folders found in the base folder that are not
  listed (also ones copied there by hand), "Neue lokale Instanz…" (a name) and "Mit Server verbinden…"
  (name and address, checked with `GET /api/v1/health`). Entries can be renamed and removed from the list;
  removing never deletes data. The entry opened last opens directly at the next start. The tray menu has
  "MindSift öffnen", "Instanz wechseln…" (the start view, also Ctrl+Shift+O for desktops without a
  tray) and "Beenden", in the system’s language (`internal/shell/texts.go`).
- **Base folder:** `$XDG_DATA_HOME/MindSift` (`~/.local/share/MindSift`; under Flatpak `XDG_DATA_HOME`
  already points into the sandbox) or `%APPDATA%\MindSift`; `MINDSIFT_DESKTOP_DIR` overrides it. It holds
  `desktop.json` and every local instance in `instances/<Name>/`; the single data folder of phase 1,
  `data/`, stays where it is and becomes the instance "MindSift". The start view names the folder and opens
  it in the file manager. No other folder is ever opened, so no folder dialog and no portal are needed.
- **Local instances:** the MindSift server runs inside the app. Its router is the Wails asset handler, so
  no port is opened and nothing but the app's own window can reach it (`wails://localhost/` on Linux,
  `http://wails.localhost/` on Windows are served by the webview itself). One instance at a time:
  switching closes the running server cleanly (requests, hub, background jobs, database) and opens the
  next in the same process. `mindsift.lock` in the instance folder (flock / LockFileEx, dropped by the
  system when the process ends) keeps a second app process from opening the same database.
- **Servers:** the window loads a MindSift server's web app, offline behaviour as in the browser.
- **Cloud sync:** when the base folder lies in a synced folder (Nextcloud, ownCloud, Dropbox, OneDrive,
  Google Drive, iCloud, Syncthing, pCloud, MEGA …), the start view warns that syncing an open SQLite
  database can destroy it and recommends a server for several machines.

## Settings (`desktop.json`)

```json
{
  "version": 1,
  "entries": [
    {"id": "3f…", "kind": "local", "name": "Privat", "path": "/home/anna/.local/share/MindSift/instances/Privat", "lastOpened": "2026-11-21T10:00:00Z"},
    {"id": "9a…", "kind": "server", "name": "Arbeit", "url": "https://notes.example.com/"}
  ],
  "last": "3f…"
}
```

A file of phase 1 (`{"mode": "local"|"remote", "serverUrl": …}`) or none is converted once on loading:
`data/` becomes the entry "MindSift" (when it holds `mindsift.db` or local mode was chosen), a chosen
server a server entry, and the mode chosen last the entry opened next. A file that cannot be parsed is kept
as `desktop.json.broken`.

## The shell's endpoints

`POST /__desktop/api/<op>` with a JSON body (`state`, `create`, `open`, `open-found`, `add-server`,
`rename`, `remove`, `show-base`), code in `desktop/internal/shell`. They answer only requests with the
header `X-MindSift-Desktop: 1`, `Content-Type: application/json`, no foreign `Origin` and no cross-site
`Sec-Fetch-Site`. A server's page shown in the window (or any other origin) cannot send that header
without a CORS preflight, which the shell never allows, so its requests never arrive. Errors come back as
`{"error": {"code", "detail"}}` and are shown from the locale files (`desktop:errors.<code>`).

All local instances share the window's origin, so the frontend remembers which instance the window's
storage belongs to (`mindsift:desktop-instance`) and clears the session, the offline cache and stored
notes before another instance opens (`lib/desktopShell.ts`); the new one signs itself in.

## Desktop mode of the server

`main.go` calls `config.ApplyDesktop` after `config.Load` (no environment variable can switch it on, on a
normal server neither). Details in [Doku/architecture.md](../Doku/architecture.md#desktop-mode).

- **No sign-in, one person.** The first start creates the one account (administrator, named after the
  system's user, no password of its own) with the help notes; there is no setup wizard and no setup code.
  The window asks `POST /api/v1/auth/desktop` for a session whenever it has none (first start, a session
  idle for a month); a restart keeps the stored one. Only the window's own origin gets a session, and no
  secret is in any address. Sign-out is hidden, since there is no sign-in to go back to.
- **Off:** registration and invites, mail, OIDC, passkeys, public links, calendar feeds, web push, demo
  mode, the setup code, `BASE_URL` (so no OAuth connectors). The administration hides people, sign-in,
  organizations, sharing, mail and legal texts; the settings hide Sicherheit, the calendar subscription,
  the address and the mail and push channels of alarms.
- **Kept:** MCP with API keys (local AI agents), daily backups (on from the first start), export and
  import. Moving to a server later is a backup restored there.
- **Realtime without WebSocket:** server-sent events on Linux, long polling on Windows (Wails buffers
  responses there). The server names the transport in `/auth/status` (`desktop.realtime`).
- **Time zone and language** come from the system unless `TZ` or `DEFAULT_LANGUAGE` are set: on Linux
  `/etc/localtime` and `LANGUAGE`/`LC_ALL`/`LC_MESSAGES`/`LANG`, on Windows the display language (the
  time zone stays UTC there until set in the administration).

It is a module of its own (`desktop/go.mod`, replacing the main module with `../`), so Wails stays out of
the server's dependencies. `desktop/internal/shell` needs no window and is tested without GTK:
`go test ./internal/...` in `desktop/`.

## Build

```bash
desktop/build.sh            # frontend, Linux and Windows binary into desktop/out/
desktop/build.sh linux      # only Linux (cgo, GTK4 + WebKitGTK 6.0, built in golang:…-trixie)
SKIP_FRONTEND=1 desktop/build.sh windows   # reuse frontend/dist
```

Pushes to the `desktop-spike` branch are built by `.gitea/workflows/desktop-spike.yaml` (the same script,
run with docker); the Linux binary and the Windows exe are artifacts of the workflow run in the Gitea UI.

The Linux binary needs GTK 4 and WebKitGTK 6.0 at runtime (Debian/Ubuntu: `libgtk-4-1
libwebkitgtk-6.0-4`, Fedora: `gtk4 webkitgtk6.0`, Arch: `gtk4 webkitgtk-6.0`). The Windows binary needs
the WebView2 runtime (part of Windows 10/11).

## Known limits

- No Web Push in the webview; alarms would come through the shell later (Discord and webhooks work).
- Drawing together needs a WebSocket and is not available (one person anyway).
- The tray needs a StatusNotifier host (KDE, most desktops; GNOME only with the AppIndicator extension).
