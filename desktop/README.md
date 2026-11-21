# MindSift desktop

A Wails v3 shell around MindSift for Linux and Windows (no macOS). Phase 0 proved the approach, phase 1
adds the server's desktop mode; it is not a release yet.

- **Local mode:** the MindSift server runs inside the app. Its router is the Wails asset handler, so no
  port is opened and nothing but the app's own window can reach it (`wails://localhost/` on Linux,
  `http://wails.localhost/` on Windows are served by the webview itself). Data lives in
  `$XDG_DATA_HOME/MindSift` (`~/.local/share/MindSift`; under Flatpak `XDG_DATA_HOME` already points into
  the sandbox) or `%APPDATA%\MindSift`; `MINDSIFT_DESKTOP_DIR` overrides it.
- **Remote mode:** the window loads a MindSift server's web app, offline behaviour as in the browser.
- The start page (`/__desktop/start`) chooses the mode; the tray menu switches it and opens a check page
  (`/__desktop/check`) that tests the web features MindSift relies on inside the window's engine.
  `MINDSIFT_DESKTOP_START=/__desktop/check` opens that page first.

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
- **Time zone and language** come from the system on Linux (`/etc/localtime`, `LANG`) unless `TZ` or
  `DEFAULT_LANGUAGE` are set; Windows stays on UTC and German until set in the administration.

It is a module of its own (`desktop/go.mod`, replacing the main module with `../`), so Wails stays out of
the server's dependencies.

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
