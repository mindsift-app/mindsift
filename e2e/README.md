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

Tables in notes (desktop in Chromium and Firefox, the phone in Chromium): `/table` makes a 2 × 2 table with the bullet's text in the first cell (header bold), Tab and Shift+Tab move between cells, Enter goes into the still empty first row and later adds a row below, the + adds a column, the ⋯ menu sets the line mode with the cursor staying in its cell, Backspace deletes an empty row, the arrow keys leave the table and come back into its last cell; the server holds the Markdown table and the line mode, and both are there after reloading. On a phone: the + is visible and 44 px, cells are 44 px high and take the cursor when tapped, a wide table scrolls sideways while the page does not. Copying tables (top level and nested) is part of `copy.e2e.mjs`.

## templates.e2e.mjs

Note templates (desktop, Chromium): the ⋯ menu marks a note as template and the folder tree shows the mark; `/vorlage` in an empty bullet of another note inserts the template's bullets with their types and levels, the to-do open, `{{datum}}` and `{{titel}}` filled in, the code block as written with its language and the hidden value as a copy of the target note; "Neue Notiz anlegen" with the template chosen starts the new note with its bullets and the title from the dialog.

## lock.e2e.mjs

Locks, presence, undo and conflict copies with two browsers: lock and read-only state on a bullet someone else is editing, a notice instead of a half-done action, `Ctrl+Z`/`Ctrl+Shift+Z`, typing right after Enter, marking of conflict copies, and "accept" (refused under someone else's lock, successful for the lock holder).

## offline.e2e.mjs

Offline work in notes:

- a note opens offline from the copy stored in the browser and stays editable; a note never opened on the device says so
- changes in a note left while offline are sent once the connection is back, without opening it again
- conflict: one person edits a bullet offline while another changes it live; both versions are kept, the offline text becomes the conflict copy, both browsers show it marked
- the notice at the bottom counts notes with unsent text and explains where it is kept; signing out asks first and then deletes the stored notes
- unsent changes survive closing the browser (persistent profile) and are sent at the next start with a connection

## lists-offline.e2e.mjs

A shared shopping list on two phones (admin and user, touch emulation), one of them offline for a while (`context.setOffline`). After the phone is back and its outbox has been sent, both phones show the server's state, and:

- A ticks offline, B ticks online: ticked (two people doing the same thing never cancel out); both offline and both tick: ticked
- A ticks offline, B ticks and opens it again later: open (the newer change wins, not the one that arrives last)
- A opens a ticked entry offline: open; B opens and ticks it again afterwards: ticked
- A ticks and un-ticks offline (no net change) while B ticks: ticked, nothing of A's is sent
- a reload while offline keeps showing the pending tick
- A changes the quantity offline while B ticks: ticked with the new quantity
- A deletes offline while B ticks: gone; A ticks offline while B deletes: gone

`SHOT_DIR=<dir>` (and `SHOT_PREFIX`) also saves screenshots of both phones after some of the steps.

## tasks-offline.e2e.mjs

A task list shared by admin and user: admin's browser goes offline (`context.setOffline`) and ticks in the list view while user changes the same tasks online. After the outbox has been sent, the page shows the server's state, and:

- A ticks offline, B ticks and opens it again afterwards: open (an older tick does not undo a newer change)
- a task in „In Bearbeitung“ ticked and un-ticked offline goes back to that column and sends nothing; B's tick meanwhile stays
- both tick a repeating task: ticked, exactly one next occurrence
- A opens a done task offline, nobody else changes it: open

`SHOT_DIR=<dir>` saves a screenshot after each scenario.

## drawing-live.e2e.mjs

Live drawing with three browsers on one shared drawing: admin in Chromium, user in Firefox, and admin again in Chromium with the WebSocket refused (the app falls back to SSE). Checked:

- opening the drawing with a WebSocket starts a live session, the opener is host; the others' note shows „Live-Zeichnung: …“
- opening it then asks „… zeichnet gerade“ with „Zusehen“ and „Mitzeichnen“; both draw at the same time and see each other's shapes, pointers with names and selections, and the avatar stack
- without WebSocket there is no „Mitzeichnen“ (a hint says why): the third browser watches, without tools, and sees new shapes live
- the host's tab closes: the other one becomes host (the watcher sees it), saves with „Fertig“; the drawing is in the note without session data and without a conflict copy, the watcher sees the end, and after reloading the note shows it and no live badge

`SHOTS=<dir>` also saves screenshots of the steps.

## copy.e2e.mjs

Selection over several bullets in Chromium and Firefox, in two notes (callout at the top; callout at the bottom with an empty indented last bullet). Checked, each time against the Markdown of the whole note:

- dragging from the bottom up past the first bullet, started at the end of the text, in the empty part of the row, on the action bubble, at the far right and in the empty space below the last bullet; dragging from the top down past the last bullet
- Ctrl+A twice (the callout row is marked too) and a new drag right after it
- the browser's own selection over several bullets is copied as Markdown too
- a click outside the note ends the selection
- Backspace deletes the whole selection

Run it after every change to selecting, copying or deleting in notes. Its test notes are deleted for good at the end, also when a check fails.

## paste-image.e2e.mjs

Pasting an image (desktop, Chromium and Firefox), through a synthetic paste event with a PNG drawn on a canvas: in an empty bullet the bullet becomes the image, in a bullet with text the image becomes an image bullet below it; both are stored on the server and load in the note. The cursor then goes below the image: to the start of the bullet that follows, or into a new empty bullet when nothing follows (Ctrl+Z takes back the image and that bullet in one step). Ctrl+Z removes the pasted image bullet again. Bullets with an image copied within MindSift and pasted keep the image's reference and upload nothing. Dragging image files in, through a synthetic drag (dragenter, dragover, drop with a `DataTransfer` holding a `File`): the target row is outlined while dragging and not after the drop, a file dropped onto a bullet with text becomes an image bullet below it, onto an empty bullet makes it the image, onto the title goes to the end of the note; a text file only gives the hint. Its test notes are deleted for good at the end, also when a check fails.


## audio.e2e.mjs

Voice notes, recorded in Chromium (fake microphone) and played in WebKit, whose GStreamer playback is close to the Linux desktop app's WebKitGTK. A recording as MediaRecorder writes it (no length, no index) is uploaded as it is and pasted in as a voice note; a second one is recorded through the app's recorder. Checked: the app saves its recording with the length in the file; in WebKit both voice notes show their length right away, the playhead moves along, seeking works, starting the second pauses the first, and after switching to another note neither plays and both have let go of their file. Its test notes are deleted for good at the end.

## transcription.e2e.mjs

Transcriptions in the background with the own Whisper server, which the script plays itself (slow on purpose, `WHISPER_DELAY_MS`, default 10 s; port `WHISPER_PORT`, default 18566). It needs a server without demo mode started with `STT_URL=http://localhost:<WHISPER_PORT>` and `STT_MODEL=fake` (`MINDSIFT_URL`, `MINDSIFT_LOGIN`, `MINDSIFT_PASSWORD`; the command is in the file's header); `run.sh` does not start one yet. Checked in Chromium with a fake microphone: "Transkribieren" on a voice note still shows "Wird erkannt…" after switching notes and reloading, and the text arrives in the caption by itself; a dictation by holding the rail's + is on the server once released, a reload right after shows it above the Quick Dump and the server makes the entry; with a failing Whisper server the recording stays there (after the server's own two retries, about 3 minutes) and "Erneut versuchen" makes the entry; dictating into a text field and switching the view asks first, "Bleiben" stays and "Trotzdem wechseln" goes.

## caret.e2e.mjs

Clicking into the text of a bullet without the cursor (desktop, Chromium, Firefox and WebKit, real mouse clicks): the cursor lands where it was clicked, right after opening the note, in a bullet the cursor just left (whose buttons take clicks as well), behind rendered Markdown, on the second line of a wrapped bullet and in bullets far down a long note; the rows far from the view are still skipped by the browser (content-visibility).

## drop-text.e2e.mjs

Text dragged in from another program (desktop, Chromium, Firefox and WebKit), through a synthetic drag (dragenter, dragover, drop with a `DataTransfer` holding `text/plain` and `text/html`): dropped onto a bullet without the cursor it goes in at the drop point, several paragraphs become bullets as when pasting, dropped below the last bullet it becomes a new bullet at the end. In Chromium also a real drag from outside the page (DevTools protocol, `Input.dispatchDragEvent`) into a bullet without and with the cursor, and in Chromium and Firefox text marked on the page and dragged with the mouse into the bullet with the cursor. A file or link dropped onto the sidebar is refused (drop effect `none`, drop prevented), a link dropped into a text field is not, and the app stays open. Over a folder row a file or outside text is not taken, a dragged note is. Its test notes are deleted for good at the end.
## secrets.e2e.mjs

A bullet with a hidden value of another note pasted into a note (the text goes into the bullet's field as pasting puts it there). Checked:

- the server stores a copy of the value in the note and the bullet points to it; the chip there reveals the value, the note does not reveal the value of the note of origin
- Ctrl+Z takes the paste out again and redo brings the copy back, although the server changed the reference
- a paste made offline is sent once the connection is back and gets the copy the note already has; its chip reveals the value
- in Chromium and Firefox: two bullets selected with Ctrl+A twice and copied with Ctrl+C give plain text with `••••` and no reference, and the app's own clipboard format with the reference; pasted with Ctrl+V into another note, both bullets arrive (the second still indented), the note gets its own copy of the value, and its chip reveals it

## live.e2e.mjs

Tasks and shopping lists behind simulated proxies (nothing blocked; WebSocket refused and SSE held without an answer; WebSocket refused and SSE refused): another device adds a task, moves it to another column and adds a list item. Each change has to show up in the open browser within 8 s, without reloading or switching tabs.

## linked-todos.e2e.mjs

A to-do in a note linked to a task in a list shared with "user", assigned to both accounts. The admin has the note open, "user" the list in the list view (two browser contexts). Each round: ticked in the note → the task view shows it done; reopened and completed in the task view → the note follows; unticked in the note → open again; renamed in the note and in the task view (detail dialog) → the other side shows the new title. After every change the task view still shows both assignees. 50 rounds (`ROUNDS`); afterwards task and note agree on the server, and the JS heap of both pages (after a forced garbage collection over the Chrome DevTools Protocol) and the server's Go heap (`/metrics`, only with `METRICS_TOKEN`; `run.sh` sets one) have not grown beyond a small margin. The times from change to display are printed; `SHOT_DIR` keeps screenshots of both pages of a failed round. About two minutes.

## channels.e2e.mjs

The owner types with a normal connection, the editor sits behind a simulated proxy. For each situation the chosen transport and the time until the change shows are measured: nothing blocked (WebSocket), WebSocket refused (SSE), WebSocket accepted but silent (SSE after missed heartbeats), WebSocket and SSE blocked as well as a hanging SSE (long polling), only plain requests (polling every 3 s).

`collab.e2e.mjs`, `lock.e2e.mjs` and `channels.e2e.mjs` take about a minute each. The tests do not run in CI because they need browser images.

## share-target.e2e.mjs

The share target (`/share-target`, handled by the service worker in `frontend/public/sw.js`): a form on another site (`127.0.0.1` instead of `localhost`) posting there, with and without referrer and from a sandboxed frame navigating the tab, is redirected to `/` and puts nothing into the inbox; a share posted by the app's own page arrives (`?shared=pending`, then in the inbox). The system's share sheet itself cannot be started from Playwright: it is a navigation the browser starts, with no page as its client, which the worker accepts the same way.

## Screenshots

`e2e/screenshots.sh` builds the image, starts it in demo mode (English) with a fresh database and recreates the pictures in `screenshots/` (`screenshots.mjs`). They are then scaled down (desktop 1280 px, phone 480 px wide) and saved as WebP at quality 90 (`cwebp` in an Alpine container). For the version in the header: `APP_VERSION=v0.2 e2e/screenshots.sh`. In the workspace picture the demo user `user` edits a bullet at the same time, so lock and presence show.

`e2e/refshots.sh` takes reference screenshots of the German interface from two images and compares them (used to check refactorings that must not change the look). `REFSHOTS_IMAGE` and `REFSHOTS_NAME` give a run its own image and container name, so several working copies can compare at the same time. Two pictures show the server's clock and differ between runs by design (see the head of `refshots.mjs`).

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

## passkey.e2e.mjs

Passkeys, on the same server without the demo; `run.sh` starts it with `BASE_URL=http://localhost:<port>`, the address the browsers open, as passkeys are bound to it. Chromium gets a virtual authenticator over the DevTools protocol (`WebAuthn.addVirtualAuthenticator`: ctap2, resident keys, user verification); a member the admin created:

- adds a passkey under Kontoeinstellungen → Sicherheit → Passkeys: password, name (filled in from browser and system), the browser's dialog; as first second factor it shows ten recovery codes and switches two-factor sign-in on
- signs in without password, once from the autofill of the login field (`autocomplete="username webauthn"`, the waiting conditional request) and once with "Mit Passkey anmelden"
- signs in with the password and is asked for the passkey (first, no code field without app)
- on a phone the passkey button of the login and the buttons of the second step are at least 44 px high
- removes the passkey, confirmed with password and passkey, after the warning that it is the last second factor; then the password alone signs in

Firefox has no virtual authenticator: it only checks that the login shows the passkey button and the settings the passkey card, without errors. `SHOT_DIR=<folder>` saves the login, the registration, the list (desktop and narrow), the second step (desktop and phone) and the remove sheet.

## tour.e2e.mjs

The guided tour (`frontend/src/features/tour`), started with "Tour starten" on the help page. Desktop in Chromium and Firefox, the phone in Chromium:

- every step is clicked through in order ("1 von 7" … "7 von 7"); the card stays inside the window, takes the focus and lights a control; on the phone its buttons are 44 px and the focus-mode step is skipped (the phone shows the list of notes, no open note)
- at the end the help page is back, with the focus on "Tour starten"
- keys: → on, ← back, Enter on, Tab stays in the card, Esc ends; the × ends too
- a click on the dimmed page and the triage's own keys (H, L, D, T, C) do nothing
- no data changes: notes, tasks, the inbox and lists are the same before and after

## oidc.e2e.mjs

Sign-in through an OpenID Connect provider (`internal/api/oidc.go`, `frontend/src/lib/oidc.ts`) against a real [Dex](https://dexidp.io) (`ghcr.io/dexidp/dex:v2.44.0`, configuration `e2e/dex.yaml` with one client and one person, kept in memory). `run.sh` starts Dex and a third MindSift server that signs in through it with the password login switched off (`OIDC_PASSWORD_LOGIN=false`, first admin from `ADMIN_USER`), and removes both afterwards; their ports are `E2E_OIDC_PORT` and `E2E_DEX_PORT`, else `E2E_PORT` + 2 and + 3, else free ones. Desktop in Chromium and Firefox, the phone in Chromium:

- the login shows only "Mit Dex anmelden": no password form, no sign-up, no "forgot password"
- the button leads to Dex; back in the app there is a new account from Dex (no password of its own, linked), MindSift asks no second factor, and the ticket has left the address bar
- signing out and in again, and in the other browser, lands in the same account
- an error of the return (`?oidc_error=cancelled`) is explained on the login screen and leaves the address bar
- the administrators' emergency access `/?login=password` shows the form with its explanation and signs the admin in
- on a phone the provider's button is at least 44 px high

Against servers that are already running: `MINDSIFT_OIDC_URL` (with `OIDC_PASSWORD_LOGIN=false` and `OIDC_NAME=Dex`), `MINDSIFT_OIDC_ADMIN`, `MINDSIFT_OIDC_PASSWORD`; the person at Dex is `erika@example.com` / `password` (`DEX_LOGIN`, `DEX_PASSWORD`). `SHOT_DIR=<folder>` saves the login with only the button (desktop and phone) and the error of the return.

## setup.e2e.mjs

The first-boot setup wizard with its one-time setup code (`internal/api/setup_code.go`). `run.sh` starts a fourth server without the demo and without `ADMIN_USER` (fresh database, port `E2E_SETUP_PORT`, else `E2E_PORT` + 4, else a free one), reads the code from that container's log (`Setup code: XXXX-XXXX-XXXX`) the way an administrator would, and passes it as `MINDSIFT_SETUP_CODE`. Checked:

- `/auth/status` says `setupCodeRequired`, and `/auth/register` does not create the first account
- the wizard shows the code field first, focused, with the hint on `docker logs mindsift`; on a phone it is at least 44 px high
- a wrong code is refused with the server's message and creates no account
- the right code, typed in lower case, creates the admin and signs in; afterwards the status asks for no code, the code is refused, and the new admin signs in with the password

Against a server that is already running (fresh, without `ADMIN_USER`): `MINDSIFT_SETUP_URL` and `MINDSIFT_SETUP_CODE` from its log. The test sets up that server, so it runs once per fresh database.
