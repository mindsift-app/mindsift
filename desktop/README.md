# MindSift desktop

A Wails v3 shell around MindSift for Linux and Windows (no macOS). Phase 0 proved the approach, phase 1
added the server's desktop mode, phase 2 the start view with several instances and servers; it is not a
release yet.

- **Start view** (`/__desktop/start`): a view of the frontend (`features/desktop/DesktopStartView.tsx`),
  in the look of the sign-in page and the system's language. It lists the entries used lately (local
  instances and servers mixed, newest first), the instance folders found in the base folder that are not
  listed (also ones copied there by hand), "Neue lokale Instanz…" (a name) and "Mit Server verbinden…"
  (name and address, checked with `GET /api/v1/health`: 15 s in all, a failed connection is tried once
  more after a second; a server that answers wrongly is reported at once). Entries can be renamed and removed from the list;
  removing never deletes data. The entry opened last opens directly at the next start. The tray menu has
  "MindSift öffnen", "Instanz wechseln…" (the start view, also Ctrl+Shift+O for desktops without a
  tray) and "Beenden", in the system’s language (`internal/shell/texts.go`). In a local instance the
  profile menu has "Instanz wechseln" where sign-out would be; it loads the start view too.
- **Base folder:** `$XDG_DATA_HOME/MindSift` (`~/.local/share/MindSift`; under Flatpak `XDG_DATA_HOME`
  already points into the sandbox) or `%APPDATA%\MindSift`; `MINDSIFT_DESKTOP_DIR` overrides it. It holds
  `desktop.json` and every local instance in `instances/<Name>/`; the single data folder of phase 1,
  `data/`, stays where it is and becomes the instance "MindSift". The start view names the folder and opens
  it in the file manager. The only folder dialog is the backup folder's (`pick-folder`, the system's dialog
  through Wails, under Flatpak through the portal); the shell hands the choice to the window, the server
  checks it.
- **Local instances:** the MindSift server runs inside the app. Its router is the Wails asset handler, so
  no port is opened and nothing but the app's own window can reach it (`wails://localhost/` on Linux,
  `http://wails.localhost/` on Windows are served by the webview itself). One instance at a time:
  switching closes the running server cleanly (requests, hub, background jobs, database) and opens the
  next in the same process. `mindsift.lock` in the instance folder (flock / LockFileEx, dropped by the
  system when the process ends) keeps a second app process from opening the same database.
- **Reachable for local programs** (settings, API; per instance, off by default): the running instance
  also listens on `127.0.0.1:<port>` for an AI agent's MCP client or a script, see below.
- **Servers:** the window loads a MindSift server's web app, offline behaviour as in the browser. The
  shell marks such a page (see "The window and its pages"), so MindSift's frontend (from the version with
  this change on the server) offers "Instanz wechseln" on its sign-in page and next to sign-out in the
  profile menu; sign-out itself stays.
- **Keys:** Alt+Left / Alt+Right (back, forward), F5 / Ctrl+R (reload the page) and Ctrl+Shift+O (start
  view) work on every page, the shell's own and a server's.
- **Cloud sync:** when the base folder lies in a synced folder (Nextcloud, ownCloud, Dropbox, OneDrive,
  Google Drive, iCloud, Syncthing, pCloud, MEGA …), the start view warns that syncing an open SQLite
  database can destroy it and recommends a server for several machines.

## Settings (`desktop.json`)

```json
{
  "version": 1,
  "entries": [
    {"id": "3f…", "kind": "local", "name": "Privat", "path": "/home/anna/.local/share/MindSift/instances/Privat", "lastOpened": "2026-11-21T10:00:00Z", "localApi": {"enabled": true, "port": 18890}},
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
`rename`, `remove`, `show-base`, `pick-folder`, and for the app's settings `local-api` and `local-api-set`),
code in `desktop/internal/shell`. `pick-folder {path}`
opens the system's folder dialog at `path` (or its nearest existing parent) and answers `{path}`, empty when
cancelled; the setup wizard and the administration use it for the backup folder. The endpoints answer
only requests with the header `X-MindSift-Desktop: 1`, `Content-Type: application/json`, no foreign
`Origin` and no cross-site `Sec-Fetch-Site`. A server's page shown in the window (or any other origin) cannot send that header
without a CORS preflight, which the shell never allows, so its requests never arrive. Errors come back as
`{"error": {"code", "detail"}}` and are shown from the locale files (`desktop:errors.<code>`).

All local instances share the window's origin, so the frontend remembers which instance the window's
storage belongs to (`mindsift:desktop-instance`) and clears the session, the offline cache and stored
notes before another instance opens (`lib/desktopShell.ts`); the new one signs itself in.

## Reachable for local programs

A local instance has no port; for programs on the same computer (Claude Code, Codex, Cursor, a script) it
can get one. Switched on in the settings (API; `local-api-set {enabled, port}`), the shell starts an
`http.Server` on `127.0.0.1` only (`tcp4`, never a wildcard or IPv6 address) whose handler is the
instance's own router behind `api.LocalAPIOnly` (`internal/api/localapi.go`, `internal/shell/localapi.go`):

- **Reachable:** only what an API key may call anyway: `/api/v1/mcp`, the REST routes of `keyRoutes`
  (`internal/api/apikey_access.go`: tasks, lists, inbox) and `POST /api/v1/webhooks/ingest`. Every
  request needs an API key (`X-API-Key`, `Authorization: Bearer mindsift_sec_…`, `?token=` for the
  webhook) and must carry no other credential; the key's rights are then checked as on every server.
- **Not reachable:** everything else answers `404` (the app and its files, `/auth/*` including
  `/auth/desktop` and sign-in, notes over REST, settings, keys, live streams); a session token gets `401`.
  There is no OAuth (no `BASE_URL`), so MCP clients send the key as a header.
- **DNS rebinding and browsers:** a `Host` other than `127.0.0.1` or `localhost` is refused (`421`), any
  request with `Origin` or `Sec-Fetch-Site` too (`403`): no CORS, browsers get nothing.
- **Port:** stored per instance (`localApi.port` in `desktop.json`), so an agent's configuration always
  reaches the same instance. Switched on the first time, the shell takes 18890 or the next port no other
  instance has and no program holds; the settings show the address (`http://127.0.0.1:18890/api/v1/mcp`)
  and let the port be changed. A port held by another program is refused (`portInUse`); when that happens
  while the instance opens, the instance opens anyway and the settings say why.
- **Lifetime:** the listener belongs to the running instance: it starts when the instance opens with the
  setting on, stops when the setting goes off, and closes with the instance (switching instances, a
  server, quitting) before the database does.

Claude Code, for example: `claude mcp add --transport http mindsift http://127.0.0.1:18890/api/v1/mcp
--header "X-API-Key: mindsift_sec_…"`; the settings show this and the variants for Codex and JSON
configurations with the instance's address.

## The window and its pages

The window shows the shell's own pages (start view, local instances) on its own origin
(`wails://localhost`, `http://wails.localhost`) and servers' pages on theirs, possibly a server the person
does not run. Wails gives a page its runtime (`window._wails`, a wrapper around the engine's message
channel) and answers calls under `/wails/` itself, ahead of the asset handler: `POST /wails/runtime` with
`{object, method, args}` reaches window control (title, size, close, reload, dev tools, zoom), the
clipboard (read and write), dialogs (open/save, which return the chosen path), `Browser.OpenURL`,
application hide/quit, events and screens. A desktop build of Wails checks no origin there, and the
engine sends a server page's request to the window's origin without a preflight: checked under Xvfb, a
page on another origin set the window's title through a form posted to
`wails://localhost/wails/runtime` (a no-cors `fetch` gets through too). So:

- **`/wails/` only for the window's own pages** (`shell.GuardWailsRoutes`, the outermost asset
  middleware): `runtime.js`/`transport.js` stay readable, every other route needs `Origin` equal to the
  window's origin and no cross-site `Sec-Fetch-Site`; otherwise 403. The app itself calls none of them
  (the frontend uses no Wails runtime).
- **Runtime only on own pages.** Linux (`webview_linux.go`): a hook on `WindowLoadFinished`, registered
  before Wails' own, reads the page's address from the webview (`shell.OwnPage`); for any other page it
  cancels the event, which keeps Wails' runtime hook, the `JS` option and the event's listeners away, and
  runs the window's scripts (drop guard, file drop) and the marker itself. Windows
  (`webview_windows.go`): Wails injects its runtime straight from WebView2's `NavigationCompleted`, before
  any hook of the app, so it cannot be kept out; the hook of the event Wails sends next removes
  `window._wails`/`window.wails` again on other origins. What a page's scripts can grab in between is
  `chrome.webview.postMessage`, which WebView2 gives every page anyway. Still open on both platforms: the
  engine's own message channel (`window.webkit.messageHandlers.external`, `chrome.webview.postMessage`)
  exists on every page, and Wails acts on a few messages from it without an origin check (`wails:drag`,
  `wails:resize:*`, `wails:drag:doubleclick` = maximise, `wails:runtime:ready`; on Windows also
  `wails:non-client-region:*`): moving, resizing or maximising the window, nothing else.
- **Marker on servers' pages** (`shellMarker` in `main.go`): `window.__msDesktopShell` holds the start
  view's address and `mindsift:desktop-shell` fires; `lib/useDesktopShellStart.ts` takes only the two
  start view addresses. Loading the start view from a server's page is a normal top-level navigation
  (checked under WebKitGTK; not yet checked on Windows).
- **Keys and scripts:** Wails' `ExecJS` waits for `wails:runtime:ready`, which only its full runtime
  (`runtime.js`) sends and no page here loads, so `ExecJS("history.back()")` never ran; its Linux
  `Reload` loads `wails://` instead of the page. On Linux the keys call WebKit directly
  (`webkit_web_view_go_back/go_forward/reload`). On Windows the shell sends `wails:runtime:ready` itself
  once (`HandleMessage`), so `ExecJS` works, and Wails' `Reload` is `location.reload()`. Wails' `JS`
  option reaches only pages given as HTML on Windows, so there the hook above runs the window's scripts
  on every page (before this, the drop guard and `dropScripts` never ran on Windows).
- **The webview's storage** (local storage, IndexedDB, cookies, service workers, caches) lies in
  `<base>/webview/` (caches in `webview/cache/`, cookies in `webview/cookies.sqlite`), whatever the binary
  is called: Windows through `WindowsOptions.WebviewUserDataPath`; Linux by wrapping the constructor of
  `WebKitWebView` (at GApplication's `startup`, before the window exists) so a webview created without a
  network session gets one with these folders. Before, WebKit used `~/.local/share/app.mindsift.MindSift`
  and `~/.cache/app.mindsift.MindSift` (named after the application id, shared by every base folder) and
  WebView2 a folder next to the exe; nothing is moved. Wails still asks for WebKit's default session
  (unused), which leaves empty folders there.
- **Stale session:** a session stored for a database that is gone (instance folder deleted, a new base
  folder in old storage) is refused with 401; `useSessionBootstrap` then signs the window in again instead
  of showing the sign-in page, also when the 401 arrives before the status said desktop.

## Desktop mode of the server

`main.go` calls `config.ApplyDesktop` after `config.Load` (no environment variable can switch it on, on a
normal server neither). Details in [Doku/architecture.md](../Doku/architecture.md#desktop-mode).

- **No sign-in, one person.** The first start creates the one account (administrator, named after the
  system's user, no password of its own); there is no setup code and no account step. A short setup wizard
  follows once per instance: name, language, time zone, help notes, daily backups and their folder, all
  with defaults that one click accepts.
  The window asks `POST /api/v1/auth/desktop` for a session whenever it has none (first start, a session
  idle for a month); a restart keeps the stored one. Only the window's own origin gets a session, and no
  secret is in any address. Sign-out is hidden, since there is no sign-in to go back to ("Instanz
  wechseln" takes its place); the profile menu shows the name once and no role.
- **Off:** registration and invites, mail, OIDC, passkeys, public links, calendar feeds, web push, demo
  mode, the setup code, `BASE_URL` (so no OAuth connectors). The administration hides people, sign-in,
  organizations, sharing, mail and legal texts; the settings hide Sicherheit, the calendar subscription,
  the address and the mail and push channels of alarms.
- **Kept:** MCP with API keys (local AI agents, over the listener above), daily backups (on unless switched off in the wizard; into
  `backups/` of the instance or a folder chosen in the wizard or the administration), export and import. Moving to a server later is a backup restored there.
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
run with docker); the Linux binary, the Windows exe and the Flatpak bundle are artifacts of the workflow
run in the Gitea UI.

## Flatpak

```bash
desktop/packaging/flatpak/build.sh     # -> desktop/out/mindsift.flatpak
flatpak install --user mindsift.flatpak && flatpak run app.mindsift.MindSift
```

- **Files** in `packaging/flatpak/`: the manifest `app.mindsift.MindSift.yml` (each permission explained
  there), the AppStream metainfo and `build.sh`. The desktop file and the icons are those of
  `packaging/linux/`.
- **Runtime:** `org.gnome.Platform//51` (GTK 4, WebKitGTK 6.0). The binary is built inside
  `org.gnome.Sdk//51` with `org.freedesktop.Sdk.Extension.golang//26.08`, so it links against the
  runtime's libraries; the extension is pinned to a commit in `build.sh` (Go 1.27.3), the GNOME branch
  follows its security rebuilds. The bundle names Flathub as the runtime's source, so `flatpak install`
  fetches the runtime from there.
- **Build:** `build.sh` builds the frontend (node container), stages the repository with `frontend/dist` in
  `desktop/dist` and the Go modules vendored (`go mod vendor` in `desktop/`, which includes the main
  module through its `replace`), then runs `flatpak-builder` offline (`GOFLAGS=-mod=vendor`,
  `GOPROXY=off`) in a privileged Debian container; the runtimes stay in the volume `mindsift-flatpak`.
- **Data:** under Flatpak `XDG_DATA_HOME` is `~/.var/app/app.mindsift.MindSift/data`, so the base folder
  is `~/.var/app/app.mindsift.MindSift/data/MindSift`; the app needs no access to the home folder. It
  writes no desktop entry of its own (`FLATPAK_ID`); Flatpak exports the packaged one.
- **Flathub later** needs the sources in the manifest instead of the staged folder: a `git` source of the
  release tag, the Go modules as generated sources (e.g. flatpak-go-mod's `modules.txt` plus one archive
  source per module) or a vendor archive attached to the release, and the frontend either built from
  generated npm sources (flatpak-node-generator, with the node SDK extension) or taken as a release asset.

## App icon

The artwork is the web app's (`frontend/public/icon.svg`); `packaging/make-icons.sh` (podman) turns it into
the committed files: `packaging/linux/icons/hicolor/<size>/apps/app.mindsift.MindSift.png` (16-512, plus
the SVG as `scalable`) and `packaging/windows/app.ico` (16-256). Run it only when the artwork changes.

- **Application id `app.mindsift.MindSift`** (`Linux.ApplicationID` in `main.go`): Wails passes it to GTK as
  application id *and* program name, so it is the Wayland app-id and the X11 `WM_CLASS` of the window
  (checked under Xvfb with `xprop`). GTK 4 has no per-window icon; the desktop looks the app-id up in
  `app.mindsift.MindSift.desktop` and takes its `Icon=` from the `hicolor` theme.
- **Linux, loose binary:** at start (`desktopentry_linux.go`, logic in `internal/shell/desktopentry.go`)
  the app writes `~/.local/share/applications/app.mindsift.MindSift.desktop` (`Exec=` is the binary's
  absolute path, rewritten when it moves) and the icons into `~/.local/share/icons/hicolor/`, only when a
  file differs. It does nothing under Flatpak (`FLATPAK_ID`) or when the binary lies under `/usr/`. A
  launcher that scans late may show the entry only from the next start.
- **Flatpak later:** `packaging/linux/app.mindsift.MindSift.desktop` (`Exec=mindsift-desktop`) and
  `packaging/linux/icons/hicolor/` are the same files the binary embeds, so the manifest installs them as
  they are.
- **Windows:** `tools/mksyso` (run by `build.sh windows`) writes `resource_windows_amd64.syso` with the icon
  (resource id 3, where Wails looks for the window's icon), version information (file properties) and
  the application manifest of Wails' build (per-monitor DPI, common controls); `go build` links it in and
  the script deletes it afterwards. It is `wails3 generate syso` on the library Wails itself pins
  (tc-hib/winres v0.3.1, 2024-03-18), without the Wails command line.
- **Tray:** `icon.png`; the Wails `Icon` option holds the 512 px icon (about box, Windows fallback).

The Linux binary needs GTK 4 and WebKitGTK 6.0 at runtime (Debian/Ubuntu: `libgtk-4-1
libwebkitgtk-6.0-4`, Fedora: `gtk4 webkitgtk6.0`, Arch: `gtk4 webkitgtk-6.0`). The Windows binary needs
the WebView2 runtime (part of Windows 10/11).

## Known limits

- No Web Push in the webview; alarms would come through the shell later (Discord and webhooks work).
- Drawing together needs a WebSocket and is not available (one person anyway).
- The tray needs a StatusNotifier host (KDE, most desktops; GNOME only with the AppIndicator extension).
