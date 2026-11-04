# End-to-end tests

Browser tests with Playwright against a real MindSift server.

```bash
e2e/run.sh            # builds the image, starts it in demo mode and runs the tests
ENGINE=docker e2e/run.sh
```

Against a server that is already running (demo mode with `admin/admin` and `user/user` needed):

```bash
cd e2e && npm install && MINDSIFT_URL=http://localhost:8080 node collab.e2e.mjs
```

The tests use the German interface and the German sample data, so `run.sh` starts the server with `DEFAULT_LANGUAGE=de` (the demo is English otherwise).

## collab.e2e.mjs

Two browsers (owner and editor) work in the same note. Checked:

- typing is saved and shows up for the other one without reloading
- new bullets with Enter, in both directions
- offline phase: text stays local and is sent once back online
- both browsers and the server show the same state, after reloading too
- locks of a closed browser expire after 20 s at most
- indenting (Tab) and merging (Backspace) survive a reload

## share.e2e.mjs

The owner shares a note through the share dialog with the role "edit"; checked is that the share is stored as `write`, shown as editor in the dialog, and that the recipient can edit the note. At the end the owner ticks off a to-do in the to-do overview.

## lock.e2e.mjs

Locks, presence, undo and conflict copies with two browsers: lock and read-only state on a bullet someone else is editing, a notice instead of a half-done action, `Ctrl+Z`/`Ctrl+Shift+Z`, typing right after Enter, marking of conflict copies, and "accept" (refused under someone else's lock, successful for the lock holder).

## copy.e2e.mjs

Selection over several bullets in Chromium and Firefox, with a callout in between: dragging from the first to the last bullet, Ctrl+A twice (the callout row is marked too) and a new drag right after it; each time Ctrl+C has to give the same Markdown as a whole-note copy.

## channels.e2e.mjs

The owner types with a normal connection, the editor sits behind a simulated proxy. For each situation the chosen transport and the time until the change shows are measured: nothing blocked (WebSocket), WebSocket refused (SSE), WebSocket accepted but silent (SSE after missed heartbeats), WebSocket and SSE blocked as well as a hanging SSE (long polling), only plain requests (polling every 3 s).

`collab.e2e.mjs`, `lock.e2e.mjs` and `channels.e2e.mjs` take about a minute each. The tests do not run in CI because they need browser images.

## Screenshots

`e2e/screenshots.sh` builds the image, starts it in demo mode (English) with a fresh database and recreates the pictures in `screenshots/` (`screenshots.mjs`). They are then scaled down (desktop 1280 px, phone 480 px wide) and saved as WebP at quality 90 (`cwebp` in an Alpine container). For the version in the header: `APP_VERSION=v0.2 e2e/screenshots.sh`. In the workspace picture the demo user `user` edits a bullet at the same time, so lock and presence show.

`e2e/refshots.sh` takes reference screenshots of the German interface from two images and compares them (used to check refactorings that must not change the look).
