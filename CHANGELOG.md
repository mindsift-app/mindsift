# Changelog

All notable changes to MindSift are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and from v0.6.0 on the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the major version is 0, the API and data formats can change with any minor version; such changes are listed under "Changed" or "Removed" and marked **Attention**.

Versions before 0.80.0 are in [CHANGELOG-archive.md](CHANGELOG-archive.md).

## [Unreleased]

Fixes from the security review of November 2026 (v0.94.0).

### Added
- The setup wizard asks whether to switch on daily backups (preselected on, at 03:00 server time, kept 3 days), with a reminder to copy `data/backups/` to another place. The same question appears after the first sign-in of an admin created with `ADMIN_USER`/`ADMIN_PASSWORD`. An invalid time or a retention outside 1–365 days is refused.
- Tables in notes: `/table` creates a table with a header row (two columns, two rows; text already in the bullet goes into the first cell). Enter adds a row below, Tab and Shift+Tab move between cells, the + next to the table adds a column, and the ⋯ menu inserts or deletes columns and rows and switches the lines: inner lines fading out towards the edge (default), a full frame, or the header line and column lines. On phones wide tables scroll sideways. Tables are copied, pasted, exported and imported as Markdown tables, are found by search, and AI agents read and write them through MCP.
- `ADMIN_USER` and `ADMIN_PASSWORD` (optionally `ADMIN_EMAIL`) create the first administrator on the first start, so a fresh server is never open to whoever reaches the setup wizard first. After signing in, the wizard only asks the remaining settings (name, language, sharing, registration, sample data). The variables only act while there is no account and can be removed afterwards; if they are set but unusable (one missing, password too short, invalid username or email), MindSift does not start and says why in the log. The password is never logged. Ignored in demo mode.
- The image has a health check (`/api/v1/health` every 30 s), so `docker ps`, Portainer and Dockge show whether MindSift is healthy and other services can wait for it with `depends_on: condition: service_healthy`. `docker-compose.yml` repeats it as `healthcheck:`, because Podman ignores the check in the image; with Podman, copy that block into your own compose file.
- Administration → Server: "Push only via known push services" lets the admin limit web push to the services of Google (Chrome, Edge, Android), Mozilla, Apple and Microsoft. Off by default, so any browser keeps working.
- The OAuth consent page warns when the way back after allowing access does not lead to a known AI service (claude.ai, chatgpt.com) or your own computer: anybody can register a connector under the name "Claude".
- The image is built for arm64 as well as amd64: it runs on a Raspberry Pi with a 64-bit system, on Apple Silicon and on ARM cloud servers. `docker pull` picks the right one by itself.
- Releases have the server attached as a single file for Linux (amd64 and arm64), with the frontend inside, for running MindSift without a container. Started this way it also keeps what it creates in `data/` to itself (files 0600, folders 0700), as the container does.
- `Doku/api/openapi.json` lists every route of the API with a short description (OpenAPI 3.1); a test fails when the router and the file disagree.
- The demo says that it is public: a line on the sign-in page and a slim notice under the header (until closed) tell that everyone uses the same accounts, that it resets every `DEMO_RESET_MINUTES` minutes and not to enter anything private.
- Conflict copies in notes have a third choice, "Keep both": the marking goes and both texts stay, the copy as a bullet of its own under the original. While someone edits the original, "Use" is greyed out and a line under the copy says who holds it; before, the click did nothing visible. Until it is settled, a copy sticks to its original: Enter or pasting in the original adds below the copy, and indenting, dragging or moving the original takes the copy along.

### Changed
- Typing and pressing Enter in long notes is faster: after a pause in typing, the hashtag and to-do counters only look at the note that changed, and the outline only updates the bullets that changed instead of going over every bullet.
- The built-in SQLite engine is updated from 3.46.0 to 3.54.1 (modernc.org/sqlite v1.61.0), with upstream fixes for WAL and full-text search, among them a rare database corruption when the write-ahead log is reset. Existing databases open unchanged. Saving notes and searching are faster under load.
- The server log names the built-in SQLite version at startup (`Database opened sqlite=…`), so admins can check it against SQLite's list of known vulnerabilities; scanners such as Trivy and govulncheck do not see it.
- Drawings: dragging shapes in large drawings is noticeably smoother, and the editor opens faster.
- Dropdown, date and time lists no longer redraw on every scroll step while you scroll inside them.
- API error messages for clients that send no `Accept-Language` header (scripts, curl) now come in the server's default language and in English when none is set, instead of always in German. The app itself and the sign-in screen are unchanged.
- The first-time setup endpoint (`POST /api/v1/auth/setup`) only accepts requests sent as `Content-Type: application/json`.
- The app loads faster after signing in: the emoji picker and the help (in your language only) now load when you first open them instead of with the app. Both still work offline after the first visit.
- **Attention:** `JWT_SECRET` must now be at least 32 characters long. A shorter value, or any example value ever published in the README, `.env.example`, `docker-compose.yml` or on the website (such as `put-a-long-random-value-here`), is ignored with a warning in the log, and MindSift signs sign-ins with its own random secret in `data/jwt.secret` instead. If your instance used such a value, everyone has to sign in again once after the update (visitors of password-protected public links re-enter the password); notes, hidden values and all other data are unaffected. To keep using your own secret, set `JWT_SECRET` to the output of `openssl rand -hex 32`.
- `.env.example` and `docker-compose.yml` no longer contain a placeholder for `JWT_SECRET`: left empty, MindSift generates one. The install script fills it with a random value unless `data/jwt.secret` already exists.
- Drawings: elbow arrows now have rounded corners in every theme, also in exported SVG; straight and curved arrows are unchanged.
- **Attention:** a note holds at most 20,000 bullets (40,000 counting deleted ones until they are purged). The editor says so when a new bullet is refused; importing or creating a larger note is refused with a message naming the note. Every change loads the whole note, so a note grown without limit slowed down saving for everybody editing it. Larger existing notes stay readable and editable, they only cannot grow.
- Ticking off, moving or adding a task makes 3 requests instead of 9: the counters in the navigation are fetched on their own (once for the action and its live echo) instead of reloading the profile, the triage deck and every list with its items twice. Creating, moving and deleting notes do the same.
- **Attention:** mail alarms, daily summaries and test mails always go to the account's login address; the separate alarm address is gone. A different alarm address set before and one still waiting for its confirmation are dropped on the update. To get alarms elsewhere, change the login address (confirmed by a link as before). This also fixes alarms that kept going to the old address after a confirmed change of the login address.
- **Attention:** a new login address only counts once its owner clicks the link mailed to it; until then the old one stays in use and the settings show the new one as waiting, with "Send link again" and "Keep the previous one". Without a mail server the address keeps waiting. Existing addresses stay as they are.
- **Attention:** others no longer see e-mail addresses, only names, usernames and profile pictures: in the people picker, @-mentions, and the member and share lists of notes, folders, lists, task lists and groups (also in the API). Admins still see them under Users. To share with someone by address, type the full address; the picker then asks the server.
- **Attention:** profile pictures are uploaded pictures (up to 300 KB) or emoji. Links to pictures on other servers are no longer accepted and are removed from existing accounts, because those servers learned who looked at the picture.
- Test mails from Settings → Alarms go only to your own confirmed addresses, at most 5 in 15 minutes.
- The admin user list no longer contains the people's alarm targets (Discord and own webhooks).
- Pages can be zoomed on phones again (accessibility); on iPhone and iPad fields use 16 px text so Safari does not zoom in by itself.
- The server sends HSTS when visitors come over https, and only believes `X-Forwarded-Host`/`-Proto` from trusted proxies. Outgoing requests (webhooks, link previews) no longer follow redirects from https to http.
- Files the server creates in `data/` are readable by MindSift only (files 0600, folders 0700).
- The image installs the security fixes of its Alpine base system when it is built (zlib, CVE-2026-4738).
- Unexpected server errors tell browsers and AI agents only "Internal error"; the details are in the server log. Tokens of public links and typed sign-in names no longer appear in the log.
- Signing in with the part of an e-mail address before the @ only works when exactly one account has it.
- Unknown API paths answer `404` with JSON instead of the app's page; `POST /keys` with a body that is not valid JSON answers `400` instead of creating a key.
- The install script no longer falls back to the time of day as `JWT_SECRET` when no random source is available (MindSift then makes its own). `compose.yaml` was removed, it was an outdated copy of `docker-compose.yml` that Docker Compose preferred.
- The demo switch is called `MINDSIFT_DEMO` in the docs, `.env.example` and `docker-compose.yml`. The earlier names `MINDA_DEMO` and `DEMO_MODE` still switch the demo on, so existing `.env` files keep working.
- A `DATABASE_URL` that names a Postgres database is no longer ignored silently: MindSift logs a warning at startup that it only supports SQLite and which file it uses instead.
- Server log: the field names are English throughout (`path`, `count`, `idle_days`, `trashed_tasks` … instead of `pfad`, `anzahl`, `tage` …) and the messages carry no emoji. If you filter the log by field names, adjust the filters.
- Building the image no longer runs `go mod tidy`; it checks the downloaded modules against `go.sum` (`go mod verify`) and uses `go.mod` as committed.
- A database error is no longer taken for an answer. Checks that decide something answer on the safe side when the database cannot say: accounts waiting for confirmation or approval stay locked, an address counts as taken, the last administrator is not removed, the MCP endpoint counts as switched off. Elsewhere the request fails with an error instead of showing a shorter list, and steps on the side that fail (cleaning up, a mail that did not go out) appear in the server log.
- `POST /oauth/revoke` answers `503` when the token could not be revoked, and "Keep the previous one" for a waiting address reports when it failed; both said it worked before.
- The page description shown by search engines, link previews and the installed app names notes, tasks and shared lists first and the triage last.
- New tagline "Notes, tasks and a clear head, self-hosted." in the About dialog, the footer of mails, the page description and link previews, in all five languages. It replaces "A clear head in three seconds."
- The pinned start note of new accounts and the demo is called "Diagrams drawn by an AI agent over MCP"; which agent drew them is said in the note itself.
- Link previews read the page with the HTML tokenizer of `golang.org/x/net` instead of patterns: comments, unquoted attributes and the title of an inline SVG no longer confuse them. The server's settings are read from the database once and kept in memory until they change.
- **Attention:** moving a bullet with its children into another note is `POST /documents/{id}/branches/move` (and `/branches/move/undo`); the earlier `POST /documents/{id}/move`, whose address `PUT` also used for moving a note into a folder, keeps working. `POST /auth/quickstart` (always `403`) and the WebSocket address `/ws/spaces/{id}`, which no app version used any more, are gone.
- The sign-in page loads about 170 kB (compressed) instead of 530 kB; the rest of the app follows right after signing in, or at once when you are still signed in.

### Fixed
- Deleting your data or account asked for the password without counting wrong guesses; now it counts them like failed sign-ins and locks the same way.
- With e-mail confirmation on, the sign-up form no longer tells whether an address already has an account, and a failed sign-in takes as long for unknown names as for known ones.
- Accounts waiting for confirmation or approval are locked from the first moment, not only right after being created.
- Two first-time setups at the same moment could create two admins.
- A Markdown or backup export that fails half way is cut off, so the browser reports an error instead of saving a broken ZIP.
- Task alarms: when the server could not read which alarms had already gone out, it took that for "none" and could send them a second time.
- Restoring a server backup, "Back up now", deleting your data or an account, mailing an invite and the tests for SMTP, alarms and push ended with "No connection to the server" after 12 seconds, even though the server was still at work and finished it. The app now waits up to five minutes for these, and the server keeps their answer open as long.
- The test push notification comes in your language instead of always in German.
- Lists: after opening a list from the search, a link or a notification, returning to the Lists tab and changes to the lists from elsewhere (a new, renamed or deleted list, an item moved to another list) switched back to that list. Picking the same list a second time from the search did nothing. A list event could also switch to the first list on a device that had no list remembered.
- Task dialog: following or unfollowing a task while typing its title or notes closed the editor and dropped the text. The title editor started with the title from when the dialog was opened, so saving could write an old title back over a change made elsewhere.
- The shopping list created for you when you have none is named in your language instead of always "Wocheneinkauf".
- A conflict copy in a note could end up away from its original bullet, behind bullets added after the original in the meantime (for example offline), or on the same position as a deleted bullet that came back. It now always sits right under its original.
- A database or driver error on a path that answers with 400, 403 or 404 (creating a group, sharing, moving folders and others) no longer reaches the browser or an AI agent as raw SQL text: it is answered as an internal error (500, details in the server log). Messages written for people still come in the request's language, now also those with values in them (minimum password length, allowed e-mail domains). A failed test message to your own Discord or webhook says the HTTP status or "Target not reachable" instead of network details.
- Long notes no longer stall on the first scroll step: the note's name in the header (phones and narrow windows) is switched on its own instead of rendering every bullet again; on the desktop, where that header does not exist, the same happened for nothing (1000 bullets with a slowed-down CPU: 320 ms to 1 ms).
- Enter and typing in long notes react faster: a change renders only the bullets it touches instead of all of them, and a new or removed bullet no longer makes the browser recalculate the look of every bullet below it. A typing pause, Enter, moving the cursor or a change by someone else no longer renders all bullets of the note either, only the ones affected. In a note with 1000 bullets and a slowed-down CPU, Enter went from about 3.4 s to 0.7 s of work and the pause after typing from 3.6 s to 0.55 s.
- Switching a note to focus mode and back no longer judders: the note now glides sideways on the graphics card and takes its new width at once, instead of rewrapping every line on each frame, and all bullets are measured for their new width in one pass (200 bullets with a slowed-down CPU: 75 instead of about 35 frames in 1.2 s, layout work 450 to 40 ms).
- Typing in a large note stores much less in the browser: each pause saves only the changes not yet confirmed, and the whole note only after the server confirmed something (5000 bullets: about 70% less work for storing per pause).
- Stretching the Kanban board or the task calendar to full width and back no longer judders: it switches at once and fades in, instead of animating width and margin, which laid out and painted every card on each frame (with a slowed-down CPU: 418 to 137 ms of work for the board, 326 to 64 ms for the calendar).
- Dragging a card across the Kanban board, switching it to full width or filtering by a hashtag renders only the cards that change instead of every card on the board (60 cards with a slowed-down CPU: half the script work while dragging).
- The arrow buttons on Kanban cards name the target column in the app's language; the tooltip was always German.
- A collapsed numbered item with sub-bullets is now highlighted in the accent colour, just like a collapsed bullet, so you can see that something is folded away beneath it. Collapsed warnings and errors with sub-bullets get the same highlight.
- `HEAD` requests (`curl -I`, uptime monitors such as UptimeRobot) are answered like `GET` instead of `405`, for the start page, `/api/v1/health` and every other `GET` route.
- Paths that are neither a file of the app nor one of its pages (e.g. `/.env`, `/.git/config`, `/data/mindsift.db`, `/metrics`, `/debug/pprof/`) answer `404` instead of the app's start page, so security scanners no longer report them as findings; folders such as `/assets/` no longer list their files.
- The Kanban board and the task calendar no longer judder on the first scroll step on large boards: while the bar above them scrolls away, only the columns of the first row are restyled instead of every card (400 cards with a slowed-down CPU: 261 ms to 2 ms per scroll step).
- The startup message in the server log names the port MindSift listens on and, when `BASE_URL` is set, that address, instead of always `http://0.0.0.0:<port>`.
- The container makes the data folder of older installations private on its first start: the database, keys and media were still readable for group and others, because the stricter permissions only applied to new files. It happens once, only when something there is still open; started with `--user`, only that user's files are changed.
- The installed app starts offline after its first visit even when the browser has cleared its own cache: the service worker now keeps every file of the app from the moment it installs. Before, the files of the first visit were only in the browser's cache. If a new version replaced the app's files on the server while a page was open, the page reloads once instead of staying blank.

## [0.94.0] - 2026-11-10

### Added
- Tasks: reminders per task. In the task dialog, tick one or more times under "Reminder" (from the due time up to 1 month before, e.g. 2 weeks before and on the day). They replace the lead time from Settings → Alarms for this task and apply to everyone who gets its due alarm (the assignees, or every member of a shared list); "Default" shows your lead time and goes back to it. Without a time only whole days are offered, reminding at 9:00. Early reminders say when the task is due ("is due on 24.11.2026") instead of "due now", by mail, push, Discord, webhook and in the bell. Repeating tasks keep their reminders; rows and Kanban cards show a small bell. AI agents (MCP) can set them with `create_task` and `update_task`.
- Drawings: elbow arrows can be shaped by hand. Drag an arrow's end onto a side of a shape to choose where it docks, anywhere along that side (it snaps to the middle). Every stretch of the line has a handle: drag it to move the stretch across (at an end the line adds a short stub, so the end stays), double-click a full handle to remove the stretch. Moved stretches stay when shapes move or an end docks elsewhere. Arrows laid out by an AI agent can be edited the same way.

### Changed
- Sample notes (and the demo): the start page is now "Diagrams by Claude via MCP", two colourful diagrams Claude drew through MindSift's MCP server: MindSift on a small server (Docker Compose behind a router with Caddy, Whisper and a local language model in Open WebUI) and a typical home server (TrueNAS, Jellyfin, a small k3s cluster, Home Assistant). The homelab note keeps its hand-drawn network plan as the plan before the move. In the demo all folders are open on the first visit.
- Drawing editor: opens with the hand (moving the view), so nothing in the drawing moves by accident; an empty drawing starts with selecting. Next to "Done" a close button (the sign for leaving full screen) leaves without saving; with unsaved changes it asks first (Discard / Cancel).
- Drawings in notes: the size button stays and switches between the recommended size and the other one: the whole drawing large (tall drawings) or the recommended height with readable text, moved sideways (wide drawings). The preview's height follows the note's width. The mouse wheel keeps scrolling the page (Ctrl + wheel zooms); a second click ends moving the view, and a view not saved glides back.
- Due alarms with the lead time "1 day before" no longer say the task is due now; they name its due date. A lead time of whole days counts calendar days, so the change of daylight saving time no longer shifts it by an hour.
- Task dialog: the status is one dropdown instead of a button per column, so boards with many columns stay tidy; the dropdown and its options show each column's colour. The repetition and the task list are picked from the same kind of dropdown instead of the browser's own.
- All dropdowns in the app (task rows, sorting, search filters, code block language, journal, sharing, settings, administration, groups, setup) use the app's own dropdown instead of the browser's: same look in every theme, colour dots and list emojis in the options, typing jumps to an option, long lists such as the code languages get a search field.
- Dates and times on computers: a calendar of our own instead of the browser's (the week starts as your language has it, today framed, month and year to pick, fully usable with the keyboard), and a list of times in 15-minute steps. Both can be typed as well, e.g. "24.11.", "24112026", "1430" or "2:30 pm". On phones and tablets the system's own date and time pickers stay, they work best with fingers.
- Drawings: an arrow docked to a shape no longer comes loose when the line itself is dragged by accident; it is detached only by dragging its end. A click on an end with a twitch moves nothing.
- Drawings: labels on a level stretch of a line sit just above it, and their background lets the line show through a little. Labels that would cover each other move aside (below the line, or a little up or down an upright one).

### Fixed
- Notes: following a link to a note in a folder (or opening it from the search, backlinks or a mention) opens its folders in the sidebar, so you see where the note lives.
- Drawings from AI agents: several lines entering the same side of a shape end side by side instead of on one point, so it no longer looks as if their sources were joined.
- Drawings from AI agents (Mermaid): lines no longer lie on top of each other where several shapes branch out; in every gap each source runs across on a line of its own, so it stays clear which arrow goes where.
- Drawings from AI agents: moving a shape in the editor no longer turns the arrows into straight lines; they stay right-angled, and the line style shows "elbow" for them. This also applies to drawings created before.
- Drawings: elbow arrows between shapes stacked above each other run up and down (out of the bottom, into the top) instead of leaving sideways just because the shapes sit far apart across.

## [0.93.1] - 2026-11-10

### Added
- Public notes: visitors can zoom into a bullet by clicking its dot, like in the app; a path above leads back.
- Tasks: click a subtask's title in the task dialog to rename it (Enter saves, Escape cancels; @-mentions work there too).
- Tasks: a click beside the task dialog closes it. With unsaved changes the dialog shakes and asks first, also for the close button, Escape and Back.

### Changed
- Notes: Enter (or Tab) in the title starts a new empty bullet at the top when the first bullet is not an empty text bullet, so something can still go in front of a drawing or an image.
- Shared task lists and shopping lists show the same "shared" sign in their tab as shared notes in the sidebar; the tooltip names the people.
- Sharing dialog: what is shared stands small on top ("Share task list"), its name large below, instead of the name twice.
- Calendar: "Unscheduled" on the desktop shows the same task rows as the day (tick off, change the status, edit), so unscheduled tasks can be worked through right there. Rows from the day and from "Unscheduled" can be dragged onto a day or onto "Unscheduled". Both tabs now look alike: a counter like the list tabs, no second heading for the day, a centred hint when empty, and a field for a new task (for the day, or without a date).
- Calendar on the desktop: days get more room. Monday to Friday fill the width and the weekend is one sideways scroll (or the "Sat – Sun ›" button; "‹ Mon – Tue" leads back) away; the columns never get narrower than about 7 rem, so the calendar stays usable in narrow windows. Scrolling stops at the edge of a day, and the weeks there always run Monday to Sunday, so the weekend lies together at the end also in languages whose week starts on Sunday.
- Calendar on the desktop works like the Kanban board: month/week and a full-width button sit at the right of the hashtag row, the month (or week) and ‹ Today › moved into the side column above its tabs, so the calendar starts higher. One wheel step scrolls the bar above away and the calendar fills the screen; the full-width setting is the same as the board's.
- Tasks: the switch between list, Kanban and calendar, and month/week of the calendar, look like the other view switches (hashtag sorting, to-dos). In all view switches the raised field slides to the newly chosen option.
- Task dialog: the repeat options read just "Daily", "Weekly" … without the 🔁 in front.
- Calendar: a task dragged to the left or right edge of the calendar no longer scrolls jerkily with each mouse movement; held there, the calendar jumps one day on after a short moment, and one more day at a time while it stays.
- Footer: only the version remains (a click opens "About MindSift"); the separate "About MindSift" link is gone.

### Fixed
- Tasks: watching a task no longer seems to end after any change to it (priority, status, …); the eye in the task dialog stays on. The watch itself was kept, the app only forgot it.
- Notes: jumping to a bullet (search, links to bullets, the notification center, tasks) no longer puts the cursor into it, which locked the bullet for everyone else; it is scrolled to and lit up as before.
- Kanban: after switching the language, "All tasks" no longer shows the standard columns twice (once in the language the lists were created in, once in the new one). Standard columns that were not renamed now show in the language of whoever looks; the Spanish, French and Italian names in the app and on the server are the same again.
- Public notes: hovering a bullet no longer shows an empty frame where the bullet's buttons are in the app.
- List tabs: the counter no longer leaves too much room on the right since the delete button moved into the ⋯ menu.
- Notification center: entries have a small gap between them, so unread ones no longer merge into one block.
- Notes: zooming into a drawing, an image, an audio file or a divider no longer shows the drawing's data (or the file reference) as the title. The title and the path above name the kind and what it says, e.g. "Drawing: Start, Check, End" with the words from the drawing, or the caption of an image; it cannot be edited there. Bullets can still be added below.

## [0.93.0] - 2026-11-09

### Added
- Tasks: a calendar view next to list and Kanban. Month or week on the desktop (7 columns, no hours), the week on phones. Tasks without a date wait in "Unscheduled"; drag a task onto a day to set its date (a time stays) or back to remove it, Ctrl + Z takes it back. Repeating tasks also show their coming dates, greyed with ↻, which open the task itself. On the desktop a column on the left switches between the chosen day (today until you click one) with its tasks and a field for a new one, and the unscheduled tasks; phones open a day as a sheet. ← → leaf through, T jumps to today.
- Notification center: a bell next to search shows how many notifications you have not read yet. It lists everything that happened for you (assigned, mentioned, new or completed tasks in shared lists, due tasks, changes to watched tasks, things shared with you), whatever channels you chose and even while notifications are paused; your own actions and muted lists stay out. A watched task keeps one entry with its latest change. Click an entry to open the task, note or list; "Mark all as read" and "Delete all" are on top. Entries disappear after 14 days.
- Notes and tasks: @-mentions. Type @ in a bullet, in a task's description or in a new subtask and pick a person; people without access to the note or list are shown greyed out. The person gets a notification ("I was mentioned" in Settings → Alarms, by email unless you choose otherwise); keeping a mention while editing does not notify again, mentioning them again does. Mentions always show the person's current name; exports, AI agents (MCP) and search snippets show "@Name", and searching a name finds the mentions.
- Task lists and shopping lists: a ⋯ menu next to the list status with Share, Rename (new), Delete and, for shared task lists, Mute (what muting does is in its tooltip). A muted list sends you no notifications about new or completed tasks or due dates of unassigned tasks; tasks assigned to you, mentions of you and tasks you watch still come.
- Notifications: "Task assigned to me". When someone else assigns a task to you, you hear about it (by email unless you choose otherwise in Settings → Alarms). Assigning a task to yourself sends nothing.
- Notifications: "New task in a shared list". When someone adds a task to a task list shared with you (creates it there, sorts it there from the inbox or moves it there), you can be told; off by default, switch it on in Settings → Alarms.

### Changed
- Task lists and shopping lists: the list tabs stay in one row. Lists that do not fit are behind "⋯ n" at the end of the row (the open list always stays visible), so the buttons on the right no longer jump into a second line. Dragging a task or entry onto "⋯ n" opens it.
- Tasks: a dragged task is shown half transparent, so you can see the list tab under it.
- Tasks in shared lists: a new task starts out assigned to the person who created it. The due alarm goes to the people assigned to the task, or to every member of the list when nobody is assigned (each with their own lead time and channels), no longer only to the creator. The daily summary lists tasks by the same rule.
- The delete button on the open list tab is gone; deleting is in the ⋯ menu.
- Notifications about watched tasks name what changed: status, priority, due date, text, description, subtasks, tags, assignment or repetition, several changes in one line ("changed “Clean the cellar”: priority: Important, status: In progress"). Before, most changes only said that the task was changed.

### Fixed
- Notifications: ticking or renaming a task in a note now notifies its watchers and, when completed, the members of its shared list, like a change in the task itself. Typing in the note sends one line with the latest title, not one per pause.

## [0.89.1] - 2026-11-09

### Added
- Notes: Ctrl + click (Cmd + click on macOS) on a bullet's arrow expands or collapses it together with all its sub-bullets, on every level. A single Ctrl + Z takes it back.

### Changed
- Notes: focus mode shows the note as wide as the editor with the folder sidebar hidden, instead of a narrow reading column.

### Fixed
- Notes: right after reloading the page, focus mode started with the note at the very top instead of keeping it at the height it had in the workspace.

## [0.89.0] - 2026-11-08

### Added
- Notes: "Copy link" in the note's ⋯ menu copies a link to the note. Clicking it opens the note in MindSift (in the installed app where the system allows it), also for everyone the note is shared with.
- Tasks and shopping lists: sort the list tabs by drag and drop. The order is your own (also for shared lists) and is used in the phone menu as well; new lists go to the end.
- Administration: redeemed and expired invites disappear from the list 30 days later; until then the row says when.
- Tasks in shared lists: the details name the person who created a task ("Created by Anna on …"), not only tasks created through an API key.
- Profile picture: after picking a picture you can move and zoom it in the round frame before it is used (drag, slider, mouse wheel or two fingers).
- Sharing dialog: if someone shared a note, folder, list or task list with you, the dialog names them ("Shared by Anna", with their picture).
- Notes: drawings in a bullet with `/canvas`. Rectangles, ellipses, diamonds and text, arrows that dock to shapes (straight, curved or elbowed), freehand and an optional grid, edited full screen. In the note the drawing fills the width; click into it to move and zoom, drag its lower edge to change the height, and "Save view" keeps section and height for everyone. Its buttons sit in the bullet's action bar. In shared notes the drawing is locked for others while someone draws; drawing works offline and is saved once the connection is back. Search finds the words written in drawings, copying a drawing and pasting it into a note keeps it a drawing, and the Markdown export contains drawings as SVG pictures that importing turns back into drawings. AI agents (MCP) read a drawing as a short description of its shapes, texts and arrows. The demo's homelab note has a sample network plan. Arrows can carry a label (double-click the arrow).
- Backups: every backup ZIP (the daily server backups and "Download backup") also holds your notes, tasks and lists as an Obsidian vault in plain Markdown, in the `Obsidian` folder. Obsidian or any text editor opens it directly, so your data stays readable even without MindSift. Images and voice notes are stored once, in the vault; restoring works as before, older backups too.
- Help: a card on drawings (`/canvas`) with tools, keys, text and arrows, the view in the note, shared notes and offline, and a row for the drawing keys in the shortcut list.
- AI agents (MCP) can draw: `add_note_bullet` with type `drawing` takes a Mermaid flowchart or mind map, including its colours, and the server lays it out (layers, few crossing lines, right-angled arrows; mind maps with a colour per branch). `update_note_bullet` replaces a drawing, and a ```` ```mermaid ```` block in `create_note` becomes a drawing too.

### Changed
- Installed app: links to notes, tasks and lists (for example from AI agents over MCP) open in the installed MindSift app instead of a browser tab, where the system allows it, and an open app window is reused without reloading. On Android this needs "Open supported links" switched on in the app's system settings; apps that open links in their own built-in browser keep doing so.
- Lists on the desktop: the field for a new item looks like the one for a new task: one bar with the + in front and microphone, quantity and "Add" inside it.
- Voice input with your own Whisper server: every microphone sends the recording in pieces while you speak (every ~8 s or at a short pause), like Quick Dump already did. Dictating a minute into a task's notes no longer means waiting minutes for the whole text at the end; it arrives while you speak.
- Task details: the microphone sits in the top right corner of the title and notes fields, like in Quick Dump, and is there while the field is open. The microphone above the notes, which could be started with the field closed and then seemed to load forever, is gone.
- Journal: "Today" is back, at the right of the "Journal" title above the calendar in the sidebar.
- Journal: the lines between the days run across the text and fade out to both sides, instead of running into the frame (in focus mode across the whole screen).
- Notes: undo and redo survive switching to another note or view and back (for the last 20 notes, while the app is open; a reload still clears them). Undoing an extract, a move or a pulled-back note works after switching, too.
- Notes: links to notes carry the note's id. Renaming or moving a note no longer breaks links to it, and two notes with the same title are told apart. A link shows the note's current title, or its own text if it has one; links to a single bullet show "title › start of the bullet". Existing links are updated once where the title is unambiguous; the others keep working by title as before.
- Notes: Ctrl+L with marked text opens the link dialog; the marked text becomes the link text (for notes, bullets and web links).
- Notes: "Create" in the question about a missing note points the link at the new note.
- AI agents (MCP), the Markdown export and public links see links to notes as `[[current title]]` without ids; `[[Title]]` written by an agent or imported is linked to its note when the title is unambiguous.
- README: new picture of focus mode with pinned bar and sidebar and the network plan drawing; all pictures renewed.
- README: the journal section says more (calendar dots, "Today", days as ordinary notes, switching it off), note links surviving renames are mentioned, and the test numbers are current.
- Tasks and lists: the "Shared (3)" button in the header looks like the one of the notes.
- Journal: on large screens the bar at the top works like for notes, for the day marked in the calendar: live status, sharing, save status, undo/redo, the menu and focus mode (also with Ctrl+Shift+F). The journal's own title row is gone there; phones and tablets keep it with the calendar.
- Voice input: without a chosen language, Whisper now detects the spoken language itself ("Automatic"), which copes much better with sentences that mix languages, such as German with English terms. "Like the app language" stays available as an option; a fixed language you chose is kept.
- To-dos from notes: "Open / All" switch to hide done to-dos (the view starts with the open ones, the choice is remembered on the device). The switches there and the sorting of the hashtags share one look.
- Sharing dialog: "User" comes first and is preselected, "Group" second.
- Administration: the list of invites stays visible when it is empty and says so.
- Profile picture: a new picture, an emoji or removing it is saved right away; the save button is only for name, username, address and password.
- Profile on phones: with unsaved changes the save button floats above the bottom bar and says so, instead of staying far down the page.
- Notes: turning a bullet into its own note keeps the bullet as the new note's first bullet (its sub-bullets below it, its hashtags with it) instead of making its text the title only. The title is taken from the bullet's text, or "New note" when the bullet has no text to name it (a drawing, picture, code or table). Pulling such a note back puts the bullet in place of the link again.
- Help: the card "Appearance & custom themes" only covers themes now; offline work, server backups and the forgotten password have a card of their own. Both are in the new category "Account & settings".
- Notes: clicking a link to a note that does not exist (anymore) asks first instead of creating an untitled note right away: "Create" makes a note with the link's title, "Remove link" keeps the text and drops the link.

### Fixed
- Shared notes: the lock badge of someone else working in a bullet floats over the bullet's top right corner instead of taking room next to it, so text and drawings no longer change width while they type.
- Shared notes: while your cursor is in a bullet, bullets others add or remove above it, or text they type there that wraps onto a new line, no longer push it up or down the screen.
- Shared notes: a bullet someone left is free for the others after 7 s instead of 20 to 27 s.
- Shared notes: an open note sent many requests per second without anything happening (every sync told all open windows, including the sending one, that the note had changed, and they synced again). The server now only reports real changes; an idle shared note is quiet again. While someone else holds a bullet, the note checks every 3 s, so their lock disappears soon after their browser closed.
- Journal: deleting the last bullet of a day removes the day from the journal right away, instead of leaving its date behind without bullets (today always stays). The day that moves up becomes the one marked in the calendar and offered for sharing.
- Journal: the save status in the tab bar could keep spinning after the day in view changed while a day was still saving; it now shows the status of the day in view.
- Journal: in focus mode the text starts at the same height as in the normal view, like in notes.
- Folders: creating "Rancher / Kubernetes" (spaces around the slash) made a parent "Rancher " with a trailing space, and moving a note into "Rancher" then created a second "Rancher" next to it. Folder paths are now cleaned segment by segment ("Rancher/Kubernetes"), and existing folders are cleaned and merged once on update.
- Notes: turning a drawing into its own note put the drawing's raw data into the note title.
- Notes shared with others: clicking into a bullet someone else was typing in (locked, so nothing could be typed) and out again created a conflict copy of their text. Leaving a bullet now only sends text you actually typed there, and while the cursor sits in a locked bullet you see the other person's typing as it arrives.
- Administration: the actions of an invite (copy link, copy code, send by email, delete) no longer wrap onto a new line and to the left when the address is long; they are compact icons on the right like in the user list, and long details are shortened.
- Sharing dialog: password managers no longer offer to fill in the password of a public link (it was a password field and looked like a login).
- Registering with an invite bound to an email address failed with "bound to a different email address" although the address looked the same: an address copied from a messenger or a mail can carry invisible characters. Email addresses are now cleaned of them everywhere (invites, registration, accounts, sign-in), and the message shows which address the code belongs to (partly hidden, e.g. `an***@example.com`).
- Shared shopping lists: the avatar of the person who added an entry no longer disappears when the entry is checked off, unchecked or edited (it only came back after reloading). Changes sent through MCP are affected the same way.

## [0.88.0] - 2026-11-07

### Added
- MCP: notes, tasks and lists in tool results carry a `url` that opens them in the app (needs `BASE_URL`), so an assistant can link to what it found. Links of the form `/?note=…`, `/?task=…` and `/?list=…` open the item after signing in.

### Fixed
- MCP: `create_note` no longer creates an empty note when a model sends plain text. Every line becomes a bullet, content sent as a list of strings or with doubly escaped line breaks works too, and if nothing usable is left the result says so instead of failing silently. Unknown arguments are reported as well.
- MCP: an icon has to be a single emoji (or empty for the default); a word like "optional" is refused with a clear error instead of being stored as the icon.
- Importing Markdown or creating a note through MCP no longer hangs on an indented quote line right after a paragraph.

### Changed
- Development: GitHub release pages are created by the pipeline after the images of a version tag, with the version's CHANGELOG section as text.

## [0.87.4] - 2026-11-07

### Fixed
- Lists: "+ quantity" on items without a quantity was German in every language.
- The "To-dos" tab of the workspace and the "Top level" group in the to-do overview and the note trash were German in every language.
- Triage: sorting a thought no longer makes the card flash. The card that was sorted showed up again for a moment and the next one blinked once when the deck reloaded; now the old card goes at once and the next one slides in.
- The badges "Extended" and "Subtask" at to-dos in notes and the fallback title in the zoom path were German in every language.

### Changed
- Less server load while typing in a note that other tabs or people have open: the counters in the navigation no longer reload on every edit, only when tasks, notes or lists change, and at most once per burst of changes.
- Development: the checks of the pipeline run on the developer's machine before every push (`ci/local-checks.sh`); the image builds on GitHub test once more only for `main`, the public release.

## [0.87.3] - 2026-11-06

### Changed
- **Attention:** The container no longer runs MindSift as root but as the user `mindsift` (uid 1000). On the first start after the update it hands `data/` to that user by itself, nothing to do. Whoever sets `user:` in the compose file gives `data/` to that user first (`chown -R 1000:1000 data`).
- Build and test tools updated (Vite 8, Vitest 5, ESLint 9.39, typescript-eslint 8.72, Playwright 1.65): the security alerts about them are gone. None of them reached the app itself; they only ran while building.

## [0.87.2] - 2026-11-06

### Fixed
- Administration: password managers no longer offer logins in the search popover, the invite and create-account forms or the other admin fields. Passwords set for other accounts and the SMTP password show as dots without being password fields, so no manager saves or fills them.

## [0.87.1] - 2026-11-06

### Changed
- Focus mode is one click away: a button above the note takes the place of the share button on large screens. "Share…" moved into the note's menu; a shared note keeps its share pill in the tab bar. Phones stay as they were.
- Administration: "Create account" and "Invite" sit side by side with their fields one below the other, so long e-mail addresses no longer push the buttons around. Organizations are added with a "+" that opens a small search (as when moving a bullet into its own note); the same search adds people to an organization.
- Public note pages open in the default theme, light or dark after the visitor's system. A coloured dot at the top right lets visitors pick another theme family, a sun/moon button switches between light and dark; the choice stays in their browser and does not touch their own MindSift theme. The owner's theme is no longer passed on (it did not work with custom themes).

### Fixed
- Share dialog: with a password-protected public link, "New link" and "Revoke" no longer wrap into a line of their own.

## [0.87.0] - 2026-11-06

### Added
- Public links to notes: the owner shares a note read only with anyone who has the link, also without an account, optionally with a password. Links always expire (1 hour to 14 days, default 3 days), can be revoked or replaced at any time and stay out of search engines. Visitors see the note as it is being written, laid out like focus mode and in the owner's theme family (light or dark after their system), without hidden values, names or links into other notes. Admins can switch public links off and shorten the longest duration (`PUBLIC_LINKS`, `PUBLIC_LINKS_MAX_DAYS`).
- A person can belong to several organizations. Click an organization in the administration to add or remove members; before someone is taken out, a preview tells how many shares and group memberships would go. Whoever is in several organizations picks one when creating a group.
- People search can be switched off (`PEOPLE_SEARCH` or Administration → Server & Sharing): then nobody is suggested while typing, people are added by their exact e-mail address or username.
- New role "user manager": manages members, invitations and organizations, but not admins, roles, e-mail addresses, passwords or the server settings.
- Backups of accounts an admin deletes stay for the backup retention period and can be downloaded under Server & Sharing → Backups, so an account deleted by mistake gets its data back. Accounts deleted by their owners still lose their backups at once.

### Changed
- **Attention:** The sharing modes now speak of sharing instead of seeing: "Private", "Within organizations" and "Open". Whoever works on something together with you shows there by name, even without a common organization; this gives no right to find or share with them elsewhere.
- **Attention:** Invitations always create members, also older codes that still name the admin role. Roles are given afterwards in the user list.
- Invitations and new accounts can name several organizations; the organization dropdown in the user list is gone (organizations show there as information).
- User list: long e-mail addresses no longer push the buttons into a new line; on phones the role sits in a row of its own above the buttons.
- REST API: `organizationId` on users and invites became `organizationIds`; `PUT /admin/users/{id}/organization` was replaced by `POST/DELETE /admin/organizations/{id}/members`.

### Fixed
- A few texts in the share dialog and the SMTP test were German in every language.

## [0.86.3] - 2026-11-06

### Changed
- Focus mode keeps the note at the height it has in the workspace, so the text no longer jumps when focus mode starts, and the note glides to the middle instead of jumping sideways. Below the note there is room to scroll its end up into the upper third of the screen.

## [0.86.2] - 2026-11-06

### Added
- `SECURITY.md`: how to report a vulnerability privately and which versions get fixes.

### Fixed
- Code blocks with long lines: clicking into the block no longer shrinks it, so the horizontal scrollbar no longer covers the last line or brings a vertical one back. The extra gap below the last line is gone again.

## [0.86.1] - 2026-11-06

### Fixed
- Code blocks with long lines: the horizontal scrollbar no longer sits right on the last line, no longer brings an empty vertical scrollbar along and only shows while the pointer is on the block.

## [0.86.0] - 2026-11-06

### Added
- Notes: hide a value such as an IP address or a token with `/secret`. The value is stored encrypted on the server; the bullet only holds a reference and shows a lock with dots. A click reveals it for 20 seconds, with buttons to copy it and (with write access) to change it. Everyone who can see the note can reveal it; API keys and AI agents (MCP), search, the Markdown export and copying bullets only ever see it hidden, and a revealed value is never kept in the offline cache.
- Hidden values that no bullet uses any more are kept for 30 days (for undo and the trash) and then deleted; deleting a note for good deletes its values at once.
- New optional setting `SECRETS_KEY` for the key of hidden values; without it MindSift creates one in `data/secrets.key`. The install script sets it for new installations. Never change it once values are stored, or they can no longer be read.

## [0.85.0] - 2026-11-06

### Added
- Notes: code blocks have two arrows next to the language to indent and outdent them (Tab inside the code indents the code itself). An arrow is greyed out when the block cannot move that way.
- Notes: `/code` also works at the end of a line that already has text; the text becomes the code.

### Changed
- Notes: Enter at the end of an expanded bullet that has children adds the new bullet as its first child instead of below the whole branch, so you no longer have to indent it and take the other children along.

### Fixed
- Classic light theme: hovering the language picker of a code block no longer turns its text dark on the dark code block or shows a bright border.

## [0.84.0] - 2026-11-06

### Added
- Account settings → Voice input: choose the language you speak into the microphone. The app language is the default; you can pick any of Whisper's roughly 100 languages, also ones the app is not translated into, or "detect automatically" for people who switch between languages (with the Whisper server). The browser's speech recognition uses the chosen language too. The section now appears whenever voice input is available, not only when you can choose between Whisper and the browser.

### Removed
- **Attention:** the environment variable `STT_LANGUAGE` is gone; the language now comes from each person's settings (by default their app language). A value left in `.env` is ignored.

## [0.83.12] - 2026-11-06

### Fixed
- Voice input with your own Whisper server recognizes each person in their own app language (German, English, Spanish, French or Italian) instead of always German. `STT_LANGUAGE` still fixes one language for everyone if set (`auto` lets Whisper detect it); installations that have `STT_LANGUAGE=de` in their `.env` keep it. The install script no longer sets it from the server's locale. The admin's voice status shows "each person's app language" for this.

## [0.83.11] - 2026-11-06

### Changed
- `docker-compose.yml` and the install script use the image `:stable` (the latest tagged release, scanned before it is published) instead of `:latest` (every release from `main`). Existing installations keep their tag; to switch, change `:latest` to `:stable` in `docker-compose.yml` or run the install script again.
- The README explains which speech models work (any Whisper model in CTranslate2 format, also ones fine-tuned for one language) and links the list of them; it also mentions the Trivy scan of every tagged release at the top.

## [0.83.10] - 2026-11-06

### Added
- The install script asks two optional questions (both "no" by default): whether to set up your own speech recognition (Whisper, with the model of your choice), and whether MindSift runs behind a reverse proxy (public address and the proxy's Docker network). It writes these additions to `docker-compose.override.yml` and takes over the server's time zone.

### Fixed
- Running the install script again no longer replaces `.env` (and with it `JWT_SECRET`, which signed everyone out); it only updates `docker-compose.yml`. The new `.env` is readable only by its owner.

## [0.83.9] - 2026-11-06

### Added
- Every tagged release, and every build that changes the base image, the Go version or the Go modules, is scanned with Trivy before it is published; a known high or critical vulnerability with an available fix stops the release. The published `:stable` and `:latest` images are scanned every week.

## [0.83.8] - 2026-11-06

### Changed
- The image is based on Alpine 3.24 instead of 3.21, whose support is ending. The README's security scan is updated (Trivy 0.76.0, no findings beyond the one unused `openpgp` entry).

## [0.83.7] - 2026-11-06

### Fixed
- Security: the server is now built with Go 1.27.3 and current versions of `golang.org/x/crypto`, `golang-jwt/jwt`, `go-chi/chi` and `golang.org/x/sys`. This closes all 84 known vulnerabilities Trivy reported in the v0.83.6 image (1 critical, 38 high), most of them in Go's HTTP, HTTP/2 and TLS code. The image build now takes the module versions from `go.mod`/`go.sum` instead of fixed older ones.

### Added
- The README shows the latest Trivy scan of the image and how to run it yourself.

## [0.83.6] - 2026-11-06

### Fixed
- Opening a note without a connection no longer replaces it with "No connection to the server" after a moment: the copy stored on the device stays open and editable, and the changes are sent once the connection is back. A note never opened on this device says that it is not available offline yet.
- Changes made offline in a note that was then left are sent as soon as the connection is back (and at app start), not only the next time that note is opened.
- Signing out deletes the notes stored in the browser, so the next person on the device does not find them. If changes have not been sent yet, MindSift asks first. Notes stored for another account are never shown or sent.

### Changed
- The offline notice at the bottom also counts notes with unsent text; tap it to see where unsent changes are kept and when they would be lost. The help explains offline work in notes.
- While changes wait offline, MindSift asks the browser to keep its storage even when disk space runs low.

## [0.83.5] - 2026-11-05

### Fixed
- Closing a note that was deleted while it was open no longer answers "not found" (404); the server just forgets that note's sessions.

## [0.83.4] - 2026-11-05

### Changed
- Search is about four times faster on the server: it no longer loads every matching note in full. **Attention** (API): `documents` in `/search` now holds only `id`, `title` and `icon`; bullet matches carry their text in `content`, and `before`/`after` come only with `context=1`.
- The search waits for a short pause in typing and cancels a search that a newer one has replaced, so the server stops working on it.

### Fixed
- Ticking or editing a list item that someone else had just deleted answered with the raw database error (400) instead of "List item not found" (404).

## [0.83.3] - 2026-11-05

### Fixed
- Notes with many people typing at once: opening the note no longer waits until all pending changes are written, and checking for new changes no longer queues behind every write of the whole server (both read a consistent state of the database without its write lock).
- The server drops sync requests the client has already given up (timeout, page closed) instead of working them off long after; unsent changes are resent by the client and applied once.
- A note deleted while someone was editing it answered the next sync with a server error (500) instead of "not found" (404).

## [0.83.2] - 2026-11-05

### Fixed
- Server: under load (many searches, list or folder share views and task list loads at once) the database connection pool could deadlock, after which every request, including sign-in, waited forever and only a restart helped. The affected queries (search, list shares, shared folders, task lists) no longer need a second connection while holding one, and the tests now run with a single connection so such code fails in the build.

## [0.83.1] - 2026-11-05

### Changed
- Notes: the guide lines are always shown; the switch in the note menu is gone.
- Notes: to-dos show their bullet dot again all the time (the guide lines start there).
- Sidebar: the folder guide lines run from the left edge of the folder icon, with a short tick at each entry; the line ends at the last entry.

### Fixed
- Sidebar: names of folders and notes on the same level now line up exactly (note icons take the width of the folder icon).
- Notes: marking text with the mouse in a bullet without the cursor kept only the cursor; the marking now stays.

## [0.83.0] - 2026-11-05

### Added
- Notes: subtle guide lines run from a bullet down along its children, like in code editors. They can be switched off in the note menu ("Guide lines for sub-bullets"); the choice applies to all notes in this browser.
- Sidebar: subtle guide lines show which folder deeper folders and notes belong to.
- Note menu: "Collapse all bullets" (Ctrl+Shift+↑) next to "Expand all bullets" (Ctrl+Shift+↓). In focus mode both work only within the zoomed branch.

### Changed
- Notes: Tab in the title moves the cursor into the first bullet, like Enter.
- After inserting a link the cursor stands right behind it; closing the link dialog without a link puts the cursor back where it was.

### Fixed
- Ctrl+L without selected text replaced the whole text of the bullet with the link; the link now goes in at the cursor.
- Password managers no longer offer to fill in search and filter fields (link dialog, search, people search and others).
- The "New folder" window and similar small windows had extra space at the top on larger screens.
- Note menu entries with a shortcut no longer wrap onto two lines.

## [0.82.0] - 2026-11-05

### Added
- Notes: Ctrl+Shift+↓ expands all collapsed bullets of the note.

### Changed
- Notes: **Attention** the link dialog in a bullet now opens with Ctrl+L (Cmd+L) instead of Ctrl+K; Ctrl+K opens the search everywhere, also while typing in a note.
- Note menu: "Expand all bullets" is always listed (greyed out while nothing is collapsed) and shows its shortcut.

### Fixed
- Dragging a bullet onto the "new note" button no longer flickers when the pointer passes over the icon.

## [0.81.0] - 2026-11-05

### Added
- Notes: drag a bullet by its dot onto the "new note" button at the top of the sidebar to turn it, with all its children, into a note of its own. A hint offers "Open" and "Undo"; Ctrl+Z works as well.
- Link dialog (`/link`): the arrow keys move through the notes and matching bullets, Enter inserts the marked link. ArrowRight opens the bullets of the marked note, ArrowLeft in the empty filter goes back.
- Note menu: "Expand all bullets" opens every collapsed bullet in one step (one Ctrl+Z folds them again).

### Changed
- Search (Ctrl+K): a note opened from the results gets the cursor in its first bullet, so you can type or move on with the arrow keys right away. A bullet found by the search gets the cursor at its end instead of having its whole text selected, so typing no longer replaces it.

### Fixed
- Search: opening a note again after picking another one in the sidebar did nothing; a bullet found while the notes were already open was not jumped to.

## [0.80.3] - 2026-11-05

### Changed
- Notes: the dragged branch now follows the pointer as soft, rounded stripes (one per row, indented like the note) instead of a card; they build up when you pick the bullet up, trail the pointer smoothly and fade out when you let go.

## [0.80.2] - 2026-11-05

### Changed
- Notes: dragging a bullet by its dot now shows the whole branch under the pointer (its first rows, indented, with a shadow) instead of only the small dot, so it is clear what you are moving.

## [0.80.1] - 2026-11-05

### Changed
- Help: describes moving a bullet into another note by dragging it onto the sidebar, and the new choice when turning a bullet into its own note.

## [0.80.0] - 2026-11-05

### Added
- Notes remember where you were: after switching to another tab or looking into another note, a note opens again at the same scroll position and, if you had zoomed into a bullet, still zoomed in. Kept in this browser only, for the last 20 notes; a link to a bullet still opens at that bullet.
- Notes: drag a bullet by its dot onto another note in the sidebar to move it there with all its children (to the end of that note). A hint offers "Open" and "Undo"; Ctrl+Z works as well. Tasks linked to checkboxes in the branch move along.
- Notes: "Turn into its own note" asks where to: a new note (preselected, so click and Enter work as before) or, by typing its name, an existing note. Moving into an existing note leaves a link to the moved bullet behind.
- Code blocks: Enter keeps the indentation of the line and goes one step deeper after a line ending in `:` (YAML, Python) or an opening bracket; between a pair of brackets the closing one moves to its own line. Tab and Shift+Tab use the indentation of the code (2 or 4 spaces, tabs), never tabs in YAML.

### Changed
- Notes: the buttons on the right of a bullet no longer include "Zoom into this branch" (click the bullet's dot instead). To-dos lose their "⋯" menu: "Turn into an enhanced task" (or "Remove link" for a linked one) and "Turn into plain text" are buttons of their own, like for the other block types.
- Notes: the dot in front of a to-do only shows when the pointer is near the row (like on empty rows), since the checkbox already marks it; a collapsed to-do keeps it.

### Fixed
- Code blocks: a key pressed right after Tab could land at the end of the block instead of at the caret.
- Notes: a bullet that only holds a link to a single bullet of another note no longer offers "Bring back", which would have taken that whole note.
