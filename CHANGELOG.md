# Changelog

All notable changes to MindSift are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and from v0.6.0 on the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the major version is 0, the API and data formats can change with any minor version; such changes are listed under "Changed" or "Removed" and marked **Attention**.

## [Unreleased]

### Changed
- Task dialog: the status is one dropdown instead of a button per column, so boards with many columns stay tidy; the dropdown and its options show each column's colour. The repetition and the task list are picked from the same kind of dropdown instead of the browser's own.
- All dropdowns in the app (task rows, sorting, search filters, code block language, journal, sharing, settings, administration, groups, setup) use the app's own dropdown instead of the browser's: same look in every theme, colour dots and list emojis in the options, typing jumps to an option, long lists such as the code languages get a search field.
- Dates and times on computers: a calendar of our own instead of the browser's (the week starts as your language has it, today framed, month and year to pick, fully usable with the keyboard), and a list of times in 15-minute steps. Both can be typed as well, e.g. "24.11.", "24112026", "1430" or "2:30 pm". On phones and tablets the system's own date and time pickers stay, they work best with fingers.

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

## [0.79.1] - 2026-11-05

### Changed
- Focus mode: the "Focus mode" badge and "Isolated branch • zoom active" above the branch title are gone; the breadcrumbs and "Exit focus" already show where you are.
- Fjord theme: code blocks stand out more clearly from the page, and comments, strings, numbers and types in them are easier to read.

### Fixed
- Notes: "Start focus mode" in the note menu was shown in German in every language.
- Notes: deleting a bullet with its children is one step again, so a single Ctrl+Z (or the undo button) brings the whole branch back instead of one child per press.
- Notes: Ctrl+Z and Ctrl+Y also work when the cursor is not in a bullet, e.g. right after clicking a bullet's delete button, the undo button or empty space.
- Notes: opening the sharing dialog of a folder without adding anyone no longer marks the folder, and the notes in it, as shared.

## [0.79.0] - 2026-11-04

### Added
- Notes: `/warn` turns a bullet into a warning (yellow box with a warning triangle), `/fail` into an error (red box with an X). The text stays normal text with bold, links and hashtags; the button on the right turns it back into plain text.
- Copying as Markdown and the Markdown export write them as Obsidian callouts (`[!warning]`, `[!failure]`); importing an Obsidian vault turns warning, caution, failure, danger and similar callouts back into warnings and errors.
- MCP: `add_note_bullet` and `update_note_bullet` accept the types `warning` and `error`.

## [0.78.2] - 2026-11-04

### Changed
- Default theme: code blocks are a little lighter in MindSift Dark and MindSift Light.

### Fixed
- Demo: "Delete data" in the profile is switched off, so visitors can no longer empty the shared demo accounts.

## [0.78.1] - 2026-11-04

### Changed
- The screenshots in the README show the new default theme.

## [0.78.0] - 2026-11-04

### Changed
- The default theme "Classic" (MindSift Dark and MindSift Light) now uses the colours and rounded corners of mindsift.app. If you use it, the app changes its look with this update; under Appearance → Corners you can switch back to square corners.
- MindSift Light shows code blocks dark, like the website.
- The demo starts in the default theme again instead of Fjord Night.

## [0.77.3] - 2026-11-04

### Changed
- Administration → users: username, password, lock/unlock and delete are compact icon buttons with a tooltip, so every row lines up. On your own account, lock and delete stay visible but greyed out.

### Fixed
- Administration → users: long names, usernames and email addresses are cut off with "…" (full text on hover) instead of wrapping to a second line.

## [0.77.2] - 2026-11-04

### Fixed
- Task dialog: the mouse wheel scrolls the dialog (e.g. long notes) instead of the board behind it, and the page behind an open dialog stays where it is.

## [0.77.1] - 2026-11-04

### Fixed
- Notes: a selection started in the empty space below the last bullet and dragged upwards spans the bullets again, so Ctrl+C copies Markdown and Backspace deletes it; before, only the browser's own selection appeared and Backspace did nothing.

## [0.77.0] - 2026-11-04

### Added
- Usernames for signing in, independent of the display name. Everybody sees and changes theirs in the profile (lower case letters, digits, dot, dash and underscore, 2 to 32 characters, unique); admins can change it in the user management, which also shows it next to the email address.
- New accounts get their username from the display name ("Sandro Dach" becomes `sandro.dach`, with a number appended when it is taken).

### Changed
- **Attention:** signing in works with the email address or the username, no longer with the display name, which two people may share. On the update every existing account gets its current display name as username (spaces and other characters become dots, duplicates get a number), so the usual login keeps working, and a name typed like the display name ("Sandro Dach") is read as the username. Renaming yourself no longer locks you out. The part of the email before the @ still works as before.

## [0.76.9] - 2026-11-04

### Changed
- Task dialog: back (browser, mouse button, Android) closes the dialog first instead of leaving the page; with unsaved changes it asks first.
- Task dialog: the fields for a new sub-task and a hashtag have the same height as the other fields.

### Fixed
- Notes: Ctrl+Z after deleting a selection whose last bullet had sub-bullets was refused with "changed by someone else", although nobody else had touched it.
- Phones: with the keyboard open, a note can scroll far enough that the bullet being typed in stays above the keyboard and the bar on it, also for a new last bullet.
- Kanban: smoother scrolling. The first row no longer makes the page lay out anew on every scroll step once the bar above the board is gone, and the browser's scroll anchoring no longer works against it (noticeable as judder in installed apps).

## [0.76.8] - 2026-11-04

### Changed
- No more browser dialogs. Questions before actions that cannot be undone open as the app's own small confirmation right at the click: deleting a task list, a shopping list, a group, a backup or a user, rejecting a waiting account, resetting the board columns, emptying the task trash, revoking an API key or connection, and signing out all sessions.
- Actions that can be undone run without a question: deleting a bullet together with its sub-bullets (Ctrl+Z brings it back), removing a group member or leaving a group, and removing a share.
- Error messages (e.g. "Saving failed") show as a red notice at the bottom with a short shake instead of a browser alert.

## [0.76.7] - 2026-11-04

### Changed
- Task dialog: the trash button deletes right away, like on the card, instead of asking in a browser dialog; the notice at the bottom offers to undo it and the task waits in the trash.

### Fixed
- Behind proxies that refuse or hold the live connection (SSE), tasks and shopping lists now switch to long polling and update live. Before, changes from other devices only showed up after switching tabs or reloading.

## [0.76.6] - 2026-11-04

### Added
- README: a short section on how MindSift is tested before every release (frontend, backend and browser tests).

## [0.76.5] - 2026-11-04

### Changed
- "New version available" shows up sooner: the app looks for a new version every 5 minutes instead of every 15 and also as soon as the browser is online again. Behind proxies a server restart can go unnoticed by the live connection, so a tab that stayed in front waited up to 15 minutes before.

### Fixed
- Task dialog: the selected priority "Low" is clearly visible now, with a light tint and frame in the text colour of the theme.

## [0.76.4] - 2026-11-04

### Changed
- Phones: the action buttons above a bullet show for three seconds after tapping into it and then hide again, instead of covering the text the whole time; another tap brings them back.
- The old planning documents are no longer part of the repository.

### Fixed
- Tasks: a new task from "Add task" was deleted when the dialog was closed with "Done" and the unsaved-changes question answered with "Save".
- Phones: scrolling a note to its end no longer passes on to the page, which made the browser bar and the bottom tab bar jump and flicker.
- Shared notes: the lock badge is no taller than a line of text, so rows no longer grow and shift when someone starts or stops editing.

## [0.76.3] - 2026-11-04

### Fixed
- Notes: selecting with the mouse from the bottom up copies Markdown too. A callout at the end of the selection is taken whole instead of being left out, and dragging past the first or last bullet (e.g. onto the title) selects up to its start or end.
- Notes: a selection started on the action buttons at the right of a bullet now spans several bullets; before, the browser selected the rendered text, and Ctrl+C gave plain text with every line twice.
- Notes: whatever the browser itself selects over several bullets is copied as Markdown as well, and a click outside the note ends a selection.

## [0.76.2] - 2026-11-04

### Fixed
- Notes: callouts, code blocks and other blocks without plain text are shown as selected when a selection spans several bullets (e.g. Ctrl+A twice); before, the selection seemed to stop at them.
- Notes: dragging a new selection right after Ctrl+A twice no longer drags the selected text of the first bullet, so Ctrl+C copies the bullets as Markdown again instead of a single bullet's plain text.

## [0.76.1] - 2026-11-04

### Fixed
- API documentation: `PATCH /auth/settings` accepts all five language codes (`de`, `en`, `es`, `fr`, `it`) for `language`, not only `de` and `en`.

## [0.76.0] - 2026-11-04

### Added
- Every person has a fixed color, the same everywhere and on every device: initials, the profile pictures in stacks (tabs, tasks, list items, people in a note) and the lock marker in shared notes. Real profile pictures get a ring in that color in the stacks.
- Shared notes: a bullet someone else is editing is tinted in that person's color with a stripe on the left, and the badge shows their profile picture and name, so a locked bullet stands out at a glance.

### Fixed
- The "version by …" hint on conflict copies and the fallback name of a lock holder were still German in other languages.

## [0.75.2] - 2026-11-04

### Fixed
- Header: the app name and the version (or the demo countdown) are left-aligned next to the logo again; on phones they were centered when the countdown was wider than the name.
- Shared notes: a bullet someone else is editing no longer shows the action buttons, which covered the lock badge and could not be used anyway.

## [0.75.1] - 2026-11-04

### Added
- About MindSift: the version number links to the changelog on GitHub.

### Changed
- The whole changelog is in English now, older versions included.
- `.env.example`, `docker-compose.yml` and the install script are in English, and so are the server's log messages.

### Fixed
- `docker-compose.yml` now passes `DEFAULT_LANGUAGE`, `REGISTRATION_MODE`, `REGISTRATION_DOMAINS` and `REGISTRATION_VERIFY_EMAIL` from `.env` to the container; set there, they had no effect before.
- The message after approving a waiting account and the fallback names in the share dialogs were still German in other languages.

## [0.75.0] - 2026-11-04

### Added
- MindSift speaks Spanish, French and Italian: the interface, the help, mails, push notifications, alarms, the daily summary and server messages, with dates written the way each language does.
- The setup wizard asks for the default language; it becomes the server's default and the first admin's language.
- The app description, the link preview and the app shortcuts (`manifest.json`) come in the browser's language.

### Changed
- The demo starts in English: both demo accounts and the sample data are English (`DEFAULT_LANGUAGE` changes it).
- Sample data and the help notes of new accounts come in English for every account that is not German.
- Server texts a language does not have yet show in English instead of German.
- The screenshots in the README show the English demo.

### Fixed
- Hashtags work with the letters of every language (`#café`, `#niño`), not only German umlauts.
- A few tooltips and messages were still German in other languages (sharing dialogs, recurring tasks, someone editing a bullet, task tabs, device names).

## [0.74.4] - 2026-11-03

### Changed
- The README is now in English, shorter, and points to the live demo and the website for the full tour.

## [0.74.3] - 2026-11-03

### Changed
- Emails, push notifications, Discord and webhook alarms, the daily summary and notifications about shared items and watched tasks come in the recipient's language, with dates and times written the way that language does. Invitations go out in the language of the one inviting.
- In English, new journal days, the columns of new task lists, untitled notes and the folders of the Markdown export (`Tasks/`, `Lists/`) are English too. The import reads exports in every language.
- API: the origin of an entry no longer names a deleted API key "Gelöschter Schlüssel"; it sets `createdKeyDeleted`/`changedKeyDeleted` instead, and the app shows the hint in its language.

## [0.74.2] - 2026-11-03

### Changed
- Server error messages follow the app's language: in English, the app shows them in English, and so do other clients that ask for English (`Accept-Language`). Messages to AI agents over MCP are always English.

## [0.74.1] - 2026-11-03

### Changed
- The developer documentation in `Doku/` is now in English.

### Fixed
- Settings → API → AI agents listed only part of the MCP tools; the tools for notes and the inbox are shown too.
- The help no longer says that API keys cannot reach notes (possible over MCP since 0.72.0).

## [0.74.0] - 2026-11-03

### Added
- MindSift speaks English: choose it under Account settings → Language, or let the app follow an English browser. Admins can make English the server's default language. The help is available in English too. English loads only when used, so the app stays as light as before for German.
- New accounts start in the browser's language when MindSift speaks it.
- Still German for now (they follow in the next releases): emails, push notifications, the daily summary, journal titles, the default columns of new task lists, server error messages and the demo content.

## [0.73.6] - 2026-11-03

### Changed
- The help now comes from one content file per language, and the remaining interface texts come from language files; a lint rule keeps new fixed texts out of the interface (no visible change).

## [0.73.5] - 2026-11-03

### Changed
- Texts of the workspace (notes editor, folders, journal, hashtags, links, trash) now come from language files (no visible change).

## [0.73.4] - 2026-11-03

### Changed
- Texts of shopping lists, groups, search, sharing, theme names, date labels and shared messages now come from language files (no visible change).

## [0.73.3] - 2026-11-03

### Changed
- Texts of triage, quick capture and tasks (list, Kanban, task details, columns) now come from language files (no visible change).

## [0.73.2] - 2026-11-03

### Changed
- Texts of account settings, administration, API keys and the OAuth consent page now come from language files (no visible change).

## [0.73.1] - 2026-11-03

### Changed
- Texts of the header, navigation, profile menus, app install offer, sign-in, registration and first-time setup now come from language files, the groundwork for more languages (no visible change).

## [0.73.0] - 2026-11-03

### Added
- Language setting: under Kontoeinstellungen → Sprache everyone picks the language of the app, or follows the browser. For now German is the only language; more follow. Existing accounts stay on German.
- Admins set the server's default language under Administration → Server & Isolation. It applies to new accounts and everyone whose browser language MindSift does not speak, including the login screen. `DEFAULT_LANGUAGE` gives the start value.

### Changed
- Dates and times follow the chosen language instead of being fixed to German (no visible change yet).

## [0.72.0] - 2026-11-03

### Added
- MCP: AI agents can change existing notes with the new right "change notes" (`notes:write`): rename or move a note, add, change, tick and remove single bullets, and move own notes to the trash. Changes reach open editors live; a bullet someone is editing right now is left alone. `get_note` lists the bullets with their ids.
- MCP: the inbox gets the rights "Inbox lesen" (`inbox:read`, tool `list_inbox`) and "Inbox sortieren" (`inbox:write`): agents turn inbox entries into tasks, notes or list items, or discard them into the triage trash.

### Changed
- API keys: every area (tasks, lists, notes, inbox) offers the same three levels read, create and change; switching "change" on also switches "read" on. List items cannot be deleted over MCP (only ticked), as they have no trash.

## [0.71.1] - 2026-11-03

### Changed
- Notes: bullets copied with Ctrl+C read like a Markdown document: plain bullets on the top level become paragraphs, headings stay headings, and only the indented bullets form a list (bullet or numbered list, to-dos as `- [ ]`). Pasted back into a note they give the same structure.

## [0.71.0] - 2026-11-03

### Added
- Task dialog: closing it with an unsaved title or notes ("Fertig", the X or Escape) asks first: keep editing, discard or save. "Fertig" is shown in the accent colour.
- Task lists: the open list's tab shows a trash icon; deleting asks in a small confirmation at the mouse instead of the browser dialog. The icon grows in and out when switching lists, with less room next to the counter.

### Changed
- Workspace: the wheel over the background no longer pushes the tab row (notes, to-dos, hashtags) out of view.

### Fixed
- Kanban: with one row (and after the last row) the board snaps in one wheel step; a second step no longer moves the columns by a few pixels.
- Notes: after Ctrl+Z or Ctrl+Y the cursor stays at the changed part of the bullet instead of jumping to its end.
- Notes: Ctrl+C with bullets selected no longer jumps into the Quick Dump bar (and copies again); a selection that starts or ends in a code block copies the whole block.

## [0.70.1] - 2026-11-03

### Fixed
- A pinned note stays pinned when it goes to the trash and comes back (restore or "Undo").
- Dragging a shopping list entry into another category keeps the category's spelling ("Fruit & veg" instead of "fruit & veg").
- Phones: the plus of "Add a new item" in the shopping list menu is visible again.

## [0.70.0] - 2026-11-03

### Changed
- **Attention:** MindSift is now developed in the public repository [github.com/mindsift-app/mindsift](https://github.com/mindsift-app/mindsift). Images come from GitHub's container registry: `ghcr.io/mindsift-app/mindsift` (`:latest`, `:dev`, version tags). Existing installations change the `image:` line in their compose file accordingly.
- `docker-compose.yml`, `compose.yaml` and the install script use `:latest` (the tested state of `main`) instead of `:dev`; the install script loads its files from GitHub.
- A public demo runs at [demo.mindsift.app](https://demo.mindsift.app).
- Versions up to 0.69.38 were developed before the move; their history is summarised in this file, there are no compare links for them.

## [0.69.38] - 2026-11-03

### Changed
- Internal frontend restructuring completed: the large views are now split into components, hooks and tested modules. Nothing changes for users.

## [0.69.37] - 2026-11-03

### Changed
- Internal frontend restructuring: the phone menu of the shopping lists is a module of its own. Nothing changes for users.

## [0.69.36] - 2026-11-03

### Changed
- Internal frontend restructuring: the list tabs and the phone header of the shopping lists are components of their own. Nothing changes for users.

## [0.69.35] - 2026-11-03

### Changed
- Internal frontend restructuring: the open and done entries of a shopping list are components of their own. Nothing changes for users.

## [0.69.34] - 2026-11-03

### Changed
- Internal frontend restructuring: realtime updates of the shopping lists are a tested module of their own. Nothing changes for users.

## [0.69.33] - 2026-11-03

### Changed
- Internal frontend restructuring: the hashtag suggestions of the shopping lists are tested functions of their own. Nothing changes for users.

## [0.69.32] - 2026-11-03

### Changed
- Internal frontend restructuring: dragging shopping list entries is a module of its own. Nothing changes for users.

## [0.69.31] - 2026-11-03

### Changed
- Internal frontend restructuring: reading and grouping shopping list entries is a tested module of its own. Nothing changes for users.

## [0.69.30] - 2026-11-03

### Changed
- Internal frontend restructuring: the sections of the administration are components of their own. Nothing changes for users.

## [0.69.29] - 2026-11-03

### Changed
- Internal frontend restructuring: the retention, voice input and export sections of the account settings are components of their own. Nothing changes for users.

## [0.69.28] - 2026-11-03

### Changed
- Internal frontend restructuring: the profile and security settings with the danger zone are a component of their own. Nothing changes for users.

## [0.69.27] - 2026-11-03

### Changed
- Internal frontend restructuring: the appearance and theme settings are a component of their own. Nothing changes for users.

## [0.69.26] - 2026-11-03

### Changed
- Internal frontend restructuring: the alarm settings in the account settings are a component of their own. Nothing changes for users.

## [0.69.25] - 2026-11-03

### Changed
- Internal frontend restructuring: sign-in, counters, the realtime connection and the demo reset are a building block of their own. This completes the split of App.tsx. Nothing changes for users.

## [0.69.24] - 2026-11-03

### Changed
- Internal frontend restructuring: the header bar (phone and desktop) and the page tabs are components of their own. Nothing changes for users.

## [0.69.23] - 2026-11-03

### Changed
- Internal frontend restructuring: the quick dump sheet on the phone, voice input included, is a building block of its own. Nothing changes for users.

## [0.69.22] - 2026-11-03

### Changed
- Internal frontend restructuring: the profile menu (desktop and phone) is a component of its own. Nothing changes for users.

## [0.69.21] - 2026-11-03

### Changed
- Internal frontend restructuring: the offer to install MindSift as an app is a building block of its own. Nothing changes for users.

## [0.69.20] - 2026-11-03

### Changed
- Internal frontend restructuring: the navigation bar on the phone and the shortcuts of the global search are building blocks of their own. Nothing changes for users.

## [0.69.19] - 2026-11-03

### Changed
- Internal frontend restructuring: the page list, a view's error display and remembering the scroll position per page are building blocks of their own. Nothing changes for users.

## [0.69.18] - 2026-11-03

### Changed
- Internal frontend restructuring: the workspace's phone menu is a building block of its own. This completes the split of the workspace. Nothing changes for users.

## [0.69.17] - 2026-11-03

### Changed
- Internal frontend restructuring: which to-dos and hashtags the workspace shows is now computed by functions of their own, with tests. Nothing changes for users.

## [0.69.16] - 2026-11-03

### Changed
- Internal frontend restructuring: loading the notes, folders and hashtags in the workspace, realtime updates included, is a building block of its own. Nothing changes for users.

## [0.69.15] - 2026-11-03

### Changed
- Internal frontend restructuring: the folder tree, the journal entry, the hashtags and the trash of the sidebar are components of their own. Nothing changes for users.

## [0.69.14] - 2026-11-03

### Changed
- Internal frontend restructuring: the share dialog for notes and folders in the workspace is a component of its own. Nothing changes for users.

## [0.69.13] - 2026-11-03

### Changed
- Internal frontend restructuring: the frame of focus mode (the bar that slides in, the edge that opens the sidebar) is a component of its own. Nothing changes for users.

## [0.69.12] - 2026-11-03

### Changed
- Internal frontend restructuring: the notice at the bottom of the workspace (e.g. with "Undo") is a component of its own. Nothing changes for users.

## [0.69.11] - 2026-11-03

### Changed
- Internal frontend restructuring: pushing the tab bar out of the way in the workspace is a building block of its own. Nothing changes for users.

## [0.69.10] - 2026-11-03

### Changed
- Internal frontend restructuring: the dialogs of the folder bar (new folder, new note on the phone, delete folder) are a component of their own. Nothing changes for users.

## [0.69.9] - 2026-11-03

### Changed
- Internal frontend restructuring: the journal (days, calendar, jumping to a day) has a building block of its own for its state. Nothing changes for users.

## [0.69.8] - 2026-11-03

### Changed
- Internal frontend restructuring: the state of focus mode (pinned bars, shortcuts) is a building block of its own. Nothing changes for users.

## [0.69.7] - 2026-11-03

### Changed
- Internal frontend restructuring: dragging and selecting notes in the sidebar is a building block of its own. Nothing changes for users.

## [0.69.6] - 2026-11-03

### Changed
- Internal frontend restructuring: the bar above the workspace (views, live and save status) is a component of its own. Nothing changes for users.

## [0.69.5] - 2026-11-03

### Changed
- Internal frontend restructuring: the hashtag page in the workspace is a component of its own. Nothing changes for users.

## [0.69.4] - 2026-11-03

### Changed
- Internal frontend restructuring: the hashtag overview in the workspace is a component of its own. Nothing changes for users.

## [0.69.3] - 2026-11-03

### Changed
- Internal frontend restructuring: the to-do collection in the workspace is a component of its own. Nothing changes for users.

## [0.69.2] - 2026-11-03

### Changed
- Internal frontend restructuring: the folder tree of the notes lives in a file of its own (start of splitting the workspace). Nothing changes for users.

## [0.69.1] - 2026-11-03

### Fixed
- Notes (desktop): since v0.67.0 the bottom edge of the sidebar and the note started below the window edge, so the trash, for example, only showed after the top bar had been pushed away. Sidebar and note now always end at the bottom of the window and grow while the bar slides out.

## [0.69.0] - 2026-11-03

### Added
- Tasks: subtasks can be reordered with the handle on the left, by mouse, finger or arrow keys.
- Kanban: "Add task" at the bottom of a column opens the task window right away, with column and list filled in and the title selected for typing over. If the window is closed without a title, the empty task disappears again (from the trash too).

## [0.68.18] - 2026-11-03

### Changed
- Internal frontend restructuring: the task filter display on the phone is a component of its own; this completes the split of the task view. Nothing changes for users.

## [0.68.17] - 2026-11-03

### Changed
- Internal frontend restructuring: the share dialog for task lists is a component of its own. Nothing changes for users.

## [0.68.16] - 2026-11-03

### Changed
- Internal frontend restructuring: quick add and the "New task list" dialog are components of their own. Nothing changes for users.

## [0.68.15] - 2026-11-03

### Changed
- Internal frontend restructuring: the actions on tasks (tick off, change, delete, trash) live in a building block of their own. Nothing changes for users.

## [0.68.14] - 2026-11-03

### Changed
- Internal frontend restructuring: undo (Ctrl+Z) for tasks lives in a building block of its own. Nothing changes for users.

## [0.68.13] - 2026-11-03

### Changed
- Internal frontend restructuring: the live updates of the tasks live in a building block of their own, with tests. Nothing changes for users.

## [0.68.12] - 2026-11-03

### Changed
- Internal frontend restructuring: filtering, sorting and grouping the task list are functions of their own, with tests. Nothing changes for users.

## [0.68.11] - 2026-11-03

### Changed
- Internal frontend restructuring: the list view of the tasks is a component of its own. Nothing changes for users.

## [0.68.10] - 2026-11-03

### Changed
- Internal frontend restructuring: the list tabs of the tasks on the desktop are a component of their own. Nothing changes for users.

## [0.68.9] - 2026-11-03

### Changed
- Internal frontend restructuring: the task filter window on the phone is a component of its own. Nothing changes for users.

## [0.68.8] - 2026-11-03

### Changed
- Internal frontend restructuring: the phone menu of the tasks is put together in a file of its own. Nothing changes for users.

## [0.68.7] - 2026-11-03

### Changed
- Internal frontend restructuring: the row of a task in the list view is a component of its own. Nothing changes for users.

## [0.68.6] - 2026-11-03

### Changed
- Internal frontend restructuring: the Kanban board is a component of its own. Nothing changes for users.

## [0.68.5] - 2026-11-03

### Changed
- Internal frontend restructuring: dragging tasks (mouse and finger, Kanban, list, list tabs) lives in a building block of its own. Nothing changes for users.

## [0.68.4] - 2026-11-03

### Changed
- Internal frontend restructuring: the hashtag bar of the tasks is a component of its own. Nothing changes for users.

## [0.68.3] - 2026-11-03

### Changed
- Internal frontend restructuring into smaller modules (plan in `Doku/plans/frontend-aufteilen.md`): API client, Kanban columns and layout, the task trash and the capture sheet on the phone. Nothing changes for users.

## [0.68.2] - 2026-11-03

### Changed
- Documentation tidied up: fixed flaws and the old `TODO.md` removed (open tasks live in the task list), plan for splitting the large frontend files added. Nothing changes in the app itself.

## [0.68.1] - 2026-11-03

### Security
- Each account now has at most 20 realtime connections open at a time (WebSocket, SSE and long polling together). When another one comes in, the oldest is closed. So a single account cannot load the server with any number of open connections; in normal use with several devices and tabs you won't notice.

## [0.68.0] - 2026-11-03

### Security
- The user directory and the list of collaborators only reveal name, username, email, avatar and organization of other people. Private details such as Discord/webhook addresses, alarm email and role stay hidden now.
- Anyone a note, list or shared folder was shared with could fetch its share list even without access. That is blocked now (only with access to the object).

### Fixed
- Deleting or changing an object you have no access to now cleanly reports "not found" instead of an internal server error.

## [0.67.0] - 2026-11-03

### Added
- Notes (desktop): scrolling in the background (over the bar with notes, to-dos and hashtags or at the margin next to the note) pushes that bar out at the top and snaps, so the note uses the whole area – as with Kanban. Scrolling up there brings it back. In the note and in the folder bar the mouse wheel scrolls only their content, as before.
- Focus mode: the folder bar on the left and the bar at the top have a pin. Pinned, they stay put instead of sliding away again; the setting is kept.

### Changed
- Focus mode: the top bar only casts a light shadow now.
- Notes: the confirmation when deleting a folder is shorter.
- Kanban in "All tasks": for columns that only exist in some task lists, "Add task" is now shown greyed out instead of simply missing. A hint on hover names the lists where tasks can be added there.

## [0.66.0] - 2026-11-02

### Added
- Notes: Ctrl+C across several selected bullets copies them as Markdown (indentation, to-dos, headings, quotes, code). Pasted into other programs it is a clean list; pasted into a note it becomes the same bullets again.
- Notes: a second Ctrl+A in a bullet selects the whole note, e.g. to copy it completely as Markdown with Ctrl+C.

### Fixed
- Notes: copying across several bullets also works on installations without HTTPS.

## [0.65.0] - 2026-11-02

### Changed
- Kanban on the desktop: even with only one row of columns, the first mouse wheel step pushes the bar above (new task, hashtags, lists) away, and the columns grow to screen height. Scrolling back brings the bar back.

## [0.64.1] - 2026-11-02

### Fixed
- Back button: switching the task list and the shopping list is now a step of its own too; back leads to the list that was open before.

## [0.64.0] - 2026-11-02

### Added
- The back button (mouse, browser, Android) goes back within MindSift instead of leaving the app: out of a zoomed-in bullet, to the note open before, to the view open before in the workspace, on the phone from the note to the note list and to the previous page. Forward goes forward again accordingly.

## [0.63.2] - 2026-11-02

### Fixed
- Kanban: after "Stretch board to full width" the columns were only about half as tall as the space until the window was resized. Now they have the full height right away.

## [0.63.1] - 2026-11-02

### Fixed
- Notes on the desktop: the button bar at a bullet (focus, extract, delete …) only shows while the mouse moves over the bullet and disappears about a second later. A resting mouse, also while typing, no longer leaves it standing over the text. It stays visible on the bar itself.

## [0.63.0] - 2026-11-02

### Added
- Kanban on the phone: each column fills the screen between header and bottom navigation, one swipe moves exactly one column on and snaps. While dragging a card the page jumps to the previous or next column at the top or bottom edge, so cards can be dropped into any column.
- Desktop: triage, workspace, tasks and lists keep their scroll position when switching between pages.

### Changed
- Kanban on the desktop with several rows: the first scroll only hides the bar above the board, and the first row grows with it until it fills the whole screen.

## [0.62.0] - 2026-11-02

### Changed
- Kanban on the desktop: all columns in a row are equally tall, as tall as the visible area below the bar (at least room for about three cards). If a column wraps into a second row, the first row no longer gets taller.
- Kanban with several rows: one mouse wheel step jumps to the next or previous row. Columns with many cards scroll within themselves first; Ctrl + mouse wheel over the board scrolls freely.

## [0.61.0] - 2026-11-02

### Added
- Notes: a deleted folder goes to the trash as one entry ("Folder · 3 notes") and can be restored with all subfolders, empty ones too, and notes. Deleting for good, emptying the trash and the retention period apply to the folder with its content. Folders in shared folders behave as before.
- Notes: deleting a folder asks a short confirmation right where you clicked (Enter confirms, Escape cancels).

### Fixed
- Notes: empty subfolders of a deleted folder were lost for good.

## [0.60.0] - 2026-11-02

### Changed
- Desktop: the window no longer scrolls as a whole. Header and footer stay put, only the area in between scrolls; the scrollbar starts below the header. So nothing shifts when switching pages, and the margin next to the header needs no special treatment.
- Triage on the desktop: card and buttons stay put, the queue fills the remaining space and scrolls within itself.

### Fixed
- Chrome: since 0.59.3 the header scrolled out of view along with the page.

## [0.59.3] - 2026-11-02

### Fixed
- Chrome: since 0.59.1 there was a white strip to the right of the page, over the whole height on pages without a scrollbar. The strip now has the colours of header and page, and the page's scrollbar is visible in the dark theme too.

## [0.59.2] - 2026-11-02

### Fixed
- Desktop: since 0.59.1 a piece in the page colour showed to the right of the header (the space kept free for the scrollbar). The header's colour now reaches the window edge there.

## [0.59.1] - 2026-11-02

### Fixed
- Desktop: the layout no longer shifts by a few pixels when a page becomes scrollable (e.g. a wide Kanban board) or when switching between pages with and without a scrollbar. The space for the scrollbar always stays free.
- Tasks: when switching the task list, the tasks of the previous list flashed up briefly, especially when switching between list and Kanban view. Now the new list shows right away with its tasks.

## [0.59.0] - 2026-11-02

### Added
- Tasks: every task list remembers whether it is shown as a list or as a Kanban board, "All tasks" too (per device).

## [0.58.0] - 2026-11-02

### Added
- Tasks: "All tasks" is grouped by list by default. Tasks without a list come first as "No list", then the lists in the order of the tabs. "Group" still allows a different grouping; single lists stay ungrouped.

### Changed
- MindSift now remembers the chosen task list, list/Kanban view and grouping as well as the chosen shopping list per device, across a restart of the installed app or a new tab too.
- Counters on tabs and in the navigation sit right after the word and always hang only 2 px above the last letter, with two- and three-digit numbers too. They are filled everywhere (on the phone the icon used to shine through) and no longer have a dark ring.

### Fixed
- Phone: in the task details, task list, people search, hashtag and subtask were clearly smaller than the other fields; now all are the same size (when sharing and in groups too), and iOS no longer zooms in on tap. The button to the linked note is called just "Note" there, so the header stays on one line.

## [0.57.0] - 2026-11-02

### Changed
- The phone layout now applies up to 767 px width (previously up to 639 px). Phones in landscape, small tablets in portrait (e.g. iPad mini) and narrow windows get the layout with large tap targets and bottom navigation instead of a cramped desktop layout.

### Fixed
- Desktop: the quick dump bar sits exactly in the middle of the header and stays put when the connection status changes (e.g. from "online" to "limited") or the name is long.

## [0.56.0] - 2026-11-02

### Added
- Behind company proxies that let neither WebSocket nor server-sent events through, changes by others now arrive live by long polling: tasks and lists update without switching tabs or reloading. Notes use the same connection. The profile then shows "limited" in yellow, the live pill shows "Live (long polling)".
- Tasks show a live pill like lists and notes.

### Changed
- Header of tasks and lists like the notes: live pill and "Shared" on the left, then a divider, the buttons on the right. The same on the phone.

## [0.55.0] - 2026-11-02

### Added
- Connection status at the profile with three states: green "online" (live connection), yellow "limited" (server reachable but no live connection, e.g. behind a company proxy; notes sync more slowly, other changes show when returning to the tab) and red "offline". On the desktop the status now always shows below the name, not only without a connection.

### Fixed
- Behind a company proxy the profile showed "offline" all the time, although the app worked.
- Notes: whoever kept typing in the same bullet after switching to another app or window got a conflict notice against their own text.
- Notes: after a real conflict every further keystroke created another conflict copy. Now there is one copy with your own text; the bullet itself shows the other version after leaving it.
- Sign-in: Tab jumps from the username straight to the password field, "Forgot password?" comes after.
- Phone: pages can no longer be scrolled into nothing when the content fits the screen (the height follows the visible area instead of the height without the address bar).

## [0.54.0] - 2026-11-02

### Added
- AI agents can add, tick off, reopen, rename and remove subtasks over MCP (`add_subtask`, `update_subtask`). The right "change tasks" is enough; if the task is linked to a note, the checkboxes there follow.
- On the phone the list can be switched through the title at the top: a tap on the name of the open task list or list opens all lists with their counters.

### Fixed
- Notes: clicking into a bullet made the row a few pixels taller, so everything below jumped down briefly.
- Task details on the phone: an API key's origin badge stuck out over the "Watch" button. On the phone the origin now only shows at the bottom; the "Watch" button is as tall as the buttons next to it.

## [0.53.0] - 2026-11-01

### Added
- Administration → Server & Isolation: switch "Allow AI agents (MCP)". Switched off, the MCP endpoint is off, and so is connecting through claude.ai and ChatGPT; existing connector connections rest, API keys keep working with curl. The "AI agents (MCP)" tab in the API key settings disappears then. With `MCP_ENABLED=false` or `true` the operator fixes it, and the switch is locked.
- AI agents can create and read notes over MCP. API keys and connections through claude.ai/ChatGPT get two new rights under "Notes" for this: **read** (list notes, read them and find them in search) and **create** (new notes with bullets and sub-bullets, in a folder if wanted). An agent cannot change existing notes. Both rights are off by default and only apply over MCP, not with curl.

## [0.52.0] - 2026-11-01

### Added
- Notes: an extracted bullet can be pulled back. The link that remains after `/extract` has the button "Pull note back": the note's bullets come back as sub-bullets in that place, the link turns back into text, and the note goes to the trash. Ctrl+Z or "Undo" reverses it. Works with your own notes that are not linked anywhere else.

## [0.51.0] - 2026-11-01

### Added
- MindSift can be connected in **claude.ai** (the Claude app on the phone too) and **ChatGPT** as a connector, without any API key: enter the address `…/api/v1/mcp`, sign in to MindSift, choose what the agent may do, and allow it. Read and change for tasks and lists are preselected. Needs `BASE_URL`; not available in demo mode.
- Settings → API keys: connections through claude.ai & co. are listed with the label "OAuth"; change rights, rename and disconnect as with keys. "AI agents (MCP)" shows the address for claude.ai / ChatGPT to copy.
- `OAUTH_IDLE_DAYS` (default 90): connections unused for that long are disconnected; `0` = never.

## [0.50.0] - 2026-11-01

### Added
- Global search: chips "All · Notes · Tasks · Lists" with hit counts below the search field; switch by click, `Tab`/`Shift+Tab` or `Ctrl+1` to `4`. Limited to one kind, the search shows up to 100 hits.
- Large search view (button with the diagonal arrows, on the computer): a wider, taller window with up to 200 hits and filters per kind – tasks by status, task list, priority and due date (overdue, today, within 7 days), notes by folder, list items by list and status. Plus context per hit: for bullets the bullet before and after, for tasks list, due date and priority, for list items the list.

### Fixed
- Global search: tasks always had a green check mark in front, even when open. Now there is a checkbox with the real state, which ticks off or reopens tasks and list items right in the search.

## [0.49.2] - 2026-11-01

### Fixed
- Global search: open tasks come before completed ones, discarded thoughts last; open list items before ticked ones. So far only how well the text matched counted, so completed tasks could push open ones out.

## [0.49.1] - 2026-11-01

### Fixed
- Tasks: after jumping to a task (e.g. through the "Expanded" badge in a note) its detail window opened again every time you switched back to the tasks tab.

## [0.49.0] - 2026-11-01

### Changed
- **Attention:** from this version on MindSift is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPLv3) instead of The Unlicense. Using, changing and passing it on stays free, commercially too; whoever passes on a changed version or offers it as a service on the net has to make its source available under the same license. Versions up to and including 0.48.0 stay under The Unlicense. "About MindSift" names the new license and still links the source.

## [0.48.0] - 2026-11-01

### Changed
- Workspace, hashtag page: the mentions can be edited right there. Every note shows as a fixed heading (a click opens it), below it the normal outliner with the bullets carrying the hashtag, sub-bullets included. Typing, Enter, indenting, ticking off and undo act right in the original note, together with others too. Whoever removes the hashtag from a bullet or adds a new bullet without a hashtag with Enter still sees it until the cursor leaves it. The frames around the single notes are gone, the page looks like a normal note; notes only load when scrolled into view.

## [0.47.0] - 2026-11-01

### Added
- Link dialog in notes: from 3 letters on, matching **bullets from all notes** are listed below the matching notes (up to 8, search term highlighted, with the note title). A click links right to that bullet.
- Sample data (demo and, if wanted, at setup): new folder "MindSift-Hilfe" with short guides (getting started, notes, tasks, lists, shortcuts, voice input, sharing, API), a note "Zoom ausprobieren" with ten levels, a deeper kitchen plan in "Hausrenovierung 2027" and examples of linked to-dos: "Backup-Konzept" (a checkbox as a task with subtasks) and the task "Uptime-Monitoring" deepened into a note.

## [0.46.0] - 2026-11-01

### Added
- Tasks: microphone for the detail notes (on the right in the header). Dictated text is appended to the notes and opens the edit field for it; saving works as usual with "Save note".

## [0.45.2] - 2026-11-01

### Changed
- README and documentation brought up to date: trash bins and retention periods, voice input per person, Ctrl+Z in the tasks, combined Kanban in "All tasks", selecting across several bullets, notes and lists without an emoji, notice of a new version, database migrations up to 16.

## [0.45.1] - 2026-11-01

### Changed
- Workspace: folders no longer have an expand arrow; the open or closed folder icon shows the state. Empty and filled folders line up, and notes in a folder are indented as far as subfolders.
- Tasks on the computer: the hashtag row no longer scrolls sideways. If not all hashtags fit, it ends with "…"; a click on it shows all of them on several lines, "Less" folds them again.

## [0.45.0] - 2026-11-01

### Added
- Notes: text can be selected with the mouse across several bullets. Delete/Backspace removes it like in a text editor (the rest of the first and the last bullet become one bullet, bullets in between disappear with their sub-bullets), a typed character replaces it, Ctrl+C copies, Ctrl+X cuts. Ctrl+Z brings everything back in one step.
- Tasks: Ctrl+Z (Cmd+Z) undoes deleting, moving (columns, order in Kanban and list) and ticking off. After deleting, "Task in the trash · Undo" shows at the bottom, on the phone too.
- Notes, task lists and lists can be created without an emoji: every emoji picker has "Remove". Without an emoji the title stands alone; in a note's header a subtle icon shows where to pick one.

### Fixed
- Kanban: a task dragged into a self-made done column did not count as completed after reordering (only the default "Done" column counted).

## [0.44.0] - 2026-11-01

### Changed
- New notes get 🗒️ as the default icon (previously 📝 or 📄).
- Task list: "Group" and "Sort" sit right above the list next to the tabs "Open / Done / Trash"; "Move completed to the trash" and "Empty trash" are a trash icon to the right of them.
- Kanban on the computer: the board is as tall as the window; only the columns scroll, no longer the page on top (when all columns fit in one row).
- Quick dump: in the expanded area, target and list only select; saving is done with Enter or the button. The hint "(click saves right away …)" is gone.
- Voice input through the browser: one tap on the microphone listens across short pauses and only ends after 5 seconds of silence.

### Fixed
- Workspace: Shift+click from a pinned note that had been clicked in its folder selected everything from the pinned row at the very top instead of from the folder.
- Notes: a bullet with sub-bullets moved a bit to the right because of the expand arrow; now all bullets line up exactly.
- Global search: the input field no longer jumps back and forth while typing (loading icon and clear button share a fixed spot).

## [0.43.0] - 2026-11-01

### Added
- Trash for tasks: deleted tasks, "Clear completed" and the automatic clean-up of completed tasks go to the "Trash" tab of the tasks instead of being gone right away. From there they come back unchanged (with description, subtasks, assignees) or are deleted for good. Whoever sees a list sees its trash too; restoring and deleting need edit rights. `delete_task` over MCP also moves to the trash.
- A trash of its own for triage: discarded thoughts open through the trash button at the top of triage (in the menu on the phone).
- Account settings → Retention: for completed tasks (default 30 days, then to the trash), the task trash (30), the triage trash (14), the notes trash (30) and ticked list items (7), each 7, 14, 30 or 90 days, one or two years or never. In shared task lists, lists and notes the setting of the person they belong to applies. What was already completed or deleted at the update counts from the update.
- Administration: "Allow keeping things for good" (or `RETENTION_ALLOW_NEVER`). Switched off, "never" is gone; the area's default applies there instead.

### Changed
- The choice "Delete completed tasks after …" and its explanation in the "Done" tab are gone; the periods are collected under Retention. "Clear completed" no longer asks, because everything can be restored.
- **Attention:** the notes trash and ticked items in shopping and checklists are now emptied automatically after the period (default 30 and 7 days from the update). Whoever does not want that sets "never" under Retention.

## [0.42.0] - 2026-11-01

### Added
- Voice input per person: with your own Whisper server, everyone chooses under "Voice input" in the account settings whether their microphone uses the Whisper server (default) or the browser's recognition. The choice applies on all devices right away.
- `STT_ALLOW_BROWSER=false` forbids the browser's speech recognition (Chrome and Edge send the recording to Google or Microsoft), e.g. for use in companies. With a Whisper server the choice goes away; without a Whisper server there is no voice input then.

## [0.41.0] - 2026-11-01

### Added
- Notice of a new version: when the server was updated, the open app shows a window "New version available" with "Update now" (reloads the page) and "Later". It checks when returning to the tab or app, every 15 minutes and after a server restart. So the installed app on the phone does not stay on an old state either.
- After reloading the page the area open last (triage, workspace, tasks, lists, settings) stays open instead of always jumping to triage.

### Changed
- Voice input with your own Whisper server: the quick dump bar, the capture window on the phone and the hold button send the recording to recognition in pieces while you speak (like dictation). The text shows while speaking; after stopping only the last piece is missing.
- Quick dump: the chosen target (e.g. "straight as a task" into a certain list) stays set after sending.
- Quick dump: the chosen list is no longer filled with the accent colour but outlined, so the emojis on it are easy to see.
- Emoji picker on the computer: more compact like a context menu (smaller emojis and text, no title bar, closes by clicking next to it or Escape), with a raised surface of its own. Its colours now follow the theme in every theme (it was grey in the dark theme so far). "Remove icon" is a row at the bottom for notes.
- Workspace: the hint "n selected · drag into a folder or onto the trash" when selecting several notes is gone. Deselecting still works with Escape or a click next to it.

## [0.40.1] - 2026-11-01

### Fixed
- Notes: whoever came into a note through a task (or another jump to a certain spot) and pressed Enter in a bullet there landed in the jumped-to row again, which was selected. Typing on overwrote e.g. the title of the linked task. The jump target is now only visited once when opening.

## [0.40.0] - 2026-11-01

### Changed
- Kanban in "All tasks": the columns of all task lists are merged by name (case doesn't matter), in the order and colour of the first list that has a column. Columns with the same name show once, different names separately, done columns too.
- While dragging, columns the card's list doesn't have are greyed out and don't accept the card. The arrows on a card lead to the neighbouring columns of its own list; the status choice and the detail view still only show the columns of its own list.

### Fixed
- Kanban in "All tasks": tasks in a list's own columns (e.g. "Review") were missing entirely, because only the default columns were shown. Likewise, tasks whose column was deleted now show up in the first open column instead of nowhere.

## [0.39.0] - 2026-11-01

### Added
- Icon when creating task lists, shopping lists and notes: instead of a text field, a click on the icon opens the same emoji picker as in an open note (with search and recently used). Escape only closes the picker, not the window.

### Changed
- "Deepen into note": due date and priority sit right below the task in the new note, before the description and the subtasks instead of at the very bottom. The priority is written out in words ("Wichtig", "Dringend", "Niedrig").

### Fixed
- Kanban: when dropping, the card flickered briefly before showing in its new place. Now it takes the place of the gap right away.
- Example configuration for the Whisper server (`docker-compose.yml`): the model stays loaded with `WHISPER__TTL=-1`; speaches 0.8.3 does not know the `STT_MODEL_TTL` given so far, so the model was unloaded after 5 minutes.

## [0.38.1] - 2026-11-01

### Changed
- Kanban: while dragging a card, a card-sized gap opens smoothly at the target, the other cards glide along, and the card leaves its old place. After dropping it lights up briefly in its new place. The blue line that flickered over the cards' text and icons while dragging and made the view shake is gone.

### Fixed
- After reordering tasks (Kanban or list) a chosen task list suddenly showed tasks from other lists too, until it was opened again.

## [0.38.0] - 2026-11-01

### Added
- API keys can be edited: change name and rights (pencil icon in Settings → API). The key itself stays the same, devices and agents need no changes; the origin badges show the new name right away.

### Changed
- Quick dump: when the text gets several lines, the buttons move to a row of their own below, and the text gets the full width.
- Notes: the badges "Expanded" and "Subtask" now sit right after the text on the same line instead of on a line of their own below.

## [0.37.2] - 2026-11-01

### Fixed
- "Deepen into note" on a task row and a Kanban card created a new note every time for a task that was already linked. Now the button opens the linked note and is subtly marked in the accent colour for it; the server no longer creates a second note either.
- "All tasks" showed the default columns ("Waiting for others") for every task instead of the columns of its list. Status choice, status dot and detail view now use the columns of the task's own list, so renamed columns show there too.
- Voice input with your own Whisper server: on longer recordings Whisper sometimes appended sentences already said once more. MindSift now asks the server to skip silence (`STT_VAD_FILTER`, on by default) and removes a closing passage repeated word for word.
- Detail view on the computer: the date field was too narrow (the calendar icon lay over the date), the time field needlessly wide.

## [0.37.1] - 2026-11-01

### Fixed
- When shutting down, the server waits until a running compaction of the note log is done before closing the database. The same gap occasionally made a test fail on the build server.

## [0.37.0] - 2026-11-01

### Added
- Workspace: move or delete several notes at once. On the computer you select single notes with Ctrl/Cmd+click and a range with Shift+click; dragging a selected note into a folder or onto the trash takes all selected ones along. Escape clears the selection.
- The trash at the bottom of the sidebar accepts dragged notes, single ones too and on the phone (long press, then drag). The notice afterwards offers "Undo".

## [0.36.0] - 2026-11-01

### Added
- Tasks linked to a note ("Expanded") now sync the title too, both ways. Their subtasks are linked to checkboxes of their own in the note (badge "Subtask"): check marks and text travel back and forth, even when you move the checkbox in the note. A new subtask shows in the note below the task; a new checkbox right one level below the task becomes a subtask. Nothing is ever deleted automatically: what you delete on one side stays on the other.

## [0.35.0] - 2026-11-01

### Added
- Completed tasks clean themselves up: by default they are deleted 30 days after being ticked off. You set the period in the "Done" tab (7, 30, 90 days, one year or never); in shared lists the owner's setting applies. New there too: "Clear completed" to delete right away. Tasks completed before this update get their full period from the update, so nothing disappears right away.

## [0.34.0] - 2026-11-01

### Changed
- Task detail view on the computer in two columns: wide on the left title, subtasks and detail notes (with a larger input field), narrow on the right all settings (status, priority, due date, repeat, list, assignees, hashtags, origin). On the phone the view stays as it was.

## [0.33.0] - 2026-11-01

### Changed
- "Deepen into note" on a task: the task stays in its list and becomes the first checkbox of the new note, linked like a task from a note ("In note"); ticking off works in both places. A thought from triage still becomes a note as before.
- Quick dump: the list row below the targets follows the target. For "straight as a task" you choose the task list (or "All tasks"), for "straight onto a list" the shopping or checklist; quick dump and note have no row any more. The last chosen list is remembered per target for the session.

## [0.32.0] - 2026-11-01

### Added
- Voice input when adding tasks too (on the computer in the input row above the task list, on the phone in the "Create a new task" window behind the + button) and list items (on the computer in the row, on the phone in the capture window): a microphone right in the field as in the quick dump. Dictated text is appended to what is there.

### Fixed
- Phone: when adding a Kanban column, "Done" and "Add" were cut off on the right; they now sit below the text field. In the column list "Done" only shows the check mark on the phone, so the bin no longer slips out of view.

## [0.31.0] - 2026-11-01

### Added
- Kanban: the colour of each column can be set. In "Customize columns" the colour dot before the name opens the choice: grey, anthracite, green, yellow, blue, red, purple or the theme's accent colour. The colour shows in the column header, as a status dot in the list view and in the detail window. Blue and purple adapt to light and dark themes.

## [0.30.0] - 2026-11-01

### Added
- Tasks and lists with curl and smart home: an API key with read rights fetches e.g. what is due today with `GET /api/v1/tasks?due=today&status=open` (filters also `overdue`, a date, `status`, `taskListId`) and reads lists. With change rights it ticks off, changes or deletes tasks and maintains list items. The settings show a ready-made Home Assistant sensor "Due today" for it.
- Origin badge: whatever an API key creates or changes carries a badge with its name for good, with a webhook icon (API) or a robot (MCP) in front. Hover or tap shows who created and last changed it when; in the task detail view it is at the bottom. List items have the badge now too.
- Tasks in the list view show their status with a coloured dot in the colour of the Kanban column: on the computer before the status choice, on the phone as a dot with the column name (display only, changing still happens in the detail view).

### Changed
- Webhooks and MCP are now called "API" together: the settings category "Webhooks & AI agents" is called "API", a key's switches are ordered by tasks, lists and inbox (read, create, change), and the examples sit in two tabs "curl / smart home" and "AI agents (MCP)". The rights apply equally to both kinds of access: "Create tasks" now also allows `create_task` over MCP, "Change tasks" also delivering tasks by webhook. Existing keys keep their rights.
- The badges "Webhook" and "AI" / "AI changed" are replaced by the origin badge. It no longer disappears when you edit an entry yourself.

### Fixed
- A thought delivered by webhook or MCP lost its origin when it became a list item in triage.

## [0.29.0] - 2026-11-01

### Added
- AI agents (MCP) can now delete tasks (`delete_task`) and create new task lists (`create_task_list`) and lists (`create_list`). `list_task_lists` also names the board's columns, so an agent can move a task into the right column.
- Mark "AI" on tasks and list items an AI agent created over MCP, and "AI changed" on those it changed last. So you see at a glance what came from you. As soon as you change or tick off the entry yourself, the mark disappears.

### Changed
- Settings: export and import have a category of their own, "Export & import" (server backups, backup, Markdown archive, import data). The API keys stay under "Webhooks & AI agents".

## [0.28.0] - 2026-10-31

### Added
- Connect AI agents (MCP): MindSift is now an MCP server at `POST /api/v1/mcp`. Claude Code, OpenAI Codex, Claude Desktop, Cursor and your own agents can read, tick off, create and change open tasks and read, add to and tick off shopping and checklists. Shares apply as for yourself; notes stay out of reach for agents.
- API keys have new permissions for this: read / change tasks, read / change lists. The agent only sees the tools its key allows. The settings show the ready-made command for Claude Code, the `config.toml` for Codex and the JSON configuration for Claude Desktop and Cursor.

### Changed
- Settings: the permissions of an API key and the areas for import and restore (notes, tasks, lists, inbox, themes) are now switches as in the rest of the settings instead of clickable buttons with check marks.
- The settings area is now called "Webhooks, AI agents & export".

## [0.27.1] - 2026-10-31

### Fixed
- Notes on the phone: the bar for indenting and outdenting above the keyboard stayed when the keyboard was closed (e.g. with the back button) and covered the bottom navigation. It now only shows while the keyboard is open; a tap into the bullet brings both back.

## [0.27.0] - 2026-10-31

### Changed
- Demo: whoever opens the demo for the first time sees it in the round theme Fjord Night instead of the square default. A theme you chose yourself is kept; real installations are not affected.

## [0.26.1] - 2026-10-31

### Fixed
- Notes on the phone: a tap to the right of a bullet triggered the invisible buttons (turn into a note of its own, focus, delete …). The buttons now only react when they can be seen, i.e. while editing the bullet.
- Notes: a bullet already turned into a note of its own (only the link left, maybe with hashtags) cannot be turned into one again; the button and `/extract` are missing there. So far this created a second note containing only the link.
- The notice after turning into a note on the phone ("Open", "Undo") now sits above the bottom bar instead of at the screen edge, text on top (at most two lines), buttons below.

## [0.26.0] - 2026-10-31

### Added
- Connection status in the header: if the server cannot be reached, the desktop shows a small "● offline" with a red dot below your name; the page stays usable. On the phone a small dot at the bottom right of the avatar shows the status (green online, red offline). This also works when only the server is down and the device itself still has a network – so far this was only visible in the lists.

### Changed
- The screenshots in the README are now smaller WebP pictures (about 0.5 instead of 2.7 MB together); the journal picture shows the current view.

## [0.25.1] - 2026-10-31

### Fixed
- Sheets from the bottom on the phone (new list item, new note, new list, new folder …): with round corners they were rounded at the bottom too and had a border all around, so they did not sit cleanly on the keyboard. Now, like the other sheets, they are only round at the top and square at the bottom; on the desktop the window stays rounded all around.

## [0.25.0] - 2026-10-31

### Changed
- Shopping lists on the phone: the input field no longer sits above the list all the time. "+" opens it as a sheet from the bottom (as for tasks and triage); after "Add" it stays open and empty for the next item. On the desktop the field stays as before.
- Notes on the phone: "+" (and "New note" in the menu) first asks for name and emoji; only "Create" creates the note. An accidental tap no longer leaves an empty note behind. On the desktop the note is created right away as before.

## [0.24.2] - 2026-10-31

### Fixed
- Triage on the phone: "To list" (with several lists) and "With date" did nothing, because their choice was only shown on the desktop. On the phone they now open the large choice window from the bottom (as with a long press on the card).

### Added
- `TODO.md` with open and postponed tasks in the repository.

## [0.24.1] - 2026-10-31

### Fixed
- Shopping lists offline: new items without a connection reported "no connection to the server". Now they show in the list right away (with a small cloud icon), stay visible after a reload and are sent as soon as the connection is back. Ticking off, deleting or changing the quantity before they were sent acts directly on the waiting item.

### Changed
- Shopping lists: the field for new items is now recognizable as an input field (border, plus in the field) and takes most of the space; quantity and "Add" are equally tall next to it, or below it on the phone.

## [0.24.0] - 2026-10-31

### Added
- **Confirm email address:** new setting (Administration → Server & Isolation, or `REGISTRATION_VERIFY_EMAIL=true`). Whoever registers without an invitation gets a link by email and is only active after that; in the approval modes the account then goes to the admins, who are only notified then. Signing in before confirming offers "Send the link again". Unconfirmed accounts are deleted after 48 hours, and the address is free again. Only works with a mail server and `BASE_URL`; invitations need no confirmation.

### Changed
- Creating an invitation: the email address comes first and has more room, "How often usable" is narrow.

## [0.23.0] - 2026-10-31

### Added
- **Invite links:** every invite code is also a link (`/?invite=CODE`) that opens the registration with the code filled in. The administration has "Copy link" for it and – with a mail server – "By email" (invitation in the MindSift look with a "Create account" button; single-use codes get bound to the address).
- **One link for several people:** set "How often usable" when creating (e.g. 20); the list shows "3 of 20 used". Even simultaneous registrations can never redeem a link more often than allowed.
- **Registration with approval and by email domain:** instead of "open/closed" there are five modes – closed, with approval by an admin, only certain email domains, those domains right away and all others after approval, open. Waiting accounts are listed in the administration under "Waiting for approval" (approve/reject); admins get an email, and so does the person after approval. Until then signing in is not possible (with a notice). The registration form explains which addresses are allowed.
- New environment variables `REGISTRATION_MODE` and `REGISTRATION_DOMAINS`: when set they apply and are locked in the administration. `ALLOW_REGISTRATION=true` is the same as `REGISTRATION_MODE=open`.

### Fixed
- `ALLOW_REGISTRATION` was not evaluated at all so far; registration could be switched on and off in the administration regardless.

## [0.22.2] - 2026-10-31

### Fixed
- Voice input through the browser (without a Whisper server): in Chrome on Android a sentence was taken over several times ("TestTestTestTest 1 2 3" instead of "Test 1 2 3"), because Android delivers every interim state as a result of its own. Continuations now replace the previous state.

### Added
- `AGENTS.md` with rules for coding agents (language, checks, release flow through CI) and a plan for registration with approval/email domains and sign-in with OpenID Connect (`Doku/plans/`).

## [0.22.1] - 2026-10-31

### Fixed
- Push notifications: after reinstalling the app, the old installation counted as another device ("2 active") until the next push sorted it out. When a device switches push on again, it now unsubscribes its old registration as well. Also, the settings show every device on its own (with date and "this device"), and each can be removed.
- Daily summary and news by email: the greeting ("Good morning") followed the clock at sending time instead of the time the message is meant for. Because of this a test also failed from noon on, and the build of 0.22.1 broke off – the version only arrives with this fix.

## [0.22.0] - 2026-10-31

### Added
- Kanban on phone and tablet: cards can be moved with a finger – hold briefly until the card lifts, then drag it onto another card or column and let go. At the edge the page scrolls along (on the phone the columns are stacked). A short tap opens the task as before, swiping scrolls.
- Admin settings: besides "Download", database backups can also be deleted (with confirmation). Admins only; user backups still expire by their retention. New for it: `DELETE /api/v1/admin/backups/{name}`.

### Changed
- Notice after sharing: larger and easy to reach with the thumb – text on top, below it two large buttons **List** and **Task** as in triage, a small ✕ in the corner; a tap next to it closes it.

## [0.21.0] - 2026-10-31

### Added
- Sharing from other apps: shared content still lands in the quick dump right away. The notice afterwards offers **→ Task** and **→ List** for a few seconds to file it there with one tap instead (directly with only one writable list, otherwise with a short list choice). Whoever taps nothing keeps the usual flow.

## [0.20.0] - 2026-10-31

### Changed
- App shortcuts (hold the app icon): instead of "Capture" and "Triage", which only opened the start page, there are now **Quick Dump**, **New task** and **Shopping list** with icons of their own. Each opens the matching area with the input field (quick dump window, "New task", new list item). Old shortcuts still lead to the quick dump. Android picks up new shortcuts as soon as it updates the app (or after reinstalling).

## [0.19.0] - 2026-10-31

### Added
- Notes on phone and tablet: while writing in a bullet, a slim bar sits right above the on-screen keyboard with outdent, indent, move up and move down (replacing Tab / Shift+Tab). The bullet takes its sub-bullets along, stays below its parent when moving, and the keyboard stays open. With a mouse or pen the bar does not show.

## [0.18.1] - 2026-10-31

### Fixed
- Workspace on the phone: after opening the journal and going "Back", the journal entry stayed half highlighted, and its label was smaller than the folders'. It now looks like a normal entry (same height and font as the folders); on the desktop it opens as an area with a calendar as before.

## [0.18.0] - 2026-10-31

### Changed
- Emails have one look in the style of the app: logo centred on top, below it a card with a greeting ("Good morning, …" by time of day), the actual content and a button to the app, at the bottom the note why the email comes. The logo travels inside the email (so it shows even without loading remote images and without `BASE_URL`); every email also has a plain-text version built the same way.
- Daily summary: tasks are listed in the sections "Overdue", "Today" and "Tomorrow", with time and list below.
- Due alarm, news, password reset, account change (with a highlighted security notice), test alarm and SMTP test use the same layout; most of them came as plain text so far.

## [0.17.4] - 2026-10-31

### Fixed
- User menu: with round corners (theme setting) the square header with name and role stuck out over the top edge of the menu.

## [0.17.3] - 2026-10-31

### Fixed
- Due notifications came again after every move on the Kanban board: moving marked all open tasks of the affected columns as still waiting for their alarm. Now only a task reopened from "Done" gets its alarm again.

## [0.17.2] - 2026-10-31

### Changed
- Workspace on the phone: notes, to-dos and hashtags are now switched through the menu at the top (logo), as for tasks and shopping lists; the tab row is gone there. Folders and notes in the list are as tall as the search field (44 px) and so easier to hit.
- Tasks on the phone: the header is as tall for "All tasks" as for single lists and for the shopping lists.

## [0.17.1] - 2026-10-31

### Changed
- Maximize Kanban: only the board gets wider, the list tabs and "Create a new task" keep their width. The board grows with a smooth animation, each column is at most 380 px wide and the board stays centred (so with few columns it is narrower than the window).

- Loading screen: instead of always blue, it shows in the colours of the theme used last on the device (background, logo in the accent colour, matching status bar); on the very first visit it stays blue. New for it: `boot-theme.js` (a file of its own because of the content security policy); the app caches are renewed once.

- Journal: instead of the colourful calendar emoji, a plain calendar icon in the theme's text colour sits before a day's title (not clickable, the icon cannot be changed in the journal anyway).

### Fixed
- Installing the app on the phone: if Chrome only reports that MindSift is installable after the instructions were opened (e.g. shortly after removing the old app), the instructions now show an "Install now" button for direct installation.

## [0.17.0] - 2026-10-31

### Added
- Tasks and Kanban: a task can be dragged onto the tab of another task list and lands there like a new task. It keeps its Kanban status if the target list has that column, otherwise it starts in the first column. Read-only lists accept nothing.
- Shopping lists: items can likewise be dragged onto the tab of another list; category, quantity and check mark are kept. New for it: `POST /api/v1/lists/{id}/items/{itemId}/move` (edit rights in both lists needed).
- Tasks and shopping lists remember the open list when switching between the app's tabs, tasks also list or Kanban (per browser tab, like the workspace).

### Changed
- Shopping lists: the connection display at the top right now looks like the one in notes (dot and "Live" or "Offline") instead of the old radio icon.

### Fixed
- Push notifications on the phone: the status bar showed a plain single-colour square instead of the brain icon. Android only uses the image's transparency there; MindSift now provides an icon of its own for it (white brain on a transparent background). The app caches are renewed once.

## [0.16.1] - 2026-10-31

### Changed
- README screenshots tidied up: only the title picture is split diagonally into light/dark, the phone and the other views each show one theme. New is a grid with the colour families Fjord, Terracotta, Polarized and Suri (each light/dark diagonally, on the Kanban board).

### Fixed
- Settings on the phone: for the daily summary the channel switches (email, Discord, webhook, push) stuck out on the right. On the phone they now sit in pairs below each other.

## [0.16.0] - 2026-10-31

### Added
- Kanban: next to "Customize columns" a small button (diagonal arrows) stretches the board to the full window width; all columns then sit side by side. The browser remembers the setting; the phone has no such button.

### Fixed
- Tasks: a new quick dump entry (e.g. by voice input through the held plus) briefly showed at the top of the tasks although it belongs in triage. Live changes now only take in real tasks; a task brought back into triage with "Undo" also disappears from the list right away.
- Kanban: with round corners (theme setting) the square column headers stuck out over the top of the column edge.

## [0.15.1] - 2026-10-31

### Fixed
- Triage on the phone: the queue can be folded again ("Hide queue") and opens and closes smoothly.
- Triage on the desktop: notes filed or deleted on another device now disappear here right away too (so far only the tasks tab was updated). When the tab comes back to the front, it also reloads in case changes were missed in the background.
- Tasks: a tap anywhere on the task now reliably opens it, not only on the text. So far the row with date/tags and, in Kanban, the arrow bar swallowed every tap, and on the phone a slightly longer tap could count as dragging (dragging is now only possible with a mouse or pen).

## [0.15.0] - 2026-10-31

### Changed
- Hashtag overview: tiles are wider (as many columns as fit at 18rem at least), tag names and note titles have more room.
- README revised and screenshots renewed: every picture shows the light theme on the left and the dark one on the right (split diagonally), journal and a note on the phone are new. `e2e/screenshots.sh` creates the pairs itself (`SHOT_LIGHT`/`SHOT_DARK` for other colour families) and runs, like the tests, with a container and port of its own.

## [0.14.3] - 2026-10-31

### Changed
- Slash menu: commands whose name starts with what was typed come first (`/li` → `/link` first), then aliases, then matches in the name, last in the description.
- Link preview: card and image about twice as tall; instead of the bare address, a small link label (domain and path) in the theme's accent colour sits below.
- Links in normal bullets: the green highlight bar below the bullet is gone; web addresses in the text are now clickable right away (punctuation at the end is not part of the link).

## [0.14.2] - 2026-10-31

### Fixed
- Installed app: the service worker served `manifest.json` from the cache first, so when checking for changed app colours the browser still saw the old blue version. The manifest now always comes fresh from the server (cache only offline); the app caches are renewed once.

## [0.14.1] - 2026-10-30

### Fixed
- User menu: the light/dark switch stuck out of the menu and did not show "Like system" when the theme did not change with it. It now sits on a row of its own (Light · Dark · System) and shows every choice right away.
- Footer: one even, smaller line ("MindSift v… · About MindSift", legal texts on the right) in one font instead of a mix of bold and monospace that looked crooked.

## [0.14.0] - 2026-10-30

### Added
- Themes as colour families with a light and a dark variant each: Classic, **Fjord** (new, glacier blue / night blue), Terracotta, Polarized (new: **Polarized Light**), Suri (new: **Suri Light**).
- Appearance in the account settings: a family × light/dark table, "Light or dark: like system" (switches within the family with the device), corners (like theme / round / square), borders on buttons (with / without) and an accent colour of your own (suggestions or free choice). Everything applies per device.
- User menu and phone profile: a compact quick choice with one colour dot per family and light / dark / like system; your own themes below.

### Changed
- Code colours from `index.css` are only fallbacks now; a theme's code colours always win.

## [0.13.0] - 2026-10-30

### Added
- New theme **Terracotta Night**: the dark counterpart of Terracotta – espresso brown, cream text, glowing terracotta accent, sage green, soft corners.
- Animations: menus (user menu, three-dot menu), dialogs and bottom sheets fade and slide in smoothly; on the phone a note slides in from the right and the list from the left on back. On the computer switching notes stays instant. With "reduce motion" in the system there are no animations.

### Removed
- Theme "Soft Slate"; whoever had it active gets "Terracotta Night" automatically.

### Fixed
- The existing fade and slide animations (`animate-in`, `fade-in`, `slide-in-from-*`) never ran, because the Tailwind plugin was missing (`tailwindcss-animate`).

## [0.12.2] - 2026-10-30

### Fixed
- Triage on the desktop: with only one list with a long name, "Task" stuck out to the right of the card; the list name in the button is now shortened (full name in the tooltip).

## [0.12.1] - 2026-10-30

### Fixed
- Workspace → to-dos: the grouping (folder → note) is shaded evenly per level – each level a little darker in the light theme, a little lighter in the dark one – instead of jumping back and forth between grey and white.

## [0.12.0] - 2026-10-30

### Added
- New theme **Terracotta**: warm cream paper for notes, sand-coloured sidebar, ink-dark text, burnt terracotta accent with sage green and soft corners; code highlighting in earth tones.

### Removed
- Theme "High Contrast". Whoever had it active gets "MindSift Dark" automatically.

### Changed
- Themes: whether a theme is light (light code colours, no dark mode) follows its background colour instead of just "Light".
- Header on the phone: the search button and the avatar are circles of the same size.

## [0.11.1] - 2026-10-30

### Changed
- Triage on the phone: below the card two large buttons "← Discard" and "Task →" (like swiping), below them a block of four as in the long-press menu: to list, with date, as note, later. The queue is folded on the phone; "Show queue" opens it and scrolls there.

## [0.11.0] - 2026-10-30

### Added
- Focus mode: folders and notes slide in from the left – through the folder button or a click on the title in the header, on wide screens also when the mouse touches the left edge. Another note opens without leaving focus mode; `Esc` closes the bar first.
- Focus mode for notes: `Ctrl+Shift+F` or "Start focus mode" in the three-dot menu. Only the note at a comfortable reading width over the whole window; the header (title, undo, share, menu, "Exit") slides in when the mouse touches the top edge. `Esc` ends it; on the phone through a round button at the bottom right.
- **Push notifications** (web push) on phone and desktop, even when MindSift is closed: switch on and test per device under Account settings → Alarms; "Push" is a column of its own for every event (due tasks too) and the daily summary. iPhone and iPad from iOS 16.4 when MindSift was added to the home screen. Keys by `VAPID_*` or generated automatically. API: `/push/key`, `/push/devices`, `/push/subscribe`, `/push/unsubscribe`, `/push/test`.
- Links to single bullets: "Copy link to this bullet" in a bullet's action bubble or in the link dialog (`/link`) through "Pick a bullet of this note". Format `[[Note#^id|Note › excerpt]]`; a click opens the note, jumps to the bullet and highlights it. If the bullet no longer exists (moved, extracted, deleted), the note opens with a notice. Wiki links now show in the text with their display text and are clickable right away.
- Global desktop footer with version number, "About MindSift", dynamic legal texts (legal notice, privacy policy) and an optional custom link (`LEGAL_CUSTOM_LINK_LABEL`, `LEGAL_CUSTOM_LINK_URL`).
- "About MindSift" dialog and version display in the mobile profile menu (avatar menu at the top right).
- PWA web share target: text, links and images can be shared from the phone's native share dialog straight into the MindSift inbox (`share_target` in the manifest, caught in the service worker via IndexedDB and taken over on app start; fallback route `POST /share-target` on the server).

### Changed
- Inline code with a subtle light shimmer in the dark theme (text colour at low opacity as background) instead of a dark code background, slightly grey in light themes accordingly.
- Installed app: status bar at start and Android navigation bar black instead of blue (the browser can only colour the navigation bar from the manifest, not per theme); the status bar then follows the theme as before.
- Notes sidebar: the selected note is only shaded (without a border); the journal panel and the month/year choice in the calendar do without borders too.
- Code blocks without border and header: only the language at the top left, copying as a round icon button at the bottom right (shows on hover, always on the phone). "Turn into normal text" sits in the bullet's action bubble for code blocks (and numbered bullets).
- Code, audio and dictation blocks have round corners regardless of the theme; callouts stay square.
- Inline code is single-coloured (text in the main text colour on the theme's code background) instead of in the accent colour, for better readability.
- Notes: Enter in an empty indented bullet only outdents it when no bullet on the same level follows; otherwise a new bullet appears below as usual (numbered lists don't end then either).
- Workspace bar: live, shared and save status without borders in the same style, a vertical divider before the note buttons. Footer without a line above.
- Journal: panel and calendar open with a gentle animation, the journal view fades in.
- Pasting and Markdown import: a list right after a paragraph ("The following points:") is indented below that paragraph.
- Workspace on the desktop (from 1024 px): the note's own header is gone. Undo, redo, share and the three-dot menu sit at the top of the workspace bar in a fixed order: avatars, live, shared, save status (only as an icon now, text as a tooltip), then the buttons. In focus mode the breadcrumbs sit above the title. On phone and tablet the header stays.
- Notes sidebar: heading "Notes & outliner" removed, search and the buttons for a new folder and a new note sit on one row.
- Journal: when open it is a shaded panel with a border, "Journal" is its heading; a second click closes it and shows the previous note again. Whether the journal was open and which note was open is kept when switching between tabs (journal days no longer open as a single note).
- Notes: when pasting and in the Markdown import, paragraphs and lists below a heading are indented (H2 below H1 one level deeper), so sections can be folded and focused. Enter at the end of a heading adds the new bullet as a sub-bullet; `- `, `* ` or `+ ` in an empty bullet turns it into a normal bullet.
- CI: tests run only once per code state. `main` builds without running the tests again if the same state was already tested as `dev`; a release tag on the same commit as `latest` does not build again but retags `latest`. The mapping is a label in the image (no extra image tags in the registry). Dockerfile: `SKIP_TESTS`, BuildKit caches for Go and npm.

### Fixed
- Notes: formatting inside bold, italic or strikethrough shows, e.g. bold inline code `**`services`**` (backticks used to show in the text).

## [0.10.0] - 2026-10-30

### Added
- Numbered lists in the outliner: `/number` (also `/nummer`, `/liste`) or `1. ` at the start of an empty bullet; Enter continues the list, Enter in an empty bullet ends it. Indented lists count with letters (a., b.), the next level in roman numerals (i., ii.), then with numbers again. Export and import as Markdown (`1.`).
- **Journal** in the workspace: at the very top of the sidebar; one note per day with a fixed date title, all days below each other (today on top, older ones load while scrolling). While the journal is open, a calendar with month and year choice shows the day you are at; days with entries have a dot, a click jumps there (and creates the day if needed). "Share" applies to the day currently visible. On the phone the calendar opens through the header. Can be switched off per device under Appearance. API: `GET /journal`, `POST /journal/{date}`.
- Notifications: your own webhook is now a full channel next to email and Discord – a column "Webhook" of its own for every event and the daily summary; bundled messages come as JSON (`event: "digest"` with a list of the events).
- Outliner: new slash command `/text` (and aliases `/p`, `/paragraph`, `/bullet`, `/standard`) to turn any block (headings, callouts, to-dos, dividers) into standard text; the to-do options and the block action bubble offer the conversion back too.
- Triage deck: touch-friendly quick action bar below the active mobile card (discard, list, note, task) for thumb use (≥ 44 px).

### Changed
- Font: MindSift now ships the Inter font itself (without an external service), so the interface looks the same on all devices. Note titles use a fine, thin font and are a little larger.
- Notes: the title in the header only shows once the large title has scrolled out of view; on the phone the header fits on one line.
- The image for `main` (`latest`) shows the version number without `-dev`; only `dev` and other branches keep the suffix.
- Outliner: font sizes for H1 (`text-xl sm:text-2xl font-bold`), H2 (`text-lg sm:text-xl font-semibold`) and H3 (`text-base font-semibold`) clearly raised, with the textarea in sync and a subtle top margin.
- Outliner: action buttons (zoom, extract, delete, convert text) positioned as a floating, high-contrast bubble (`backdrop-blur-sm`), so the text no longer rewraps abruptly when they show.
- Outliner: the active entry in the slash command menu is subtly highlighted as `bg-accent-dim text-accent` instead of a solid fill.
- Quick dump (instant capture): placeholder texts shortened, vertical scrolling in the single-line state prevented and the send arrow aligned to the bottom.
- Counter badges (`CountBadge`): accent badge with `--accent-dim` and a border, muted badge with `--bg-panel-elevated` and `--text-muted` for high readability in all themes.
- Workspace: popover dialogs (`FormSheet` with an anchor) open centred below the mouse pointer with edge protection (viewport clamping).

### Fixed
- Notes: pasted text with line breaks that lands in a single bullet (e.g. a paragraph) disappeared – it is now taken over. Empty lines split pasted paragraphs into bullets of their own, numbered Markdown lists stay numbered (with 3 or 4 spaces of indentation too), wrapped lines belong to the bullet above.
- Account settings: your own webhook could be entered but no longer switched on (since the notification rework in 0.8.0).
- Workspace: no double scrollbar any more – the page itself does not scroll, only the note; on the phone the note no longer scrolls separately from the page.
- Workspace: a cancelled drag in the sidebar no longer leaves "Move to top level" standing.
- Workspace: the button to fold the folder bar is subtle when folded (only the icon in the accent colour).
- Outliner: slash commands are recognized at the actual cursor position in the text (`/link`, `/diktat`); `/divider`, `/image`, `/audio` and `/code` are only offered in empty blocks; the menu closes on a click into empty space and on blur.
- Outliner: to-do badges and the three-dot menu decoupled from the text container, to fix disturbing line breaks at the end of the line.
- Outliner: dividers can be focused and turned straight into an empty text bullet with `Backspace` or `Delete`.
- Account settings: the "Profile & sign-in" area uses the full width like the other areas.
- Light theme: notes sit on a white sheet, the folder bar is subtly set off in grey (it used to be the other way round). Themes can set this themselves through the new variables `--bg-editor` and `--bg-sidebar`.

## [0.9.0] - 2026-10-30

### Added
- Formatting shortcuts in the outliner: `Ctrl+B` / `Cmd+B` for bold, `Ctrl+I` / `Cmd+I` for italic (toggling on selected text) and `Ctrl+K` / `Cmd+K` for links (with a selection `[text](…)` with the address preselected, without a selection the link dialog).
- Code blocks: line number column on the left with synchronized scrolling (grows dynamically at 100+ lines, counts empty trailing lines too); horizontal scrolling for long lines without automatic wrapping (`white-space: pre`).

### Fixed
- Formatting shortcuts don't act in read-only notes.
- Light theme: contrasts for code blocks (`--bg-code`), callouts (`--bg-panel-elevated`), quotes and borders on note backgrounds sharpened; VS Code Light+ syntax colours optimized for high readability.

## [0.8.0] - 2026-10-30

### Added
- Notifications per event and channel (Account settings → Alarms): due tasks (right away), share received, shared task completed, watched tasks – each by your own email and/or your own Discord webhook. Everything except due tasks comes bundled (at most one message every 5 minutes, `NOTIFY_DIGEST_MINUTES`), emails now with an HTML layout. Your own changes trigger nothing (can be switched on for watched tasks), one switch pauses everything.
- Watch tasks: a button in the task detail; every change to it is reported. API: `POST/DELETE /tasks/{id}/watch`.
- Daily summary at a time of your choice: overdue, today's and tomorrow's tasks with time, plus the number for the next 7 days; no message without due tasks.

### Changed
- Note header tidied up: live status, share pill and online avatars sit at the top in the tab bar next to "Saved"; the note header has buttons for undo (`Ctrl+Z`) and redo (`Ctrl+Y`), "Share" visible right away and a three-dot menu for pinning, merging, Markdown export and deleting.
- `/diktat` in notes: writes along live (multi-line text above the waves with an `mm:ss` timer), no longer stops at speech pauses in browser mode, and in server mode sends sections ahead for recognition every ~8 seconds or after short speech pauses.

### Fixed
- Turn into a note of its own: the link shows in the bullet right away (also behind proxies without a live connection), without conflict copies when typing on at the same time; the new note shows in the sidebar right away. Ctrl+Z or "Undo" in the notice brings the branch back and moves the new note to the trash.
- Notes: link preview cards only show when the whole bullet consists of a single `https` address (or was inserted through `/link` in an empty bullet), no longer for links in the middle of the text.
- Notes: the slash menu (`/`) only opens at the start of the text or after a space (no longer when pasting web addresses with slashes), closes reliably with `Esc` or `Backspace` and scrolls along with arrow key navigation.
- Notes: `Enter` in an empty top-level bullet adds a new bullet below at the end of the note too.
- Notifications: the daily summary now includes tasks from task lists shared through a group too.

## [0.7.0] - 2026-10-30

### Added
- Turn a bullet into a note of its own: a button on the bullet (desktop) or `/extract` or `/notiz`. The bullet becomes the title, its sub-bullets the content of the new note in the same folder; a `[[link]]` remains in its place (hashtags stay there). In shared notes the new note takes over the shares.
- Merge notes: drag a note onto another one in the sidebar or use "Merge with another note…" in the note header. The source is appended as a section (heading with sub-bullets) and goes to the trash; "Undo" in the notice reverses both.
- Your own speech recognition (optional): with `STT_URL`, MindSift sends recordings to a Whisper server you run yourself (OpenAI-compatible, e.g. speaches) instead of to Google or Microsoft. Configured only through environment variables (`STT_*`) including limits; `docker-compose.yml` contains the `whisper` service as a commented-out block to switch on, MindSift downloads the model itself on the first start. Administration → Server & Isolation shows the active mode and offers a test recording. The demo stays with the browser recognition.
- API: `POST /voice/transcribe`, `GET /admin/voice`; `/auth/status` reports `voice.mode`.
- Images in notes: `/image` (also `/bild`) in an empty bullet opens a choice right in the bullet – file, camera (phone), drag in, paste with Ctrl+V or an image link (the server takes a copy). Photos are shrunk to at most 2048 px before uploading and saved as WebP, location data is dropped. A click enlarges, below it an optional caption. Esc or ✕ turns the bullet back into an empty bullet.
- Voice notes in notes: `/audio` in an empty bullet shows a recording bubble – the green button starts, it turns red and live waves run on the left with the time, a tap saves the recording as an audio player in the bullet. Alternatively upload an audio file. With your own speech recognition, "Transcribe" turns the recording into the (searchable) caption.
- Dictation in notes: `/diktat` in an empty bullet listens right away; the bullet becomes an area with live waves and "Stop", a tap puts the recognized text into the bullet. Uses the configured speech recognition (your own server or the browser) and is not offered without speech recognition.
- Backup and export with media: the backup ZIP (the automatic server backups per account too) contains the images and voice notes of your own notes, the Markdown archive puts them under `attachments/` and embeds them Obsidian-compatibly. Restoring brings them back as image and audio blocks. The Obsidian import now also takes over embedded images and audio files (`![[image.png]]`, `![](image.png)`).
- Link preview in notes: above a bullet with a web address (https) a compact card shows with icon, site name, title, one line of description and a small image. The MindSift server fetches the page (as with images, only public https addresses) and stores the preview for 7 days; the readers' browsers don't contact the page. ✕ hides the preview for this link (it becomes `[title](address)`), Appearance → "Show link previews" switches all off. Off in the demo. API: `GET /link-preview?url=`.
- Media storage for notes (the basis for images and audio): uploading, copying external images, fetching only with read rights; limits by `MEDIA_*`; files no longer used are removed automatically. API: `POST /documents/{id}/media`, `POST /documents/{id}/media/fetch`, `GET /media/{id}`.
- Code blocks in notes: language choice (about 50 languages, loaded on demand), colours while typing in the style of VS Code Dark+/Light+ for all themes, "Copy", Tab/Shift+Tab indents and outdents. `/code yaml` or ```` ```yaml ```` sets the language right away.

### Changed
- **Note for operators:** images and voice notes live in `data/media/`, not in the database. Whoever backs up the server backs up the whole `data/` folder (the database dump of the admin backups contains no media files). Optionally new in `docker-compose.yml`: the commented-out `whisper` service.
- Notes on the phone: almost no side margin any more, indentation 14 instead of 22 px per level, the zoom and delete buttons only take space in the active row. Very deeply nested bullets keep a readable width; the note can then be scrolled sideways instead of squeezing the text.
- Emails show a sender name: `SMTP_FROM_NAME` or the new field "Sender name" in Administration → Email (default "MindSift"), when the sender address contains no name of its own.
- Slash commands uniformly in English: `/image` instead of `/bild` (`/bild` still finds it), shorter descriptions, a wider menu without line breaks.
- `docker-compose.yml` only contains the mappings now; all explanations of the variables are in `.env.example`. Newly passed through are `TZ`, `TRUSTED_PROXIES`, `LOGIN_PROTECTION`, `DEMO_RESET_MINUTES` and `LEGAL_*_CONTENT`, which had no effect when set in `.env` before.
- Workspace sidebar like a file explorer: pinned notes on top, below them folders and notes without intermediate headings.
- Voice input in the quick dump, in the mobile capture sheet and when holding the + button follows the server setting: with your own Whisper server it works in all browsers (Firefox too), with live waves during recording and "Recognizing…" afterwards. Without browser support or with `STT_DISABLED=true` the microphone is hidden instead of showing an error.

## [0.6.1] - 2026-10-29

### Fixed
- Notes: whoever typed in a rhythm (short pauses between words) got conflict copies against themselves, even in notes that were not shared. Several unsent changes to a bullet counted as several versions locally, but as one on the server.

## [0.6.0] - 2026-10-29

### Added
- Profile → "Active sessions": a list of the signed-in devices with last use and "Sign out" per device.
- API: `GET /auth/sessions`, `DELETE /auth/sessions/{id}`.
- Triage: if there is exactly one writable list, "To ‹list name›" puts the thought straight onto it, without a choice. Lists shared read-only are no longer offered when capturing and in triage.

### Changed
- **Attention:** after the update all users are signed out once (new session handling, the old block list `revoked_tokens` is gone).
- **Attention:** `?token=` in the URL of `/webhooks/ingest` only accepts API keys (`mindsift_sec_…`) now.
- **Attention:** `GET /admin/settings` no longer returns `smtpPass`; new is `smtpPassSet`.
- **Attention:** `PATCH /auth/settings` requires the field `currentPassword` for `password` and `email`, otherwise `403`.
- Version numbers now follow Semantic Versioning with three-part tags (`v0.6.0`); the header shows the full version (`v0.6.0-dev` for development builds). Pre-releases like `v1.0.0-rc.1` don't move the `:stable` image.
- The quantity field in lists opens the number keyboard on the phone.

### Fixed
- Large downloads (backups, exports) broke off after 30 seconds, large imports after 15 seconds of upload (FLAW-38).
- Starting the app offline works reliably: an old script in the start page deleted all of the service worker's caches on every visit.

### Security
- Links in notes, task notes and the legal notice only open `http`, `https` and `mailto`; `javascript:` and similar links show as text. Before, an editor of a shared task list could run code in others' browsers through a crafted link (FLAW-28).
- Security headers for all answers: Content-Security-Policy (scripts only from MindSift itself, no embedding in other sites), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (FLAW-29).
- Password and sign-in email can only be changed with the current password; the previous address gets a notice mail if SMTP is set up (FLAW-30).
- Sign-ins are server-side sessions: every device can be signed out on its own, unused sessions end after 30 days, active ones are renewed daily. A new password signs out all other devices (FLAW-31).
- IDs of new records have 96 instead of 40 random bits, invite codes 100 bits of their own (`INV-ABCDE-FGHIJ-KLMNO-PQRST`); existing IDs and codes stay valid (FLAW-32).
- Registration and "forgot password" are limited per address (20 and 10 requests in 15 minutes), so invite codes cannot be guessed by trying (FLAW-39).
- An invite code can only be redeemed once, even with simultaneous registrations (FLAW-40).
- Public demo: sends nothing any more (alarms, test alarms, SMTP test, notice mails), server settings are read-only, password, email, sessions and accounts of the shared demo accounts cannot be changed; the session list only shows your own device (FLAW-33).
- The SMTP password is never sent to the browser any more; leaving it empty keeps the stored one (FLAW-34).
- `?token=` for the webhook ingest only accepts API keys, no session tokens (FLAW-35).
- Request bodies are limited to 2 MB, note sync to 8 MB, imports to 101 MB (FLAW-36).
- Deleting an account also removes the account's server backups (FLAW-37).

## [0.5.2] - 2026-10-29

### Fixed
- Shopping list on the phone (iOS): the `+` button and the menu entry set the focus for new items right within the tap gesture instead of 60 ms later, so the on-screen keyboard opens reliably on iOS; input fields use a 16 px font on mobile against automatic zooming in.

## [0.5.1] - 2026-10-29

### Fixed
- Mobile `+` button in triage and tasks: a short tap opens the capture sheet through the `click` event again instead of on `pointerup`, so the browser click that follows right away doesn't land on the background overlay and close the sheet at once (after a long hold for voice recording the following click is ignored).

## [0.5] - 2026-10-29

### Added
- Automatic daily server and user backups (`$DATA_DIR/backups`): a consistent full SQLite dump (`VACUUM INTO`, `.db.gz`) and a MindSift backup ZIP per active account; adjustable time and retention (default 03:00, 3 days) under Administration → Backups, including "Back up now".
- Account settings → Server backups: download your own backups or restore them selectively by area (`notes`, `tasks`, `lists`, `inbox`, `themes`) (replace or add); the manual MindSift import supports the choice of areas too and takes your own themes along.
- Mobile: holding the `+` button starts a voice recording and puts the transcript straight into the quick dump on release (dragging up cancels); a short tap or keyboard/screen reader still opens the capture sheet.
- API key scopes (`webhook:triage`, `webhook:task`, `webhook:list`): choice when creating, shown as badges, and a webhook simulator for all three targets in the account settings (FLAW-07).
- Demo mode: automatic reset every 20 minutes (`DEMO_RESET_MINUTES`, `0` = off) with a live countdown (`✨ Demo · reset in MM:SS`) in the header; sessions survive through fixed demo account IDs. A deeply nested sample note "Hausrenovierung 2027" (7 levels) to try the zoom focus.
- Counter for open list items on the "Lists" tab; the search in the notes sidebar opens the global full-text search (`⌘K`).

### Changed
- **Attention:** WebSocket (`/ws`) and SSE (`/events`) no longer accept `?token=` in the URL but short-lived one-time tickets (`POST /auth/stream-ticket`, valid for 60 s) or the `Authorization` header (FLAW-22).
- **Attention:** new passwords must be at least 8 characters long (setup, registration, profile, admin, password reset) (FLAW-09).
- Numbered database migrations through `schema_migrations`, which run exactly once and stop the start on errors instead of swallowing them (FLAW-13).
- Real ESLint (`eslint.config.js`) in the frontend and image build plus extended frontend tests (FLAW-19); a unified access check for task lists (FLAW-20).

### Fixed
- SQLite transactions start with `BEGIN IMMEDIATE` (`_txlock=immediate`), so parallel writers wait for the lock instead of failing with `SQLITE_BUSY` (FLAW-23).
- Multi-step database changes (deleting folders/task lists/accounts, shares, password reset) run atomically in transactions and report write errors cleanly (FLAW-14).
- Due alarms give up with a warning after 3 failed delivery attempts instead of sending on endlessly every minute (FLAW-12).
- Better readability (dark text) on the turquoise accent of the `Polarized` theme and correct `rounded-full` display of round icon buttons in square themes.

### Security
- One-time stream tickets instead of long-lived session tokens in WebSocket/SSE URLs; `BASE_URL` limits CORS and WebSocket origins; signing out, changing the password and locking an account cut open live streams right away (FLAW-22).
- Permission checks for all list item endpoints and when turning thoughts into list items (owner or editor required, prevents IDOR and writes by readers) (FLAW-27).
- API keys are strictly limited to their scopes (`webhook:triage`, `webhook:task`, `webhook:list`) and cannot open live streams (FLAW-07).
- Protection against brute force at sign-in (lock after failed attempts per account+IP, account and IP with `429` and `Retry-After`) and explicit configuration of trusted reverse proxies through `TRUSTED_PROXIES` (FLAW-09).
- `DeleteTaskList` checks ownership before unlinking tasks; readers can no longer remove links between note blocks and tasks (FLAW-14).

## [0.4.1] - 2026-10-29

### Added
- Due date with an optional time (`YYYY-MM-DDTHH:MM`); alarms take the time (or 09:00 for all-day tasks), the lead time (`notify_before_minutes`) and the time zone (`TZ`, default `Europe/Berlin`) into account (FLAW-12).
- Trash for notes (`GET/POST/DELETE /documents/trash…`): deleted notes and folders go to the trash, disappear from tree, search and export, and can be restored or deleted for good by their owner.
- Backlinks at the end of a note (`GET /documents/{id}/backlinks`): shows all accessible notes and bullets that point to the current note with `[[Title]]`, with a direct jump to the bullet.
- "Forgot password?" on the sign-in screen (if SMTP and `BASE_URL` are set up): a one-time link by email (SHA-256 hash stored, valid for 1 hour), resets the password and ends all existing sessions.
- Offline-capable PWA: a service worker keeps the app shell, data read is cached per user in IndexedDB, and thoughts captured offline as well as ticked tasks/list items are synced through an outbox when the connection returns.
- Two new dark themes: `Polarized` (obsidian & turquoise/emerald) and `Suri` (midnight plum & orchid).

### Changed
- `internal/storage/sqlite.go` and `internal/api/server.go` split into domain-specific files without changes in behaviour (FLAW-20).

### Security
- Without `JWT_SECRET` set (or with well-known placeholders) the server creates a random 32-byte secret once in `data/jwt.secret` (`0600`) instead of using a publicly known default secret (FLAW-04).
- SSRF protection for Discord and custom alarm webhooks: only `https`, host check for Discord, blocking loopback/link-local/cloud metadata during DNS resolution; private networks and `http` only through an explicit admin switch (`allowPrivateWebhooks`) (FLAW-05).
- A unified authentication check for the middleware and the webhook ingest including the block list, `token_version` and an active account; API keys may no longer call read or management endpoints (FLAW-07, FLAW-08).

## [0.4] - 2026-10-29

### Added
- Data import with a preview (`?preview=1`) and size/path limits: restoring or adding MindSift backups (JSON, ZIP or Markdown archive via `POST /import/mindsift`) and importing whole Obsidian vaults as ZIP (`POST /import/obsidian`).
- Full data export as a compressed ZIP archive too (`GET /export?format=zip`).
- Recurring tasks (`daily`, `weekly`, `monthly`, `yearly`): completing a task automatically creates the next instance on the following date.
- Danger zone in the account settings: delete your own data (`DELETE /user/data`) or your whole account (`DELETE /user/account`) after confirming the password (the last server admin is protected from deleting themselves).
- PWA splash screen and automatic matching of the status bar colour (`theme-color`) to the active theme.

### Fixed
- Sending mail falls back to `AUTH LOGIN` when the server refuses `AUTH PLAIN` (e.g. Postfix/Dovecot or Exchange); the port field in the admin settings can be cleared and saved without a type error.
- Mobile: form sheets (`FormSheet`) and the emoji picker position themselves above the on-screen keyboard (`visualViewport`).
- Older databases are no longer emptied at start by the former schema reset.

## [0.3] - 2026-10-29

### Added
- Organizations and visibility modes (`private`, `organizations`, `open`), managed by server admins; they decide centrally who sees whom in the user search and with whom content can be shared (FLAW-10, FLAW-24).
- Task assignment (`assignees`) in shared task lists, a unified user search (`UserAutocomplete`), avatar stack (`AvatarStack`) and round counter badges (`CountBadge`).
- Custom CSS themes per user (`GET/POST /themes`, `DELETE /themes/{id}`): upload or paste a `.css` file, download the template and switch live.
- Global full-text search across thoughts, tasks, notes and list items based on SQLite FTS5 with BM25 ranking, permission checks and a `⌘K`/`Ctrl+K` command palette (FLAW-18).
- Obsidian-compatible Markdown export (`GET /export/markdown`) as a streamed ZIP archive of all notes, folders, task lists and lists.
- Full emoji choice for note icons (lazy loading, as a bottom sheet on the phone).
- Optional links/texts for the legal notice and privacy policy (`LEGAL_IMPRINT_*`, `LEGAL_PRIVACY_*`, `GET /legal/{imprint|privacy}`) and an "About MindSift" dialog.
- Published under [The Unlicense](LICENSE) (public domain, FLAW-21).

### Changed
- **Attention:** only owners can share resources (task lists, lists, notes, folders); the old field `task_lists.team_id` and the unprotected `/organizations` routes are gone. When visibility goes away (e.g. through a change of organization), shares, group memberships and assignments are cleaned up automatically (FLAW-06, FLAW-10, FLAW-24).
- Demo mode cleanly resets and refills the database on every server start.

### Fixed
- SMTP client with an explicit protocol flow (`EHLO` with the sender domain, `STARTTLS`, `AUTH`, RFC 2047 headers, `SMTP_SKIP_VERIFY` for self-signed certificates).
- Tailwind opacity modifiers (`bg-accent/15` etc.) work with all theme variables through `color-mix()`.
- Mobile and desktop improvements: silent reloading of task lists without swallowing clicks, `#` anchors in URLs are no longer recognized as hashtags, multi-line task notes fully scrollable in the dialog.

## [0.2.1] - 2026-10-28

### Added
- Notes: after turning a `/todo` bullet into an expanded task, the task opens right away; a click on the "Expanded" badge opens the task dialog.

### Changed
- The container build also tags release images (`v*`) as `:stable` and `:latest`, the `dev` branch as `:dev`.

## [0.2] - 2026-10-28

### Added
- Realtime collaboration in notes (`internal/collab`, `frontend/src/lib/docSync`): a server-authoritative operation log (`doc_ops`) with a tree structure, fractional indexing order keys, 20-second block locks (leases), an offline queue in IndexedDB and automatic transport fallback (WebSocket → SSE → long polling → interval polling).
- Notes and folders can now be shared with write access ("edit") too (FLAW-17).
- Visible block locks with the name of the person editing, presence display in the note header, conflict copies ("accept" / "discard") instead of data loss on simultaneous changes, and per-user undo/redo (`Ctrl/Cmd+Z`, `Ctrl+Y`) across the whole note (FLAW-25, FLAW-26).
- Automatic background compaction of the operation log and clean-up of deleted blocks (tombstones) after 30 days.
- Outliner: `Backspace` at the start of a line merges the bullet with the previous one; `#hashtags` are rendered right in the text as clickable chips; a click into a bullet puts the cursor exactly at the clicked spot in the text.
- Vitest + Testing Library in the frontend build and Playwright end-to-end tests (`e2e/`) for live collaboration, locks and proxy fallbacks.

### Removed
- **Attention:** the old whole-note overwrite (`PATCH /documents/{id}/blocks`, `DOC_BLOCKS_PATCHED`) is removed; all block changes go through `/docs/{id}/sync`.

### Security
- Realtime events (`BroadcastToAll` removed) and WebSocket/SSE rooms are strictly limited to authorized, signed-in users; `ReorderTasks` checks write rights (IDOR fixed); SSE streams are no longer cut after 30 s by `WriteTimeout`; block upserts check that the block belongs to the document (FLAW-01, FLAW-02, FLAW-03, FLAW-11, FLAW-15).

## [0.1] - 2026-10-27

### Added
- First published version of MindSift as a single self-hosted container (Go backend, embedded React/TypeScript/Tailwind frontend, SQLite in WAL mode).
- Quick capture (quick dump with `C`/`/`, voice input, multi-line with `Shift+Enter`, direct choice of target) and triage deck (keyboard shortcuts & swipe gestures on the phone).
- Task management with several lists, a freely configurable Kanban board, priorities, due dates, subtasks with progress bars, Markdown notes, filters/grouping and due alarms by email (SMTP), Discord and your own webhook.
- Hierarchical outliner workspace with folder tree, drag & drop of whole branches, zoom focus with breadcrumbs, slash commands (`/todo`, `/link`, `/h1`–`/h3`, `/code`, `/callout`, `/divider`), wiki links `[[Note]]`, `#hashtag` overview, global to-do rollup and `.md` export.
- Shared lists (shopping, packing and checklists) with `#category` grouping, quantities and realtime ticking off.
- User, group and admin management (first-time setup wizard, invite codes, avatars, personal API keys & webhook ingest `/api/v1/webhooks/ingest`, JSON data export) plus a CSS theme engine with 4 themes (`Dark`, `Light`, `High Contrast`, `Soft`) and PWA support.
