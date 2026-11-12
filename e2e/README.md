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

## table.e2e.mjs

Tables in notes (desktop in Chromium and Firefox, the phone in Chromium): `/table` makes a 2 × 2 table with the bullet's text in the first cell (header bold), Tab and Shift+Tab move between cells, Enter adds a row below, the + adds a column, the ⋯ menu sets the line mode with the cursor staying in its cell, Backspace deletes an empty row, the arrow keys leave the table and come back into its last cell; the server holds the Markdown table and the line mode, and both are there after reloading. On a phone: the + is visible and 44 px, cells are 44 px high and take the cursor when tapped, a wide table scrolls sideways while the page does not. Copying tables (top level and nested) is part of `copy.e2e.mjs`.

## lock.e2e.mjs

Locks, presence, undo and conflict copies with two browsers: lock and read-only state on a bullet someone else is editing, a notice instead of a half-done action, `Ctrl+Z`/`Ctrl+Shift+Z`, typing right after Enter, marking of conflict copies, and "accept" (refused under someone else's lock, successful for the lock holder).

## offline.e2e.mjs

Offline work in notes:

- a note opens offline from the copy stored in the browser and stays editable; a note never opened on the device says so
- changes in a note left while offline are sent once the connection is back, without opening it again
- conflict: one person edits a bullet offline while another changes it live; both versions are kept, the offline text becomes the conflict copy, both browsers show it marked
- the notice at the bottom counts notes with unsent text and explains where it is kept; signing out asks first and then deletes the stored notes
- unsent changes survive closing the browser (persistent profile) and are sent at the next start with a connection

## copy.e2e.mjs

Selection over several bullets in Chromium and Firefox, in two notes (callout at the top; callout at the bottom with an empty indented last bullet). Checked, each time against the Markdown of the whole note:

- dragging from the bottom up past the first bullet, started at the end of the text, in the empty part of the row, on the action bubble, at the far right and in the empty space below the last bullet; dragging from the top down past the last bullet
- Ctrl+A twice (the callout row is marked too) and a new drag right after it
- the browser's own selection over several bullets is copied as Markdown too
- a click outside the note ends the selection
- Backspace deletes the whole selection

Run it after every change to selecting, copying or deleting in notes.

## live.e2e.mjs

Tasks and shopping lists behind simulated proxies (nothing blocked; WebSocket refused and SSE held without an answer; WebSocket refused and SSE refused): another device adds a task, moves it to another column and adds a list item. Each change has to show up in the open browser within 8 s, without reloading or switching tabs.

## channels.e2e.mjs

The owner types with a normal connection, the editor sits behind a simulated proxy. For each situation the chosen transport and the time until the change shows are measured: nothing blocked (WebSocket), WebSocket refused (SSE), WebSocket accepted but silent (SSE after missed heartbeats), WebSocket and SSE blocked as well as a hanging SSE (long polling), only plain requests (polling every 3 s).

`collab.e2e.mjs`, `lock.e2e.mjs` and `channels.e2e.mjs` take about a minute each. The tests do not run in CI because they need browser images.

## Screenshots

`e2e/screenshots.sh` builds the image, starts it in demo mode (English) with a fresh database and recreates the pictures in `screenshots/` (`screenshots.mjs`). They are then scaled down (desktop 1280 px, phone 480 px wide) and saved as WebP at quality 90 (`cwebp` in an Alpine container). For the version in the header: `APP_VERSION=v0.2 e2e/screenshots.sh`. In the workspace picture the demo user `user` edits a bullet at the same time, so lock and presence show.

`e2e/refshots.sh` takes reference screenshots of the German interface from two images and compares them (used to check refactorings that must not change the look).

## Demo tour for a screen recording

`e2e/video-tour.sh` clicks through the demo in a visible Chrome app window (triage, tasks, shopping list, zoom into a note, a linked subtask, the to-do overview) with a drawn pointer and typing at human speed, for a YouTube video. Against the public demo `https://demo.mindsift.app` by default; `LOCAL=1` starts a fresh local demo instead. It speaks the demo's language (the local one is English unless `TOUR_LANG=de`); what it types explains what it is doing at that moment; `PACE=1.5` slows it down, `SIZE=1920,1080` sets the window, `START_DELAY` gives time to start the recorder.

## tour-offer.e2e.mjs

The offer of the guided tour after the first sign-in (`TourOfferCard`). `run.sh` starts a second server for it without the demo, with a fresh database and the first admin from `ADMIN_USER` / `ADMIN_PASSWORD` (port `E2E_PLAIN_PORT`, else `E2E_PORT` + 1):

- the first admin is not asked during the rest of the setup, but right after it; "Nein danke" closes the card, starts no tour and is kept on the account: not asked again after reloading, nor on another device
- a member the admin created is asked on a phone: the card stands above the navigation with 44 px buttons; "Starten" starts the tour and counts as the answer
- in the demo every browser is asked once (closing with × counts), a second browser is asked again, and the shared account keeps nothing

All other scripts against the demo set `mindsift:tour-offered` in the browser, so the card stays out of their clicks and pictures.

## mfa.e2e.mjs

Two-factor sign-in, on the server without the demo (the demo cannot set it up), in Chromium and Firefox. The first admin creates a member per browser, who:

- sets the authenticator app up under Kontoeinstellungen → Sicherheit: password, key and QR code shown, the first code (computed in the test from the shown key, RFC 6238) switches it on, ten recovery codes are shown once
- signs out and in again: the password asks for the code (field for one-time codes), a wrong code is refused, the app's code signs in
- signs in with a recovery code (typed in capitals; 9 are left afterwards), and the same recovery code is refused the second time
- signs in with "Diesem Gerät 30 Tage vertrauen" and then again without being asked for a code
- on a phone (Chromium), another device is still asked; field, buttons and the trust row are at least 44 px high

`SHOT_DIR=<folder>` saves pictures of the QR step, the recovery codes, the settings with the app on and the second step on desktop and phone.

## tour.e2e.mjs

The guided tour (`frontend/src/features/tour`), started with "Tour starten" on the help page. Desktop in Chromium and Firefox, the phone in Chromium:

- every step is clicked through in order ("1 von 7" … "7 von 7"); the card stays inside the window, takes the focus and lights a control; on the phone its buttons are 44 px and the focus-mode step is skipped (the phone shows the list of notes, no open note)
- at the end the help page is back, with the focus on "Tour starten"
- keys: → on, ← back, Enter on, Tab stays in the card, Esc ends; the × ends too
- a click on the dimmed page and the triage's own keys (H, L, D, T, C) do nothing
- no data changes: notes, tasks, the inbox and lists are the same before and after
