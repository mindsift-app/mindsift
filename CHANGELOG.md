# Changelog

All notable changes to MindSift are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and from v0.6.0 on the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the major version is 0, the API and data formats can change with any minor version; such changes are listed under "Changed" or "Removed" and marked **Attention**.

Versions without a git tag were development states and were never published as a versioned image. Versions before 0.80.0 are in [CHANGELOG-archive.md](CHANGELOG-archive.md).

## [Unreleased]

### Changed
- Deleting an account or an organization, taking someone out of one, or a stricter sharing mode now only makes the apps of the people whose shares or groups changed load their lists and notes again, instead of everyone who is online.
- Signing up and redeeming an invitation now ask for the password twice, like setting a new password everywhere else: the repetition turns red as soon as it differs, and the account is only created when both match.

### Fixed
- Renaming a folder inside a shared folder, or moving a folder into or within one, no longer creates a subfolder of the same name inside it ("Team/New/New"); its subfolders now end up directly in the renamed or moved folder. Duplicates made before stay and can be deleted.

## [0.99.3] - 2026-11-24

### Added
- When someone adds you to a group, you get a notification ("Anna added you to the group “Family”"), with the same settings and channels as a share. Being removed from a group tells you nothing.

### Changed
- "New group" opens like the other small dialogs: a sheet above the keyboard on phones, a centred window on desktops.
- Every form that sets a new password (first setup, reset link, the password the administration asks for, security settings) frames the repetition red and says so as soon as it differs from the new password.
- The sharing, link and "Manage columns" dialogs have the same header as the sheets, with a close button large enough to tap on phones.
- Tasks: Escape while editing the title only cancels the edit; after a change it no longer also asks about unsaved changes.
- Desktop app: `LOG_FORMAT=json` writes its log as JSON lines like the server's, and `MINDSIFT_DESKTOP_DEVTOOLS` takes the same yes/no values as the server's variables.
- Desktop app: taking over an account from a server's backup is now recorded in the audit log (Administration → Log), like the other changes to backups.
- Notices at the bottom of the screen (Undo after deleting, errors, "Gespeichert", the offline notice, the confirmation of a new e-mail address, the hints after a dictation) now stack one above the other instead of covering each other, and all look the same. On phones, the confirmation of a new e-mail address now appears at the bottom like the other notices.
- Loading and empty states look the same everywhere: one spinner with a short text ("Wird geladen …", "Notizen werden geladen …") and one muted line when a list is empty, a smaller one in menus and search popovers ("Keine Treffer").
- Settings and administration: every page uses the same cards and rows, with the same spacing, titles and short hints; the profile picture, the alarm channels and the downloads under Data now sit in cards like the rest.
- Shorter hints in the settings: deleting your data or account, the sharing mode "within organizations" and removing someone's e-mail address now say it in one short sentence; the details are in the help (Offline, backups & password; Organizations, groups & sharing).
- The trashes of notes, tasks and the Quick Dump look and work the same: one list with "Wiederherstellen" and a bin per entry. Deleting an entry for good and emptying the trash now ask at the click instead of a second tap on the same button; in the task trash, deleting an entry for good no longer happens without a question. The buttons are large enough to tap on phones.
- Texts of running actions follow one pattern, like "Wird geladen …": "Wird gespeichert …", "Wird hochgeladen … 25 %", "Testmail wird gesendet …" instead of "Speichere…", "Lade hoch…" or "Sende…"; the other languages use their usual short form throughout.
- Settings → Data: replacing your data with one of your server backups now asks with the same red warning and tick box as an import, instead of a second click on the button, and afterwards shows what came back and the entries left out, like an import. The desktop app's take-over of a server account lists the entries left out too.

### Fixed
- When the administration takes someone out of an organization, deletes an organization or an account, or makes the sharing mode stricter, the lists, task lists, notes, folders and groups that went with it disappear from the overviews of the people concerned within a few seconds; before, only after reloading.
- Groups page: when someone else adds or removes a member, changes a role, renames or deletes a group, the page of the other members follows right away; before, they saw the change only after reloading.
- The number of open entries of the other lists in the list overview now follows changes made by others within a few seconds; before, it stayed until the lists were reloaded. Opening such a list loads its current entries.
- Security: someone drawing along in a live drawing whose share was changed to read-only could keep changing the drawing for a few seconds. Their changes are now refused within a second, and they are taken out of the session.
- Phones: more controls are large enough to tap (44 px): the filters, clear button and "Fertig" of the search, the journal calendar, the "App" button in the header, the profile sheet's menu and theme choice, sharing a list, "Aufgabe hinzufügen" in Kanban columns, the hashtags in the notes, links back to a note, the card menu of the Quick Dump, and the small controls in rows (a task's tick box, quantity and bin of a list entry, the arrows of a Kanban card, a note's icon), which keep their look.
- Phones: the footer links (Imprint, Privacy, "Über MindSift") take taps in 44 px instead of only on their 17 px of text.
- Journal: the calendar symbol beside a day's title is a plain symbol now, no longer a button that did nothing (it was tabbable and announced by screen readers); the calendar opens with the button in the journal header.
- Adding someone to a group, removing them or deleting the group now shows or removes the group's task lists, lists, notes and shared folders right away for the people concerned; before, they saw the change only after reloading.
- Renaming a list or giving it a new icon now shows in the list overview of everyone who shares it, also when they have another list open.
- Security: someone who lost access to a list or note (share removed, removed from a group, list or note deleted) kept receiving the list's new entries and the note's live drawing on a device that stayed connected, until it reconnected. They are now cut off at once, and a live drawing they were in is left.
- A task list created for a group now shows up right away for the group's members and on your other devices; before, they saw it only after reloading (lists created by an AI agent already did).
- Deleting a shared list, or taking someone off it, now removes it from the list overview of the others at once, even when they had another list open; before, it stayed there until they reloaded.
- Someone @-mentioned in a new note (made from a template or by an AI agent, in a shared folder) is now told, as when a mention is added to an existing note. Before, they heard nothing, and a later edit of that bullet told them instead.
- Phones: the fields and buttons of the sign-in, invite and sign-up forms and of the groups page are 44 px high, and the fields use a font size that keeps iOS from zooming in.
- Phones: the buttons on top of a task's details, the role of a group member, the quantity field of a list entry being edited, the SMTP test and save buttons and the Whisper server address in the administration are 44 px high, large enough to tap.
- Yes/no settings in the environment now all take `true`/`false`, `1`/`0`, `yes`/`no` and `on`/`off` in any case, as the README says. Before, some only took `true`: `ALLOW_REGISTRATION=1` or `SMTP_SKIP_VERIFY=yes` did nothing, and `SMTP_TLS=0` or `SMTP_TLS=no` left TLS on; `LOGIN_PROTECTION`, `STT_DISABLED` and `STT_ALLOW_BROWSER` behaved the same way, and the switches the administration can lock (such as `MCP_ENABLED` or `PUBLIC_LINKS`) ignored `on`/`off`. Only setups that wrote these values another way than `true`/`false` are affected. A value that is no yes/no, or a number such as `DEMO_RESET_MINUTES` that is no whole number, is now named in a warning in the log instead of being ignored silently.
- Security: moving, merging or extracting bullets, adding pictures or hidden values and transcribing a recording in someone else's note answered "no write access" while a missing note answered "not found", which told whether the note exists. Both now give the same "not found"; "no write access" is left for notes shared with you for reading. Merging someone else's or a missing note into your own, or taking back the extraction of one, failed with an internal error that showed a database message; it is "not found" now too.
- API: requests whose body may be left out (confirming with the password, two-factor and passkey settings, emptying done tasks or the task trash, confirming a restore, the test e-mail, OpenID Connect sign-in) now refuse a body that is not valid JSON with "invalid request"; before, a broken body was taken as if nothing had been sent.
- A repeating task ticked off while the phone was offline gets its next date from the day it was ticked, not from the day the phone came back online.
- Notes made, renamed, moved or deleted on another device while the connection was down (phone asleep, network switch, server restart) now show in the note list as soon as the connection is back; before, the list stayed as it was until the page was reloaded.
- The journal's calendar starts the week like the date fields and the task calendar: on Sunday in English (US), on Monday in German. Before, it always started on Monday.
- Settings → Profile: the ring around the profile picture follows the theme's accent colour; before, it had no colour at all.
- Importing or restoring a backup: the heading above the section switches ("Bereiche") is now shown in the chosen language.

## [0.99.2] - 2026-11-23

### Changed
- Escape now closes only what is on top: a menu or list inside a dialog first, then a dialog opened from another one, then the one below. Before, one Escape could close several at once (for example a task opened from a calendar day together with the day's sheet). The sharing dialog, "Manage columns" and "New group" now close on Escape too.
- A tap or click beside an open menu, list or popover only closes it and no longer reaches what lies below (on phones, tapping beside the notification list could open a task). The expanded navigation rail and the people suggestions under a field keep passing the click on.
- Phones: the view's menu under the header closes like the other menus (a tap beside it only closes it, Escape too), the page behind it no longer scrolls, and its close button is large enough to tap.
- Phones: the emoji picker is a sheet from below like the other sheets (grip, title with the current icon, close button, "Remove icon" as a row at the bottom).
- Notes: "Collapse all bullets" (note menu, Ctrl+Shift+↑) now collapses only the top level of what you see: the note's top-level bullets, or, zoomed in, the bullets right below the zoomed one. Deeper bullets keep their state, so zooming into a heading afterwards shows its sub-bullets as open or closed as before; collapse again there to fold that level. "Expand all bullets" still opens everything in the view at any depth.
- A focused drawing in a note, a selected image and a recording held on the + follow the same order: Escape or a press beside a menu opened above them closes that menu first and leaves the drawing focused; Escape that closed a menu no longer also clears the notes marked in the explorer; and a field or list that takes Escape itself keeps a running recording going.
- Notes: Escape with text selected across several bullets now only ends the selection; before, in focus mode it also left focus mode. The slash menu, like other menus, closes on a click beside it, and the click still places the cursor where it lands.
- Quick Dump: with the options open, the first Escape in the field only closes the options; the next one empties the field (and closes the Quick Dump window) as before. Before, one Escape closed the options and emptied the text at once.

### Fixed
- Dictations held on the + whose recording is already on the server no longer make the browser ask before the page is reloaded or closed; the server finishes them anyway. Recordings not yet uploaded still ask.
- Desktop app: "Switch instance…" in the tray, Ctrl+Shift+O, F5/Ctrl+R, the window's close button and "Quit" in the tray no longer throw away a recording or dictation still under way: the app asks first ("Reload anyway", "Quit anyway" … / "Stay"). If the page does not answer (for example a server with an older version), the action runs after a second as before, and repeating it a few seconds later while the question is still open runs it anyway.

## [0.99.1] - 2026-11-23

### Changed
- Desktop app (local instance): watching tasks is gone, since nobody else changes your tasks there: no "Watch" button in a task's details, no "Watched tasks" row in Settings → Alarms, no switch for your own changes, and no help text about it. Tasks watched earlier stay quiet. Servers and browsers are unchanged.
- Settings → Account settings: the intro line under the title is gone; the sidebar names the sections anyway.
- A background transcription that failed because the Whisper server was unreachable or had a problem of its own is now tried again by itself after 5 minutes, 1 hour, 6 hours and 24 hours, so recordings catch up once the server is back. A time limit or a recording the server refused is not retried by itself; "Try again" still works any time. A failed recording in a note or in the inbox shows when the next automatic try comes ("Next try at 14:35").
- A failed background transcription is cleared 30 days after its last attempt, counted from the last automatic retry if one is still planned. A recording in a note stays in the note and can be transcribed again; a failed recording dictated into the inbox is deleted together with its audio, so try it again, listen to it or discard it before then. While speech recognition on the server is switched off, recordings still waiting for it (also ones with an automatic retry planned) are cleared the same way 30 days after they were sent or last tried.
- Notes written by AI agents through MCP now put commands, code, config files, JSON/YAML, SQL and log excerpts into code blocks with a language (one block per command sequence, not one bullet per line), and show paths, flags, file names and single commands in text as `inline code`.
- The Flatpak of a release (the download on the release page and flatpak.mindsift.app) is now built from the release tag the way Flathub builds it: offline, with the frontend, the Go modules and the license file built from source inside the Flatpak SDK.
- The page behind dialogs, sheets, the command palette and Quick Dump is now dimmed in the theme's own overlay colour instead of a fixed black, so light themes stay lighter.
- All sheets from below on phones look and behave the same: a grip on top, a close button large enough to tap, the page behind does not scroll, and Escape closes them (Quick Dump, new task, task filter, profile, app install, calendar day, triage actions, a person in the administration).
- Listing tasks through MCP (`list_tasks`) or with filters through `GET /tasks` now reads only the tasks asked for from the database, so it answers faster for people with many tasks; the results are the same.
- Small forms opened next to a click (new folder, rename) flip above the click when there is no room below instead of running off the window.
- Phones: the Quick Dump and new-task sheets now sit right above the on-screen keyboard like the other small forms, so it no longer covers their lower fields, and their buttons are as large as elsewhere (44 px), with Cancel and Create side by side over the full width.

### Fixed
- Sending an invite by e-mail now checks the address like everywhere else in the app: an incomplete one such as `anna@` is refused instead of binding a single-use invite to it.
- An inbox entry turned into a note now shows up in the note list on your other devices and for people it is shared with right away, as it already did when an AI agent converted it; before, they saw it only after a reload.
- A recording sent for transcription no longer stays at "Transcribing…" until a reload when the server finished or failed on it very quickly; the message that another attempt follows now shows reliably.
- Slash commands now work anywhere in a bullet that already has text, not only at the end: typing `/code`, `/h2`, `/todo`, `/table` and the other block types at the start or in the middle of the text opens the menu and turns the whole bullet into that type. Only the typed command is removed, the rest of the text stays exactly as it was, the cursor stays where you typed, and Ctrl+Z undoes the change in one step. Dividers, pictures, voice notes and drawings still need an empty bullet.
- Ctrl+Z after a slash command now takes back the command and the typed `/command` together: the bullet is again as it was before you typed the slash, instead of showing `/code` (or the other command) and needing a second Ctrl+Z. Ctrl+Y brings the command back.
- A code block written as a list item (```` - ```bash ```` with the code indented below it) in Markdown from AI agents (MCP), imports or pasted text now becomes a code block at that bullet's level. Before, the fence ended up as bullet text, the code was lost or split, and the bullets after it could be swallowed into a code block. A fence without its closing line now ends at the next bullet that is indented less.
- The Flatpak shows screenshots in GNOME Software and Discover.
- A dictation or recording in progress is no longer lost by accident. Reloading the page, closing the tab or leaving the site while one is running or not yet saved now lets the browser ask first (not in the desktop app, which has no reload of its own). The browser's back and forward buttons, the mouse's back button and Android's back gesture ask too ("Switch anyway" / "Stay") and otherwise stay where you are, and closing the task dialog, the new-task sheet or the Quick Dump sheet on phones while dictating asks "Close anyway" first. Audio recordings in notes (`/audio`) are now covered as well, also when switching to another note.
- Working only in notes, or with live updates by long polling, now keeps you signed in like the rest of the app does, and a session that ended there is cleared like everywhere else (the desktop app then signs in again by itself).
- An audio recording in a note (`/audio`) is no longer cut off when the app reloads itself for a new server version: like a dictation, it now holds the automatic reload back until it is saved.
- Desktop app: "Switch instance" in the profile menu now asks first ("Switch anyway" / "Stay") while a dictation or recording is under way, instead of throwing it away.
- Triage: while the actions sheet of a card ("More options") or another dialog is open, the keyboard shortcuts (arrows, H, L, D, T, Space) no longer sort the card behind it.
- A task whose database row had no value (NULL) for its due date, its link to a note or its triage time, which can only come from a manual database edit or an import by another tool, was missing from every task list. It is now shown like any other task, and a one-time database update at startup fills those empty values.

## [0.99.0] - 2026-11-22

### Added
- **Restore the whole server from the administration:** Administration → Data → "Restore" on a backup puts back all data, with pictures and recordings, without stopping the server. MindSift first checks the backup and backs up the current state (listed as "before a restore", so a restore can be undone), then swaps the data and reopens itself; the page reloads by itself. If the restored data do not open, the previous data stay. The restore is recorded in the audit log. In the desktop app the same restores a local instance from its backups.
- **Move to a new server with one file:** each backup downloads as one complete `.tar` file (also several GB, straight to disk), and Administration → Data → "Upload backup" on the new server loads it and restores it. The upload goes in chunks with a progress bar, resumes after an interruption and works behind reverse proxies with a body limit; the file's checksum is checked before the restore. The backup includes the key of the encrypted values (`secrets.key`), so hidden values, authenticator codes and the SMTP password keep working on the new server; keep backups as safe as the data themselves. `BACKUP_EXCLUDE_SECRETS_KEY=true` leaves the key out (Administration → Data then says so, and you keep the key separately); a key set with `SECRETS_KEY` is never in a backup. If the encrypted values of a backup do not open with the server's key, the restore asks before it goes on. The largest upload is set with `RESTORE_UPLOAD_MAX_GB` (default 100).
- Desktop app: alarms of a local instance can now come as **system notifications** of Linux or Windows while the app is open, in place of web push, which the app's window does not have. Settings → Alarms has a new "System" column (task alarms, the daily summary and the other events) and a button that shows a test notification; clicking a notification brings the window to the front and opens the task. New local instances, and instances whose alarm settings were never saved, send task alarms this way by default. On Linux this works with GNOME, KDE and other desktops with a notification service, also in the Flatpak (through the notification portal, no extra permission); the Windows version is not yet tested on a real machine.
- The Linux desktop app now has its own signed Flatpak repository, so it updates through GNOME Software, KDE Discover or `flatpak update` like any other app: `flatpak install --user https://flatpak.mindsift.app/app.mindsift.MindSift.flatpakref` (or add the repository with `flatpak remote-add --user mindsift https://flatpak.mindsift.app/mindsift.flatpakrepo`). Every release lands there automatically; the runtime still comes from Flathub. The Flatpak file on the release page stays available.
- With your own Whisper server, transcriptions now run **in the background on the server**, so a slow server no longer makes you wait on the page and switching notes, closing the app or a restart of the server loses nothing. "Transcribe" on a voice note shows "Transcribing…" wherever the note is open (also after a reload or on another device), and the text appears in its caption by itself; a caption you write meanwhile is kept and the text added after it. A dictation by holding the + is stored on the server as soon as you let go, and the server puts the entry into the Quick Dump even if you have closed the app. Recordings that are still being transcribed show above the Quick Dump; if the speech recognition fails (it tries twice more by itself), the recording stays there and you can try again, listen to it or discard it.
- Dictating into a text field (the microphone in input fields, `/diktat`) and then switching to another view or note now asks first ("Switch anyway" / "Stay"), since the dictation would be lost.
- Desktop app: **Take over an account from a server backup** (Administration → Data) now brings the account's **pictures and recordings** along. Choose a copy of the server's data folder or of its `backups` folder, packed as .zip, .tar or .tar.gz; the media come from the server's `media` folder or from the account's own daily backup. The preview says how many pictures and recordings come along and how many the backup lacks. A database snapshot (.db.gz) alone still works, without media.

### Changed
- Account settings and the administration explain much less: most hints are now one short line or gone, page intros are a single line or left out, and nothing mentions accounts, sharing, push or the container where the instance does not have them (such as the desktop app's local instances). What importing an Obsidian vault brings along is now in the help.
- **Daily backups are now complete:** the automatic backup (and "Back up now") holds the whole database plus every picture and recording, instead of the database alone. Pictures that did not change are shared between backups (hard links), so keeping several days costs hardly more space than one. The accounts' own backups stay separate as before. Older database-only backups (`.db.gz`) stay in the list and can still be downloaded and restored (database only). `mindsift check --backup` writes a complete backup too. If you copy `data/backups` elsewhere, keep hard links (`rsync -H`), otherwise each backup takes its full size there.
- Desktop app: taking over an account from a server backup also accepts a complete backup as downloaded from the server's administration (`.tar`), with the account's pictures and recordings.
- Desktop app: taking over an account from a server backup now brings the **hidden values** in its notes along when the backup contains the server's key (complete backups do, and so does a copy of the data folder). They are re-encrypted with the local instance's own key. Without the key in the backup (a `.db.gz` snapshot, or a backup made without the key) they still stay behind and the preview lists the affected notes.
- Administration → Data has shorter texts: one line each for the daily backups (with their time), the backup folder and taking over an account. In the desktop app the page no longer shows the switch for keeping done and deleted things for good: with one person on the instance, you decide that yourself in Settings → Retention, where "never" is always available.
- With your own Whisper server, **live dictation goes ahead of transcriptions running in the background**: a dictation no longer waits behind a queued voice note or Quick Dump recording, or fails with "busy". A transcription already running is finished first (with one parallel transcription, the default, a dictation waits for at most that one recording or one part of it); recordings for the Quick Dump let a dictation in between their parts. With `STT_MAX_PARALLEL` at 2 or more, background transcriptions always leave one place free for dictation. Background transcriptions still finish while you dictate a lot.
- The Flatpak file on the release page (`mindsift-desktop-linux-amd64.flatpak`) now gets updates too: installing it with `flatpak install --user mindsift-desktop-linux-amd64.flatpak` also sets up the signed MindSift Flatpak repository, so later releases arrive through GNOME Software, KDE Discover or `flatpak update`. Pre-releases are not updated this way. If you installed the file of v0.98.0 or earlier, install the new file (or from the repository) once and remove the old version with `flatpak uninstall --user app.mindsift.MindSift//master`; your data stays.
- New accounts on an instance without sharing (the desktop app's local instances, servers with sharing set to private) now get the help note about sharing again, as a short version: it says that sharing with other people needs a MindSift server with several accounts and sharing turned on, and that this instance does not offer it (in the desktop app: connect it to a server; on a server: the administration has turned sharing off), instead of describing share buttons that do not exist. Available in all five languages.
- The desktop app's first start no longer opens the form for a local instance right away: it shows "Create a local instance" and "Connect to a server" side by side, and nothing is created before you choose. If you only use a MindSift server, you go straight to it. Later starts still open the instance or server used last.
- Voice notes on phones no longer show indent and outdent arrows next to the player, so its time bar keeps its full width. Tap the caption below the recording and use the bar above the keyboard to indent, outdent or move the voice note, as for code blocks. Computers keep the arrows after the player.

### Fixed
- The **level meter while recording or dictating** (voice notes, holding the +, dictation) moved only weakly in some browsers, notably in the Linux desktop app. It now follows the loudness on a decibel scale with an automatic gain, so normal speech at an ordinary microphone level fills the bars visibly, silence stays flat, and the bars rise quickly and sink gently. Dictation's pause detection is unaffected.
- The action bubble of a voice note (link, extract, delete) no longer covers the right part of the player (time bar, volume, menu): it now floats above the voice note, over the gap and the bullet above it (or the title, for the first bullet), without adding any space (44 px buttons on phones).
- Desktop app: the setup wizard showed and re-saved the subfolder MindSift writes into (`…/MindSift-Backups/<instance>`) when a backup folder was already set, which could nest the folders further; it now shows and keeps the folder you chose. A "Saved" notice and the desktop app's "file saved" notice no longer appear on top of each other; they stack.
- Voice input where the window has no speech recognition of its own (the Linux desktop app, Firefox): the message no longer blames "this browser" but says that voice input is not available here and that a Whisper server (Administration → Voice input & AI) provides it. With a Whisper server, a browser choice made on another device no longer switches voice input off here: Whisper stays in use, and the "Browser" option in the account settings is greyed out with a note. A microphone that stayed open when the browser refused to start a recording is closed again.
- Desktop app on Windows: the window title now follows the page shown on a server too. Going back or forward to a server's page, or a server's page leading to another server or site, left the title of the page before (e.g. "MindSift" from the start view) instead of the server's name.
- Downloads in the desktop app on Linux (backups, the Markdown archive, automatic backups, a note as Markdown, themes) did nothing: the button flickered and no file was saved, in the Flatpak not even in the Downloads folder. The app now asks where to save with the system's save dialog and shows a short notice when the file was saved or could not be. On Windows, WebView2's own download bar stays as it was.
- The desktop app's Flatpak showed a backup folder chosen in the folder dialog as `/run/user/1000/doc/…`; it now shows the folder as you chose it (for example `~/Backups`). The backups still go to the same place.
- Clicking "Back up now" twice in a row could make two backups; a second click while one is running now waits for it instead. The download buttons of backups wait while their file is being fetched, too.
- An image dropped onto a note (or anything typed or pasted) right after opening the note's page is kept: it showed up and vanished again a moment later when the note's sync had not loaded yet, which happened most often in Safari and other WebKit browsers, also in the desktop app on Linux.
- Voice notes in a note now start right at their bullet: the indent and outdent arrows sit after the player (and the transcribe button) instead of keeping an empty gap in front of it while the pointer is elsewhere, on computers and phones.
- Recording a voice note in a browser that cannot record (no MediaRecorder or microphone access in it at all) now says that recording is not supported there, instead of claiming there was no access to the microphone. Denied permissions, a missing microphone and pages not served over HTTPS still show the microphone message.
- Pressing Enter in the caption of an image or a voice note now goes on in a new bullet below, like Enter at the end of a text bullet; Shift+Enter only leaves the caption.
- Long captions of images and voice notes (such as a transcript) now wrap instead of running out of the field: while editing, the whole text shows; otherwise a long caption is cut to two lines with "…", and "more" (or a click into it) shows all of it.
- Voice notes in notes play properly in the Linux desktop app: the player shows the length right away, the playhead moves along and you can jump to any point. Before, the player guessed a length of a fraction of a second, stopped its playhead there while the sound went on, and only knew the real length at the end; Chrome showed no length until the end either. New recordings are saved with their length, older ones get it when they are played.
- Voice notes recorded in the Linux desktop app no longer show a length of many hours (such as "34:25:12") and no longer jump to that end while playing: the app records with a clock that starts hours in, and those times are now moved to start at 0 when saving and when playing, also for voice notes already recorded. The player there also shows the length before playing instead of a spinner, recordings waiting above the Quick Dump included.
- The level wave while recording a voice note in the Linux desktop app no longer keeps dropping to nothing and back while you speak.
- A voice note stops playing when you leave the note, and starting one voice note pauses another that is still playing. In the Linux desktop app a voice note went on playing after switching notes, and pressing play again started it a second time that could no longer be stopped.
- Stopping a voice recording no longer seems to hang: "Saving" shows at once, and if the browser takes long to finish the recording (seen in the Linux desktop app), what was recorded until then is saved after at most three seconds. This also applies to dictation with the own speech recognition server.

## [0.98.0] - 2026-11-22

### Added
- Desktop app for Linux and Windows (`desktop/`): MindSift in its own window, either **local** without a server (the server runs inside the app and opens no port; several local instances, each a folder in the app's data directory) or **connected to a MindSift server** (several servers can be listed). A start view lists instances and servers; a new local instance asks a few setup questions (backups and their folder, language, time zone) and signs in on its own, without an account to set up. Things that need a server or other people (sharing, invitations, email, push, passkeys) are hidden in a local instance. A switch in Settings → API makes a local instance reachable for programs on the same computer (MCP and the API with a key, on 127.0.0.1 only), off by default. Linux builds come as a Flatpak and as a program file, Windows as an installer (per user, no admin rights; uninstalling keeps your data) or a portable exe; the Windows builds are **experimental** for now, they have not been tried on a real Windows machine yet. Each release page has all four (`mindsift-desktop-linux-amd64.flatpak`, `mindsift-desktop-linux-amd64.tar.gz`, `mindsift-desktop-windows-amd64-setup.exe`, `mindsift-desktop-windows-amd64.exe`), with their checksums in `SHA256SUMS` and the licenses of the third-party software they contain.
- A local instance of the desktop app can take over one account from a server's database backup (Administration → Data): pick the backup, choose the account from the list (with its numbers of notes, tasks and lists), check the preview, then take it over. Only what that account owns comes along, and if you like its personal settings; other accounts, things others shared with it and the server's settings stay out, and the instance keeps its one account.

### Changed
- The administration is now called "Administration" and its "Server" page "Instance" (the same pages serve the desktop app). Servers whose mail is switched off (`SMTP_DISABLED`) no longer offer email as an alarm channel or the mail server settings, and servers with sharing set to private no longer create the help note about sharing for new accounts.
- A local instance of the desktop app no longer shows the "Live" indicator above notes, tasks and lists: nobody else reaches it, so there are no changes of others to wait for.

### Fixed
- Personal backups (the daily ones and the downloaded backup) held only 200 tasks and inbox entries; they now hold all of them, plus the tasks others added to your own task lists, so restoring such a list no longer loses them.
- Text dragged onto a note from another program (a browser, an editor) now lands in it: dropped onto a bullet it goes in where it was dropped, several lines become bullets as when pasting, and dropped below the last bullet it becomes a new bullet at the end. Before, nothing happened, in the browser as in the desktop app.
- A file or link dropped somewhere in the app that does not take it (sidebar, header, sign-in page) is now refused instead of opening in place of the app, which left no way back in the installed app.
- Clicking into the text of a bullet in Safari (and other WebKit browsers) now puts the cursor where you clicked; before, it often went to the end of the bullet, and the buttons of a bullet you had just left (bullet, checkbox, collapse) did not react.
- Files and text dragged in from outside over a folder in the sidebar now show that they cannot be dropped there; before, the folder looked like it would take them, though nothing happened.
- **Security:** a page on another website could put text into the inbox of whoever is signed in to MindSift in the same browser, by sending a form to the address the installed app uses for "Share to MindSift". Only shares started by the system's share sheet (or by MindSift itself) are taken now; anything else just opens the app.
- **Security:** in the desktop app, backups written to a folder you chose now go into a subfolder of their own (`MindSift-Backups/<instance>`), and the hourly cleanup of backups of deleted accounts only ever removes folders MindSift wrote there. Before, an old folder named `deleted` with its subfolders in the chosen folder could be removed. A folder that already holds backups directly stays in use.
- **Security:** in the desktop app, taking over an account from a server's database backup checks the file before it is opened (damaged files and files with database parts MindSift does not create are refused) and takes over alarm webhooks and other settings only if the account settings would accept them; those left out are named.
- Restoring or importing a personal backup now says which notes lost their hidden values: a backup holds only the references, never the values, so on another server (or for deleted notes) the notes keep a placeholder, and the preview and the summary list them as skipped with the reason (a backup restored on the same server keeps the values of notes that still exist). The restore of a server backup in the account settings now shows that list, too.
- A `GET` (or `DELETE`) on the MCP endpoint with an API key answered `403` ("not reachable with an API key"); it now answers `405 Method Not Allowed` with `Allow: POST` like with a signed-in session, as MCP clients without a server stream expect.
- The README claimed the administration restores backups "with one click"; only personal backups restore in the app, a whole server is restored by replacing `mindsift.db` with a snapshot.
- Administration → Instance now shows the default language actually in use; it always showed "Deutsch", for example after the setup wizard (or the desktop app's) had set English. The language field of the setup wizards also follows the language the wizard switches to right after opening, so what it shows is what gets set.
- Text dragged onto a bullet that shows an image (or a drawing, a recording or a line) is now taken: its lines become bullets right after it, on its level. Before, the drop was refused.
- A task dragged from the calendar (or a task list) into a text field no longer puts its internal id there as text.
- Right after loading a note's page in Safari and other WebKit browsers (also the desktop app on Linux), the bullets on screen are laid out at once: before, for up to a second a table showed one line high and a click could land in the wrong bullet.
- On a server whose sharing is set to private, notes, folders, task lists and lists no longer offer "Share" (which only answered that sharing is off), and the task list menu no longer shows a greyed-out "Mute" for lists nobody else sees; event notifications about sharing, assigning and mentions and the help about working together are hidden there too.

## [0.97.1] - 2026-11-20

### Fixed
- Deleting a folder that holds shared folders moved into it now deletes it: before, only its sharing ended, while the folder and its subfolders stayed and each further try added an empty "0 notes" entry to the trash. Your own shared folders inside go to the trash with it; folders others share with you go back to the top level.
- A deleted subfolder of a shared folder now goes to the trash as a folder and comes back with its subfolders and notes; before, only its notes landed in the trash. Notes of others in it show up in their own trash.

## [0.97.0] - 2026-11-20

### Added
- Repeating tasks can repeat on weekdays (Monday to Friday): the task done on Friday comes back on Monday.
- Folders can be renamed: "Rename" in the folder's new ⋯ menu opens a small form with the current name; notes and subfolders go along, and a name already used next to it is refused with a message.

### Changed
- A repeating task checked off late skips the dates missed meanwhile: a daily task due Saturday and checked off on Monday comes back on Tuesday, not on Sunday (already overdue). Weekly, monthly and yearly tasks keep their weekday or day of the month; the calendar shows coming dates only after today.
- A folder row in the notes sidebar shows only + (new note here) and ⋯; new subfolder, rename, share and delete are in the ⋯ menu. On phones both buttons are always visible and 44 px tall instead of appearing only after a tap.

### Fixed
- The button of small forms (e.g. "New folder") said "Erstellen" in every language; it now follows the app's language.

## [0.96.2] - 2026-11-20

### Fixed
- A folder that came into being through a note (moved into a new folder path, or made there by an AI agent) no longer disappears when its last note is deleted or moved away; it now stays like a folder made with "New folder". Existing folders of this kind are kept from this version on.
- Notes shared by public link now show a globe in the note list and the "Shared" button above the note; notes inside folders also show the shared mark for people they are shared with, which only pinned notes and notes outside folders did before.
- Underscores inside a word, as in `DOCUMENT_STORAGE_KEY_PATTERN` or `snake_case_name`, no longer turn part of the word italic or bold; `_italic_` and `__bold__` around whole words work as before.

## [0.96.1] - 2026-11-19

### Added
- AI agents (MCP) can add a whole nested block of bullets to an existing note in one step (`add_note_bullet` with `markdown`) instead of one bullet at a time, which made extending notes slow.

### Changed
- Desktop: 8 px instead of 24 px left and right of the main area, so notes, tasks and lists get more room.

### Fixed
- Deleting a shared folder as its owner (in the demo every top-level folder is one) removed only its notes and left the folder behind; now the folder goes to the trash with its notes and subfolders, stops being shared and disappears for everyone it was shared with. Restoring brings it back as a personal folder.
- Moving a folder also renamed folders of the same name of other people on the server.
- Demo: the app speaks each visitor's browser language instead of always English; a language chosen in the settings lasts until the next reset. The sample data stays English (or in `DEFAULT_LANGUAGE`).

## [0.96.0] - 2026-11-19

**The biggest update so far, and a big step towards 1.0.** Draw together live in shared notes, start notes from templates, paste or drag images and code straight into a note, and let MindSift understand dates and quantities as you type. Subscribe to your tasks in your calendar app. Administrators get two-factor sign-in, passkeys and single sign-on, an audit log, an update hint and a command line for emergencies. And it all runs comfortably for over a thousand people at once on a single CPU core.

**Before you update:** read the items marked **Attention**. In short: set your time zone (the server now defaults to UTC), keep `SECRETS_KEY`, keep the pre-migration backup this update writes if you might go back to v0.95.0, and have free disk space of about twice the database's size for the one-time conversion. New servers ask for a setup code from the log. The app needs Safari 16.4, Chrome/Edge 111 or Firefox 128.

### Added
- **Live drawing together** in shared notes, with a host who saves for everyone; opening a drawing alone locks it for others.
- **Note templates** (`/template`, "New note" from a template, also for AI agents).
- **Images and code straight into notes:** paste or drag images, resize them by their corner (kept in copies and Markdown as `![caption|320](…)`); code from ChatGPT, Claude or docs becomes code blocks with their language. Images, drawings and audio get indent arrows.
- **Dates and quantities from what you type** ("dentist tomorrow 2pm", "2x milk"), also when dictating; a personal switch turns it off.
- **Dictation on the +** (desktop rail and phone) locks like in WhatsApp when you slide away; with your own Whisper server you can dictate again while earlier recordings are still being recognised.
- **Calendar subscription** of your tasks for Google, Apple, Thunderbird and Outlook.
- **Drag a single bullet:** an expanded bullet moves alone, its sub-bullets stay; also onto another note in the sidebar.
- **Custom themes in the app:** rename, recolour live with a colour picker, export as CSS, add from the template.
- Lists suggest earlier items; tasks filter by several hashtags; hashtags below the folder tree filter the tree.
- **For administrators:** command line (`docker exec mindsift mindsift …`), audit log, update hint, password reset options, two-factor sign-in and passkeys, single sign-on with back-channel logout, server time zone, backups before database updates, Prometheus metrics, outgoing proxy support.
- **More in the administration:** a Media page (images, compression, audio bitrate and size, uploads, storage per person), imprint and privacy notice, and voice input (mode, Whisper server, limits, chunk interval, and its models: download, choose, delete).
- **For providers:** most of these settings can be fixed through variables that lock them in the administration (`MEDIA_*`, `STT_*`, `SMTP_DISABLED`, `LINK_PREVIEWS`, `PUSH_KNOWN_SERVICES_ONLY`, `ALLOW_PRIVATE_WEBHOOKS`, `BACKUP_*`); `INSTANCE_NAME` and `STT_DEFAULT_MODEL` only preset.
- **AI agents (MCP):** images, moving and extracting bullets, code blocks, notes from templates; sequence diagrams, state diagrams and Git graphs from Mermaid; a `drawing_help` tool.

### Changed
- **Attention:** the server runs on UTC without `TZ`; set your time zone under Administration → Server.
- **Attention:** a new server's setup asks for a one-time code from the log (`setupCode` for `POST /auth/setup`).
- **Attention:** passwords count to the last character and are stored in a new form older versions cannot read.
- **Attention:** notes are stored far more compactly; the update converts them once.
- **Attention:** the SMTP password is stored encrypted with `SECRETS_KEY`. With `SMTP_HOST` set, the environment's mail server applies and Administration → E-mail is locked.
- **Attention:** every `STT_*` and `MEDIA_*` variable now locks its field in the administration. Remove leftovers from the old `.env.example` (`STT_*`, `MEDIA_MAX_AUDIO_MB=50`, `MEDIA_MAX_IMAGE_MB=15`, `MEDIA_QUOTA_MB=0`) to choose in the administration; rename `STT_MODEL` to `STT_DEFAULT_MODEL`.
- **Attention:** audio files in notes are limited to 7 MB by default (was 50 MB).
- **Attention:** the app needs Safari 16.4, Chrome/Edge 111 or Firefox 128 or newer.
- **Attention:** note titles have at most 60 characters.
- **Much more on a small server:** 1,200 people at once on 1 CPU core and 1 GB RAM with 0.03 % errors; opening notes, backlinks, linking and folders do far less work.
- **Desktop redesign** with a navigation rail, Quick Dump as a window and a calmer look; the administration is split into short pages.
- After a server update the app reloads itself, after saving all unsent changes; it waits while you type, record or are offline.
- Offline changes in shared lists and tasks never undo someone else's, and linked to-dos stay in step with their tasks.
- Notes: a dragged bullet takes the level where it is dropped (move right to go deeper); Enter at the start of a bullet adds a line above; tables flow on with Enter; link previews span the note's width; empty rows no longer show indent lines.
- Settings confirm every change with a short notice at the bottom of the screen instead of pushing the page down.
- Setup's "Create sample data" now adds only the help notes (also in Spanish, French and Italian); the demo has many more linked sample notes and a journal.
- The app loads only the texts of your language; MCP descriptions are much shorter.

### Fixed
- **Attention:** usernames are unique; existing duplicates are renamed (`anna` → `anna1`).
- **Attention:** pictures load only from MindSift itself (custom themes lose external backgrounds).
- Alarms, notifications and daily summaries: a failed channel is retried on its own without the others going out twice; a mail server, webhook host or push service that does not answer no longer holds up everyone else; messages still undeliverable after 2 days are dropped and logged.
- Repeating tasks repeat again after their next occurrence was deleted.
- Search finds your own notes even when others have many matches.
- Imports and restores no longer lose data when they fail.
- Typing right after moving to another bullet with the arrow keys no longer puts the first characters into the previous one.
- Clicking after the end of a line puts the cursor behind formatting like `code` or links; dragging inside a zoomed-in branch lands in the right place; the journal opens without stutter.
- Custom themes: text, inputs, borders and status colours follow the theme instead of staying grey.
- Pulling a note back asks first when others link to it.
- Browser voice input passes the full language tag, so Chrome no longer falls back to English.
- Phones: buttons in the settings and back buttons of full-page views are at least 44 px high.
- Demo: the reset countdown no longer gets stuck.
- Many smaller fixes in live drawing, Mermaid drawings, linked to-dos, sharing, reconnecting and translations.

## [0.95.0] - 2026-11-12

Includes the fixes from the security review of November 2026. Please read the items marked **Attention** before updating.

### Added
- **Tables in notes:** `/table` creates a table with a header row. Enter adds a row, Tab and Shift+Tab move between cells, the + next to the table adds a column. The ⋯ menu inserts and deletes rows and columns, aligns a column left, centered or right, and switches the lines (inner lines fading out towards the edge, a full frame, or header and column lines). Wide tables scroll sideways. Tables are Markdown tables underneath, so copying, export, import, search and AI agents (MCP) handle them.
- **Guided tour:** seven short steps through triage, notes (slash commands, blocks, drawings, linked tasks), focus mode, tasks and search, on desktops and phones, without changing any data. New accounts are asked once whether to take it (in the demo, each browser); it can always be started from the help page.
- **First administrator from the environment:** `ADMIN_USER` and `ADMIN_PASSWORD` (optionally `ADMIN_EMAIL`, or the password from a file with `ADMIN_PASSWORD_FILE`) create the first admin on the first start, so a fresh server is never open to whoever reaches the setup wizard first. Unusable values stop the start with the reason in the log. The install script asks for the admin account on a new install, or generates a password and shows it once.
- **Setup wizard:** offers daily backups (on by default, 03:00, kept 3 days), sets up the mail server when `SMTP_HOST` is not set (with a test mail), asks for a missing admin email address, and ends with a summary of what is still open. Fields and buttons are 44 px high on phones.
- **Images and releases:** the image is built for arm64 as well as amd64 (Raspberry Pi, Apple Silicon, ARM servers), has a health check (`/api/v1/health`; `docker-compose.yml` repeats it for Podman) and names its version and description (Dozzle, Portainer, GitHub). Releases carry the server as a single Linux binary (amd64, arm64) for running without a container.
- Administration → Server: "Push only via known push services" limits web push to Google, Mozilla, Apple and Microsoft (off by default).
- The OAuth consent page warns when the way back after allowing access leads neither to a known AI service nor to your own computer.
- Conflict copies in notes: a third choice "Keep both"; until settled, a copy stays right under its original, and while someone edits the original it says who.
- The demo says that it is public: shared accounts, regular reset, nothing private.
- `Doku/api/openapi.json` describes every API route (OpenAPI 3.1); a test checks it against the router.

### Changed
- **Attention:** `JWT_SECRET` must be at least 32 characters long, and example values ever published are refused. In that case MindSift uses its own random secret in `data/jwt.secret` and everyone signs in once more after the update; notes and other data are unaffected. To keep your own secret, set it to the output of `openssl rand -hex 32`. `.env.example` and `docker-compose.yml` no longer contain a placeholder for it.
- **Attention:** a note holds at most 20,000 bullets. Larger existing notes stay readable and editable, they only cannot grow.
- **Attention:** mail alarms, daily summaries and test mails always go to the login address; the separate alarm address is dropped on the update. A new login address only counts once the link mailed to it is clicked.
- **Attention:** others see names, usernames and profile pictures, but no e-mail addresses (people picker, @-mentions, member and share lists, API). To share by address, type the full address. Admins still see them.
- **Attention:** profile pictures are uploads (up to 300 KB) or emoji; links to pictures on other servers are removed from existing accounts.
- **Attention:** moving a bullet into another note is `POST /documents/{id}/branches/move` (the old route keeps working); `POST /auth/quickstart` and `/ws/spaces/{id}` are gone. The server log uses English field names without emoji; adjust filters on field names.
- **Speed:** very long notes open and scroll much faster, because bullets out of view are no longer laid out (5,000 bullets open in about a fifth of the time, 20,000 now open at all). Typing, Enter and switching to focus mode in long notes, dragging on the Kanban board, full width for board and calendar, large drawings and dropdown lists do a fraction of the work. Large notes are no longer written to browser storage in full after every pause. Ticking off or moving a task makes 3 requests instead of 9. The sign-in page loads 170 kB instead of 530 kB; the emoji picker and the help load when first opened.
- **Administration:** the user list can be searched, filtered by role and organization and sorted; rows are compact, details open on a click, 50 people at a time, registrations waiting for approval on top.
- **Security:** HSTS over https, `X-Forwarded-*` only from trusted proxies, outgoing requests no longer follow https-to-http redirects. Files in `data/` are private (0600/0700), also in older installations on the next start. Unexpected and database errors reach clients only as "Internal error" (details in the server log), and tokens and typed sign-in names stay out of the log. Checks answer on the safe side when the database cannot. Test mails go only to your own addresses (5 per 15 minutes); the admin user list no longer shows alarm webhooks; `POST /auth/setup` accepts only JSON; signing in with the part of an address before the @ needs it to be unique.
- SQLite 3.46.0 → 3.54.1 (modernc.org/sqlite v1.61.0) with upstream fixes for WAL and full-text search; the server log names the version at startup.
- API error messages for clients without `Accept-Language` (scripts, curl) come in the server's default language, else English.
- Drawings: elbow arrows have rounded corners in every theme, also in exported SVG.
- Pages can be zoomed on phones again; on iPhone and iPad fields use 16 px text so Safari does not zoom by itself.
- Smaller changes: new tagline "Notes, tasks and a clear head, self-hosted."; the demo switch is `MINDSIFT_DEMO` (the old names still work); a Postgres `DATABASE_URL` logs a warning instead of being ignored; the outdated `compose.yaml` is gone; the startup log names the real port and `BASE_URL`; the image build checks modules with `go mod verify` and installs Alpine's security fixes.

### Fixed
- Phones: the on-screen keyboard no longer covers the password field on sign-in and setup; zooming into a deep bullet no longer fills the header with the whole path, a home button leads back to the start of the note.
- Tables: the ⋯ menu no longer disappears behind the bullet below; undo keeps the cursor in the table.
- A collapsed numbered item (or warning, error) with sub-bullets is highlighted like a collapsed bullet.
- `HEAD` requests (`curl -I`, uptime monitors) are answered like `GET` instead of `405`. Paths that are not part of the app (`/.env`, `/.git/config`, …) and unknown API paths answer `404` instead of the start page.
- Accounts: deleting your data or account counts wrong passwords like failed sign-ins; sign-up and sign-in no longer reveal whether an account exists; accounts waiting for confirmation are locked from the first moment; two simultaneous first setups can no longer create two admins.
- Long actions (restoring or making a backup, deleting an account, invites, SMTP, alarm and push tests) no longer end with "No connection to the server" after 12 seconds.
- Task alarms are no longer sent twice when the server cannot read which went out; a failed export is cut off instead of saved as a broken ZIP.
- The installed app starts offline even after the browser cleared its cache, and reloads once after an update instead of staying blank.
- Lists no longer jump back to a list opened from the search or a link. The task dialog no longer drops typed text when following a task, or writes an old title back.
- The test push, the shopping list created for you and the Kanban arrow buttons speak your language.
- The install script keeps `.env` readable only for its owner.

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
