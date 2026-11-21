# MindSift desktop (feasibility spike)

A Wails v3 shell around MindSift for Linux and Windows. This is phase 0 of the desktop app: it proves
the approach, it is not a release.

- **Local mode:** the MindSift server runs inside the app. Its router is the Wails asset handler, so no
  port is opened and nothing but the app's own window can reach it (`wails://localhost/` on Linux,
  `http://wails.localhost/` on Windows are served by the webview itself). Data lives in
  `$XDG_DATA_HOME/MindSift` (`~/.local/share/MindSift`) or `%APPDATA%\MindSift`; `MINDSIFT_DESKTOP_DIR`
  overrides it.
- **Remote mode:** the window loads a MindSift server's web app, offline behaviour as in the browser.
- The start page (`/__desktop/start`) chooses the mode; the tray menu switches it and opens a check page
  (`/__desktop/check`) that tests the web features MindSift relies on inside the window's engine.
  `MINDSIFT_DESKTOP_START=/__desktop/check` opens that page first.

It is a module of its own (`desktop/go.mod`, replacing the main module with `../`), so Wails stays out of
the server's dependencies.

## Build

```bash
desktop/build.sh            # frontend, Linux and Windows binary into desktop/out/
desktop/build.sh linux      # only Linux (cgo, GTK4 + WebKitGTK 6.0, built in golang:…-trixie)
SKIP_FRONTEND=1 desktop/build.sh windows   # reuse frontend/dist
```

The Linux binary needs GTK 4 and WebKitGTK 6.0 at runtime (Debian/Ubuntu: `libgtk-4-1
libwebkitgtk-6.0-4`, Fedora: `gtk4 webkitgtk6.0`, Arch: `gtk4 webkitgtk-6.0`). The Windows binary needs
the WebView2 runtime (part of Windows 10/11).

## Known limits of the spike

- WebSockets do not exist in local mode (no port); MindSift falls back to SSE (streamed on Linux) or long
  polling (Windows: Wails buffers responses, so SSE arrives only at the end).
- No passkeys and no Web Push in the webview; alarms would come through the shell later.
- The tray needs a StatusNotifier host (KDE, most desktops; GNOME only with the AppIndicator extension).
- Sign-in is the normal one; the setup wizard asks for no setup code. Auto sign-in is phase 1.
