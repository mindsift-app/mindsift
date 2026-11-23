# MindSift desktop

A Wails v3 shell around MindSift for Linux and Windows (no macOS): local instances without a server, or a
window onto a MindSift server. Release builds (Flatpak, Linux binary, Windows exe and installer) are
attached to every GitHub release with fixed names, see "Release" in ci/release-desktop.sh.

- **Start view** (`/__desktop/start`): a view of the frontend (`features/desktop/DesktopStartView.tsx`),
  in the look of the sign-in page and the system's language. It lists the entries used lately (local
  instances and servers mixed, newest first), the instance folders found in the base folder that are not
  listed (also ones copied there by hand), "Neue lokale Instanz…" (a name) and "Mit Server verbinden…"
  (name and address, checked with `GET /api/v1/health`: 15 s in all, a failed connection is tried once
  more after a second; a server that answers wrongly is reported at once). Entries can be renamed and removed from the list;
  removing never deletes data. On the first start (nothing listed or found) it offers "Lokale Instanz anlegen" and
  "Mit Server verbinden" side by side and creates nothing before the person chose. The entry opened last opens
  directly at the next start. The tray menu has
  "MindSift öffnen", "Instanz wechseln…" (the start view, also Ctrl+Shift+O for desktops without a
  tray) and "Beenden", in the system’s language (`internal/shell/texts.go`). In a local instance the
  profile menu has "Instanz wechseln" where sign-out would be; it loads the start view too.
- **Base folder:** `$XDG_DATA_HOME/MindSift` (`~/.local/share/MindSift`; under Flatpak `XDG_DATA_HOME`
  already points into the sandbox) or `%APPDATA%\MindSift`; `MINDSIFT_DESKTOP_DIR` overrides it. It holds
  `desktop.json` and every local instance in `instances/<Name>/`; the single data folder of phase 1,
  `data/`, stays where it is and becomes the instance "MindSift". The start view names the folder and opens
  it in the file manager. The only folder dialog is the backup folder's (`pick-folder`, the system's dialog
  through Wails, under Flatpak through the portal); the shell hands the choice to the window, the server
  checks it. Under Flatpak the portal answers with a path of its document store (`/run/user/1000/doc/<id>/…`),
  where the app may write; that path is stored and used, the window shows the host's path instead
  (`shell.HostPath`: `org.freedesktop.portal.Documents.GetHostPaths`, portal version 5 and later, else the
  path as it is).
- **Downloads** (backups, exports, a note as Markdown, a theme; the frontend saves blobs through a link with
  `download`): WebKitGTK asks nobody and writes into the Downloads folder, which the Flatpak may not reach, so
  the shell takes every download of the window's network session, on any page (`download_linux.go`:
  `download-started`, `decide-destination` kept waiting until the system's save dialog answered, the portal's
  under Flatpak). WebKit writes into `<base>/webview/downloads/` and the finished file is moved to the chosen
  path (renamed, else copied; into a file of the document portal a rename fails with `EXDEV`, writing it
  works, so nothing depends on WebKit's `<name>.wkdownload` next to the destination). A cancelled dialog cancels the download; the page gets
  `mindsift:desktop-download` (`{saved, name}`) and the frontend shows a notice (`components/DownloadNotice.tsx`).
  Windows: WebView2's own download bar, untouched.
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
opens the system's folder dialog at `path` (or its nearest existing parent; under Flatpak the host's path,
unchecked) and answers `{path, shown}` (`shown`: the folder as the person knows it), empty when
cancelled; the setup wizard and the administration use it for the backup folder. The endpoints answer
only requests with the header `X-MindSift-Desktop: 1`, `Content-Type: application/json`, no foreign
`Origin` and no cross-site `Sec-Fetch-Site`. A server's page shown in the window (or any other origin) cannot send that header
without a CORS preflight, which the shell never allows, so its requests never arrive. `Origin` and
`Sec-Fetch-Site` may also be missing and still pass: WebKitGTK sends neither to `wails://`, for the start
view's and the app's own `fetch` POSTs as for a foreign page's (checked under Xvfb), so the custom header
and the JSON content type (both need a preflight) are the check there; WebView2 sends `Origin` as browsers do. Errors come back as
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

- **`/wails/` closed** (`shell.GuardWailsRoutes`, the outermost asset middleware): only
  `runtime.js`/`transport.js` are answered (GET/HEAD); every other route is 403 for every page, the
  window's own included. Checked under Xvfb: WebKitGTK sends a no-cors request to `wails://` without
  `Origin` and `Sec-Fetch-Site`, so no header tells the window's own pages from others, and the app needs
  none of these routes: the frontend uses no Wails runtime or bindings; key bindings and the tray are
  native, the window's scripts run by evaluation, dropped files come through `filedrop_linux.go`, the
  folder dialog and the start view through the shell's `/__desktop/api`, and the runtime's own messages
  (ready, drag) go through the engine's message channel, not these routes.
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
- **Window title** (`shell.TitleFor`): worked out from the address of the page shown, the window's own or
  a server's, on every load and history step: "MindSift" on the start view, "<name> – MindSift" in a local
  instance or on a server's pages (the entry whose address the page lies under). It names the instance or
  server, not the page, so a server's own route changes (no load) need nothing. Linux: the
  `WindowLoadFinished` hook above reads the address from WebKit. Windows: every page posts
  `mindsift:page` through `chrome.webview.postMessage` after its load (the hook's script), and the
  `RawMessageHandler` takes the address from WebView2 (`ICoreWebView2.Source`, Wails' `TopOrigin`), not
  from the page; a page posting the message itself only has the title worked out again. Before, only the
  window's own pages told their address on Windows, so on a server's pages the title stayed as the page
  before.
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

## System notifications

A local instance's alarms (task alarms and reminders, the daily summary, the other notification events
the settings route there) can come as notifications of the operating system, while the app is open
(closing the window quits the app; alarms missed meanwhile come at the next start, as on a server that was
down). The instance's server runs in this process, so it needs no push service:

- **Server:** the alarm channel `desktop` (`ChannelChoice.Desktop`, a column "System" under Settings →
  Alarme, plus a test button) hands each alarm to an `api.DesktopNotifier`, which the shell sets right after
  `api.NewServer` (`Local.Notify`, `internal/api/desktop_notify.go`). The capability `desktopNotify` is on
  only with a notifier, i.e. only in the app's local instances; web push (`push`) stays off there. A new
  instance (or one whose alarm settings were never saved) gets task alarms through this channel by default,
  and the daily summary too once it is switched on; saved settings are left alone.
- **Shell** (`internal/shell/notify.go`): each notification carries the instance's id and the task's. A
  click brings the window up and, if that instance is still the open one, makes the app open the task (the
  event `mindsift:open-link` with `?task=…`, as a link from the MCP server; `App.tsx`). A click on an alarm
  of another instance only brings the window up.
- **Linux** (`internal/shell/notify_linux.go`, D-Bus with godbus, no cgo): under Flatpak the notification
  portal `org.freedesktop.portal.Notification` (any Flatpak app may use it, the manifest needs no
  `--talk-name`), otherwise the desktop's notification server `org.freedesktop.Notifications` (GNOME, KDE,
  dunst, mako …) with the app's icon and desktop entry (`app.mindsift.MindSift`) and a default action. A
  server without actions reports a click only as "closed by the user", which counts as a click. Not Wails'
  notification service: it talks to `org.freedesktop.Notifications` only, gives neither icon nor desktop
  entry, and stops the whole app when the session bus is missing at its start. No bus or no notification
  server: the alarm counts as failed and is tried again in the next runs (up to 3), the others go out.
- **Windows** (`notify_windows.go`): Wails' notification service (go-toast), started with the app's services
  but so that a failure leaves the app running without toasts. It registers the AppUserModelID `MindSift`
  per user (`HKCU\Software\Classes\AppUserModelId\MindSift`, display name and the exe's icon, saved as a PNG
  in the temp folder) and a COM activator (`HKCU\Software\Classes\CLSID\{…}\LocalServer32` = the running
  exe), so the portable exe and the installed one need no Start menu shortcut with an AUMID. A toast clicked
  after the app quit starts it again (it opens the instance used last, not the task). Not tried on a real
  Windows machine yet.
- **Servers in the window** get no system notifications (their alarms are the server's own business; the
  window has no web push).

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
  the address and the mail and push channels of alarms (system notifications take push's place, see above).
- **Kept:** MCP with API keys (local AI agents, over the listener above), daily backups (on unless switched off in the wizard; into
  `backups/` of the instance or, with a folder chosen in the wizard or the administration, its subfolder
  `MindSift-Backups/<instance>`), export and import. Moving to a server later is a backup restored there; the other way, Administration → Data takes one account
  over from a server's backup: a full backup as downloaded from its administration (.tar), its data or backups folder packed as .zip/.tar/.tar.gz (with the account's pictures and recordings) or a database snapshot alone (see Desktop Mode in Doku/architecture.md). Hidden values in notes come along when the backup carries the server's `secrets.key` (complete backups do): opened with it and sealed again with the instance's own key, which stays as it is; without that key they stay behind and their notes are listed. The local backups are full backups (database and media, unchanged media as hard links); Administration → Data restores one, and the app reopens the instance with it.
- **Realtime without WebSocket:** server-sent events on Linux, long polling on Windows (Wails buffers
  responses there). The server names the transport in `/auth/status` (`desktop.realtime`).
- **Time zone and language** come from the system unless `TZ` or `DEFAULT_LANGUAGE` are set: on Linux
  `/etc/localtime` and `LANGUAGE`/`LC_ALL`/`LC_MESSAGES`/`LANG`, on Windows the display language (the
  time zone stays UTC there until set in the administration).

It is a module of its own (`desktop/go.mod`, replacing the main module with `../`), so Wails stays out of
the server's dependencies. `desktop/internal/shell` needs no window and is tested without GTK:
`go test ./internal/...` in `desktop/`. `ci/desktop-go-checks.sh` (part of `ci/local-checks.sh` and the
pull request checks) runs gofmt, `go vet` and `go test` over the whole module without cgo, with Wails'
`purego` build tag in place of cgo; only the three cgo files (GTK and WebKit calls) are left to the builds.

## Build

```bash
desktop/build.sh            # frontend, Linux and Windows binary, licenses into desktop/out/
desktop/build.sh linux      # only Linux (cgo, GTK4 + WebKitGTK 6.0, built in golang:…-trixie)
SKIP_FRONTEND=1 desktop/build.sh windows   # reuse frontend/dist
APP_VERSION=v1.2.0 desktop/build.sh        # the app's version; default v<package.json version>-dev
```

- **Version:** `APP_VERSION` is linked in as `main.version` (the embedded server's `AppVersion`, so a
  release looks for newer releases like the server does) and, without the `v`, into the exe's version
  resource; the frontend is built with it too.
- **Licenses:** `desktop/out/THIRD_PARTY_LICENSES.txt` covers both binaries: the frontend's npm packages
  (`ci/third-party-licenses-npm.mjs`, run where the frontend is built), the Go modules imported on Linux
  or Windows (Wails and its dependencies, those of the server packages; `ci/third-party-licenses.sh` with
  `GO_PLATFORMS`) and Go's standard library. The app shows the file next to its binary in *About
  MindSift*.

**Releases:** `ci/release-desktop.sh <tag> <dir>` runs `build.sh` and the Flatpak build with the tag as
`APP_VERSION` and writes the files of the release page under fixed names (the website links to
`releases/latest/download/<name>`): `mindsift-desktop-linux-amd64.tar.gz` (binary `mindsift-desktop`,
`LICENSE`, `THIRD_PARTY_LICENSES.txt`, `README.txt` from `packaging/linux/`),
`mindsift-desktop-linux-amd64.flatpak`, `mindsift-desktop-windows-amd64.exe` (portable),
`mindsift-desktop-windows-amd64-setup.exe` (installer, see "Windows") and
`mindsift-desktop-THIRD_PARTY_LICENSES.txt`. `.github/workflows/release.yaml` runs it from the tag's
checkout and lists the files in the release's `SHA256SUMS` together with the server archives; it passes
`FLATPAK_GPG_PRIVATE_KEY`, so the Flatpak bundle of a release carries the own Flatpak repository as its
origin (the script checks the bundle's ref and origin), and the bundle then goes into that repository
(see "Own Flatpak repository").
`.gitea/workflows/desktop.yaml` runs the same script for pushes to `main` and by hand
(any branch), with the version `v<package.json>-dev`; the files are one artifact of the run in the Gitea
UI.

## Flatpak

```bash
desktop/packaging/flatpak/build.sh     # -> desktop/out/mindsift-desktop-linux-amd64.flatpak
flatpak install --user desktop/out/mindsift-desktop-linux-amd64.flatpak && flatpak run app.mindsift.MindSift
APP_VERSION=v1.2.0 desktop/packaging/flatpak/build.sh   # the tag v1.2.0, as the release builds it
                                                        # (REQUIRE_TAG=1: fail without the tag)
desktop/packaging/flatpak/update-sources.sh             # after changing go.mod, go.sum or package-lock.json
```

- **Files** in `packaging/flatpak/`: the manifest `app.mindsift.MindSift.yml` (each permission explained
  there), the AppStream metainfo, the generated sources `go.mod.yml`, `modules.txt` and
  `node-sources.json` with `sources.sha256`, and the scripts `build.sh`, `bundle.sh` (makes the bundle,
  see below), `update-sources.sh`, `check-sources.sh` (with `test-check-sources.sh`), `sources-sha256.sh`
  and `set-release.sh`.
  The desktop file and the icons are those of `packaging/linux/`.
- **Runtime:** `org.gnome.Platform//51` (GTK 4, WebKitGTK 6.0). The binary is built inside
  `org.gnome.Sdk//51` with `org.freedesktop.Sdk.Extension.golang//26.08` and the frontend with
  `org.freedesktop.Sdk.Extension.node24//26.08`, so the binary links against the runtime's libraries; both
  extensions are pinned to a commit in `build.sh` (Go 1.27.3), the GNOME branch follows its security
  rebuilds. The bundle names Flathub as the runtime's source, so `flatpak install` fetches the runtime
  from there.
- **Build, as Flathub builds:** the manifest's source is a `git` source of
  `https://github.com/mindsift-app/mindsift.git` with `tag` (and `commit`), next to the generated sources
  `go.mod.yml` (one archive of `proxy.golang.org` per Go module, unpacked into `desktop/vendor/<path>`, plus
  `modules.txt`) and `node-sources.json` (every npm package of `frontend/package-lock.json` as a file of
  the npm cache). Everything else happens inside the SDK without network: `npm ci --offline`, the frontend
  build with `APP_VERSION` into `desktop/dist`, MindSift's own module copied into `desktop/vendor` (the
  packages `modules.txt` lists for it; `desktop/go.mod` replaces it with `../`), `go build -mod=vendor`
  (`GOPROXY=off`, `GOTOOLCHAIN=local`), `THIRD_PARTY_LICENSES.txt` (see below), then the desktop file,
  icons, metainfo and `LICENSE`. The version is `v` plus `frontend/package.json`'s, which a release sets
  to its tag, unless `desktop/app-version` names another.
- **`build.sh`** runs `flatpak-builder` with that manifest (`--default-branch=stable`) in a Debian
  container with the capabilities bubblewrap needs; the runtimes stay in the volume `mindsift-flatpak`,
  the downloaded sources (git mirror, module archives, npm packages) in `mindsift-flatpak-sources`. Only
  the source depends on what is built:
  - **A tag** (`APP_VERSION` names a tag of the checkout, as `ci/release-desktop.sh` in the release
    workflow): the manifest's tag must be that version; `build.sh` pins the commit the tag points to and
    `flatpak-builder` clones it from GitHub, so the bundle is made of the tag's files. It fails when the
    built metainfo has no `<release>` entry for the version or the bundle's appstream data lacks one of
    its screenshots (`CHECK_SCREENSHOTS=0` skips that, for tags from before the PNG screenshots).
  - **Anything else** (local builds, the Gitea builds of `main`, `…-dev` versions): the git source is
    swapped for a `dir` source of the working tree (the files git knows or would add, uncommitted changes
    included, ignored ones left out, staged in `desktop/out/flatpak/src`), with the version in
    `desktop/app-version` (default `v<package.json>-dev`).
- **Generated sources:** `update-sources.sh` makes `go.mod.yml` and `modules.txt` (flatpak-go-mod v0.1.0
  in the Go image, on a copy of the Go sources) and `node-sources.json` (flatpak-node-generator, pinned to a
  commit of flatpak-builder-tools, in a Python image, its PyPI packages as of a fixed date: 14-day rule) and
  writes `sources.sha256` with the checksums of `desktop/go.mod`, `desktop/go.sum` and
  `frontend/package-lock.json` (`sources-sha256.sh`; the lockfile without MindSift's own version, so a
  release that only raises the version needs no new sources). Run it after every other change of those
  files and commit the result.
  `check-sources.sh` (in `ci/local-checks.sh` and at the start of `ci/release-desktop.sh`) fails with the
  name of the script when the checksums differ, and when the manifest's tag is not `v<package.json>` or
  the metainfo has no entry for that version. A package that the desktop app newly imports from
  MindSift's own module changes `modules.txt` without changing `go.mod`: run the script then, too.
- **Release:** a build from the git source takes manifest and metainfo as they are in the tag, so the
  release commit already names the release: `set-release.sh vX.Y.Z '<one sentence>'` (run by
  `ci/release-prepare.sh vX.Y.Z '<one sentence>'`, which writes the release commit's changes) moves
  the manifest's tag and drops its commit (unknown before tagging; `build.sh` pins it), adds the
  `<release>` entry (the sentence as its description, the date of the CHANGELOG section, `development`
  for pre-releases) and points the
  screenshot URLs at the tag. Tags up to v0.99.0 carry neither the generated sources nor the manifest;
  v0.99.0 builds with this manifest (its dependencies are those of the generated sources) and
  `CHECK_SCREENSHOTS=0`, as its metainfo still names WebP screenshots.
- **Branch and origin of the bundle:** the ref is `app/app.mindsift.MindSift/x86_64/stable`, the same as
  in the own Flatpak repository (the branch is set on the command line, not in the manifest, which stays
  as Flathub expects it). With `FLATPAK_GPG_PRIVATE_KEY` set (the repository's ASCII-armored signing key,
  as in the release workflow), `bundle.sh` signs the commit with it and builds the bundle with
  `--repo-url=https://flatpak.mindsift.app/repo/` and the public key (`--gpg-keys`), so an install of the
  bundle gets updates from the repository (see "Own Flatpak repository"). Without the variable (local
  builds, the Gitea builds) the bundle has no origin and installs as before, without updates. The key
  reaches only the container that makes the bundle, as a variable passed by name; the script writes it to
  a file only root can read and drops the variable before the build steps run.
- **Screenshots** for GNOME Software, Discover and Flathub: the metainfo lists four PNGs (notes, board,
  calendar, journal; 1600x900, English demo) in `screenshots/store/`, as
  `https://raw.githubusercontent.com/mindsift-app/mindsift/main/screenshots/store/<name>.png`.
  `e2e/screenshots.sh` makes them together with the README screenshots (`store-*.png` of
  `e2e/screenshots.mjs`, scaled and compressed with pngquant); refresh them with that one command and
  commit `screenshots/`. They must be PNG or JPEG: `flatpak-builder` runs `appstreamcli compose`, which
  downloads every screenshot and silently drops the ones it cannot read (gdk-pixbuf in the build has no
  WebP loader); the composed `share/app-info` of the bundle is what `flatpak build-update-repo` puts into
  the appstream branch of the own repository. Up to v0.99.0 the metainfo pointed at the README's WebP
  files, so the software centers showed none. `set-release.sh` points the URLs at the release's tag
  (`…/mindsift/v1.2.0/screenshots/store/…`), which never changes, in the release commit itself, so the
  tag's metainfo names its own images; a tag build fails when the bundle's appstream data lacks one of
  them. Between releases they stay on that tag (`check-sources.sh` allows `main` and the current version's
  tag). Flathub builds from the same metainfo and mirrors the images itself
  (`--mirror-screenshots-url`). Check the published data with
  `flatpak remote-ls --user --app mindsift` and
  `~/.local/share/flatpak/appstream/mindsift/x86_64/active/appstream.xml`.
- **Data:** under Flatpak `XDG_DATA_HOME` is `~/.var/app/app.mindsift.MindSift/data`, so the base folder
  is `~/.var/app/app.mindsift.MindSift/data/MindSift`; the app needs no access to the home folder. It
  writes no desktop entry of its own (`FLATPAK_ID`); Flatpak exports the packaged one.
- **Flathub** builds the same way; its manifest lives in Flathub's repository and is not written here
  (Flathub's rules on generated submissions). The repository's manifest, its generated sources and
  `build.sh` are what the release download and the own Flatpak repository are built with, so a build
  problem shows up before the tag.
- **License file in the offline build:** the app reads `THIRD_PARTY_LICENSES.txt` next to its binary
  (*About MindSift*), so the manifest makes it in the build, after `npm ci` and `desktop/vendor/`:
  `node ci/third-party-licenses-npm.mjs frontend` for the npm part, then `ci/third-party-licenses.sh` in
  `desktop/` (`SUBJECT='The desktop app'`, `GO_PLATFORMS=linux/<arch of the build>`, `GOFLAGS=-mod=vendor`
  and `GOPROXY=off` from the build options), installed to `/app/bin/` and
  `/app/share/licenses/app.mindsift.MindSift/`.

  - The npm script only reads `frontend/package-lock.json` and the installed `frontend/node_modules`; it
    needs nothing else (no network, no packages of its own).
  - `ci/third-party-licenses.sh` needs `bash` and `go` on the `PATH` (the Go SDK extension's
    `/usr/lib/sdk/golang/bin`). With `-mod=vendor` `go list` reports no module directory, so the script
    reads each module's license files from `desktop/vendor/<module path>/` instead of the module cache. The
    vendor folder must therefore hold the whole module including its `LICENSE`/`COPYING`/`NOTICE`/`PATENTS`/
    `AUTHORS` files, as the module archives of flatpak-go-mod do (plain `go mod vendor` works for the current
    modules, too); the script fails and names the module when one has none. MindSift's own
    module (`vendor/github.com/mindsift-app/mindsift/`) is never listed. Go's own license comes from
    `$(go env GOROOT)/LICENSE`, so the SDK extension's Go tree has to ship that file.
  - `GO_PLATFORMS` names what the build compiles (`linux/amd64`, add `linux/arm64` when both are built);
    the release page's file lists Linux and Windows. With a module cache and no vendor mode, the script
    works as before (`desktop/build.sh licenses`).
  - Installed locations: `/app/bin/THIRD_PARTY_LICENSES.txt` (what the app opens) and
    `/app/share/licenses/app.mindsift.MindSift/THIRD_PARTY_LICENSES.txt`.
  - Checked in `golang:1.27.4-trixie` with the module cache deleted and `GOPROXY=off`, vendor filled with
    each module's complete directory (what the proxy zips contain): the Go part is byte-identical to the
    module-cache run (same modules, same texts).

## Own Flatpak repository

Besides the bundle on the release page, every release goes into MindSift's own signed Flatpak repository
(an OSTree repository, independent of Flathub), so installed apps get updates through GNOME Software, KDE
Discover or `flatpak update`. It is served by GitHub Pages from the `gh-pages` branch of
`mindsift-app/flatpak` as `https://flatpak.mindsift.app/`.

**Install** (the GNOME runtime comes from Flathub, which the `.flatpakref` adds when it is missing):

```bash
flatpak install --user https://flatpak.mindsift.app/app.mindsift.MindSift.flatpakref
# or: add the repository, then install from it
flatpak remote-add --user --if-not-exists mindsift https://flatpak.mindsift.app/mindsift.flatpakrepo
flatpak install --user mindsift app.mindsift.MindSift
```

**How it is filled:** `.github/workflows/release.yaml` calls `.github/workflows/flatpak-repo.yaml` after
the release page has all its files, for releases without `-` whose desktop build succeeded. That workflow
downloads `mindsift-desktop-linux-amd64.flatpak` and `SHA256SUMS` of the tag (`gh release download`) and
runs `ci/flatpak-repo.sh`, which

- checks the bundle against `SHA256SUMS`, that its metainfo carries the tag's release and that the tag is
  not older than the release the repository holds (pre-releases are refused);
- clones `gh-pages` over SSH with the deploy key (or starts the branch when there is none), imports the
  bundle and commits it with `flatpak build-commit-from` onto `app/app.mindsift.MindSift/x86_64/stable`,
  whatever branch the bundle was built with (the bundles up to v0.98.0 are on `master`, later ones on
  `stable`); the previous release
  becomes the parent, the same bundle twice makes no new commit and no push;
- runs `flatpak build-update-repo --generate-static-deltas --prune --prune-depth=5 --default-branch=stable`
  (summary, appstream branches for the software centers, deltas from the previous release; the last five
  old releases stay installable with `flatpak update --commit=…`), signing commits and summary with the GPG
  key;
- writes the site: `repo/` (the OSTree repository), `mindsift.flatpakrepo` and
  `app.mindsift.MindSift.flatpakref` (both carry the public key as `GPGKey`), the key as `mindsift.gpg`,
  `icon.png`, an `index.html` with these instructions, `.nojekyll`, and `CNAME` (kept; a new branch gets
  `flatpak.mindsift.app`);
- commits it as `MindSift <noreply@mindsift.app>` as a **single commit without history** and force-pushes
  it: the OSTree repository keeps its own history, git history would keep every pruned release forever
  and grow past what Pages serves (1 GB). A release adds about 10-25 MB.

**Updates for installs of the release bundle:** the release workflow builds the
`mindsift-desktop-linux-amd64.flatpak` of a release (no `-`) with the repository as its origin (see
"Flatpak", `bundle.sh`), when both secrets below are set. `flatpak install --user
mindsift-desktop-linux-amd64.flatpak` then adds a remote `mindsift-origin` for
`https://flatpak.mindsift.app/repo/` that trusts the repository's key (not listed in searches, priority
0; an existing `mindsift` remote of the same repository stays as it is), and `flatpak update`, GNOME
Software or Discover take every later release from there. The first update after installing replaces the
bundle's commit with the repository's commit of the same release (`ci/flatpak-repo.sh` commits it anew
on top of the previous release), a download of a few kilobytes. Pre-releases get no origin: their commit
would be newer than the repository's, and `flatpak update` would fail with "Update is older than
current version" until the next release. For the same reason the workflow only adds the origin when the
deploy key is set as well, so the repository really gets each release. Bundles up to v0.98.0 are on
`master` and have no origin: a newer bundle or an install from the repository (see "Install") lands next
to them on `stable` and becomes the one that runs; `flatpak uninstall --user app.mindsift.MindSift//master`
removes the old one (the data in `~/.var/app/app.mindsift.MindSift` stays).

Two runs never push at once (concurrency group `flatpak-repo`). A release that is missing (e.g. the
secrets came later) is added with "Run workflow" on *Flatpak Repository*, from `main`, with its tag;
the stable branch only moves forward (the script refuses a release older than the one it holds), so add
missing releases oldest first. Without the secrets the workflow
leaves a notice and does not fail the release.

**Local run** (needs `flatpak`, `ostree`, `gpg`, `git`; e.g. in `debian:trixie` with those packages):
`FLATPAK_GPG_PRIVATE_KEY="$(cat key.asc)" SHA256SUMS=SHA256SUMS PUSH=0 WORKDIR=/tmp/fr ci/flatpak-repo.sh
v1.2.0 mindsift-desktop-linux-amd64.flatpak <git remote>` leaves the site in `/tmp/fr/site`; `SITE_URL`
changes the URLs in the descriptors (e.g. `http://127.0.0.1:8000` to try it with
`python3 -m http.server`), `KEEP` the number of old releases.

**Setting it up** (once, by a maintainer):

1. Create the public repository `mindsift-app/flatpak` (empty; the workflow creates `gh-pages`).
2. Deploy key with write access:
   `ssh-keygen -t ed25519 -N '' -C 'flatpak-repo deploy key' -f flatpak-deploy-key`. In
   `mindsift-app/flatpak` → Settings → Deploy keys → Add deploy key: the content of
   `flatpak-deploy-key.pub`, "Allow write access" checked. In `mindsift-app/mindsift` → Settings →
   Secrets and variables → Actions → New repository secret `FLATPAK_REPO_DEPLOY_KEY`: the content of
   `flatpak-deploy-key` (the private key). Delete both files afterwards.
3. Signing key without passphrase, in a keyring of its own:

   ```bash
   export GNUPGHOME="$(mktemp -d)"
   gpg --batch --passphrase '' --quick-gen-key 'MindSift Flatpak Repository <noreply@mindsift.app>' ed25519 sign never
   gpg --armor --export-secret-keys > flatpak-signing-key.asc
   ```

   Secret `FLATPAK_GPG_PRIVATE_KEY` in `mindsift-app/mindsift`: the content of `flatpak-signing-key.asc`.
   Keep a copy offline: everyone who added the repository trusts exactly this key, a new key means they
   all have to add the repository again. Then remove `$GNUPGHOME` and the file.
4. Run the workflow *Flatpak Repository* by hand once with the latest release tag (or wait for the next
   release); this creates `gh-pages` with `CNAME`.
5. In `mindsift-app/flatpak` → Settings → Pages: Source "Deploy from a branch", branch `gh-pages`,
   folder `/ (root)`; Custom domain `flatpak.mindsift.app`; "Enforce HTTPS" once the certificate is there.
6. DNS: `CNAME` record `flatpak.mindsift.app` → `mindsift-app.github.io`. Optionally verify the domain for
   the organization (GitHub → organization settings → Pages → Add a domain, a TXT record), so nobody else
   can claim it.

## Windows

```bash
desktop/build.sh windows && desktop/build.sh licenses   # the exe and the license file
desktop/packaging/windows/build.sh   # -> desktop/out/mindsift-desktop-windows-amd64-setup.exe
```

Two downloads with the same exe: `mindsift-desktop-windows-amd64.exe` runs where it lies (portable, no
Start menu entry), `mindsift-desktop-windows-amd64-setup.exe` installs it. Both keep the data in
`%APPDATA%\MindSift`, so switching between them keeps every instance.

- **Installer** (`packaging/windows/mindsift.nsi`, NSIS 3): per user without administrator rights into
  `%LOCALAPPDATA%\Programs\MindSift` (`MindSift.exe`, `LICENSE.txt`, `THIRD_PARTY_LICENSES.txt` for the
  about box, `uninstall.exe`), a Start menu entry, a desktop shortcut if ticked (off by default), and the
  uninstaller in "Apps & features" (`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\app.mindsift.MindSift`,
  with version, icon and size). Its pages and messages are in the app's five languages (Windows' display
  language, English otherwise); it needs 64-bit Windows 10 or 11. Silent: `/S` (and `/D=<folder>` as the
  last argument).
- **Updates:** a newer setup installs over the installed version, into its folder (from the uninstall
  key's `InstallLocation`, without asking for a folder) and keeping the desktop shortcut. A running app
  locks its exe, so the installer (and the uninstaller) asks to quit it, also from the tray, and retries;
  a silent run gives up with exit code 3 instead.
- **Uninstall** removes only the files it installed, the shortcuts, the key and what the app registered for
  its notifications (the AppUserModelID `MindSift`, its COM activator, `HKCU\Software\MindSift\NotificationCategories`); the folder only when
  nothing else is left in it. `%APPDATA%\MindSift` (instances, `desktop.json`, the webview's storage) is
  never deleted and there is no option for it; the confirmation page says so.
- **WebView2:** no bootstrapper, the runtime is part of Windows 10 and 11. Wails' own NSIS template
  (v3.1.0, `internal/commands/build_assets/windows/nsis`) runs Microsoft's bootstrapper when the
  EdgeUpdate key is missing and its uninstaller deletes `%APPDATA%\<exe>` (WebView2's default data
  folder); the installer here does neither, the rest follows its per-user mode (`WAILS_INSTALL_SCOPE user`).
- **Build:** `packaging/windows/build.sh` stages the exe, the license files and `app.ico` and runs
  `makensis -WX` (a warning fails the build) in `debian:trixie-…-slim` with Debian's `nsis` (3.11), the
  image of the Flatpak build; no Windows needed. The installer's version resource carries `APP_VERSION`.
  The installer is a 32-bit NSIS stub (as every NSIS installer) installing the 64-bit app.
- **Not signed** yet: SmartScreen warns on the first downloads ("More info", "Run anyway"). Signing would
  go into `!finalize` / `!uninstfinalize` in the `.nsi` and sign the exe before it is packed.

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

- No Web Push in the webview; alarms come as system notifications (see "System notifications"), only
  while the app is open, and only from local instances: a server's page in the window gets none (its
  alarms go out as that server sends them: mail, Discord, webhooks, and push to browsers).
- Drawing together needs a WebSocket and is not available (one person anyway).
- The tray needs a StatusNotifier host (KDE, most desktops; GNOME only with the AppIndicator extension).
