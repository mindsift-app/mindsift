# UI Patterns

Recurring user interface elements that look and behave consistently everywhere. When a new one is needed, use the existing component instead of building a custom variation.

## Searching People (Type-to-Search)

Component: [UserAutocomplete.tsx](../frontend/src/features/UserAutocomplete.tsx)

Used in sharing (`UnifiedShareModal`), adding to groups (`GroupsView`), and assigning tasks (`TaskDetailModal`).

- **No list upfront:** As long as the field is empty, nothing appears—even when clicking inside. No dropdown listing all users.
- **Only when typing** do results appear directly below the field, **at most 3** (`MAX_RESULTS`). Searches across display name, `@username`, and email.
- The **first result is preselected**: Typing + Enter selects it. Arrow keys navigate, Escape closes.
- Already selected or shared users are hidden via `excludeUserIds`.
- **Single selection** (Sharing, Groups): Pass `selectedUser`; the field then displays the selected user with a ×.
- **Multi-selection** (Assigning tasks): Leave `selectedUser={null}` and add to the list in `onSelectUser`. Selected users appear as chips (avatar, name, ×) above the field; the field remains available for the next search.
- On mobile, the field, selected user, and result rows are 44 px high (16 px font, preventing iOS auto-zoom); from `sm` breakpoint upward, 32 px as before.

- **People search switched off** (`PEOPLE_SEARCH`, admin switch): no suggestions; the field looks up the exact e-mail address or username (`POST /users/lookup`). Only people one may share with (`findable`) are suggested at all. `allUsers` picks from exactly the list given (administration, a list's members).

## Adding to a Set (Search Popover)

Component: [PickerPopover.tsx](../frontend/src/components/PickerPopover.tsx), in the style of "In eigene Notiz umwandeln" (`ExtractPopover`).

Used where items are added to a set shown as chips: organizations of a new account or invite (`OrganizationPicker`), members of an organization (`OrganizationsSection`).

- The chips show what is chosen (✕ removes one); a round **"+" button** after them opens the popover below it.
- The popover: a search field (focused), up to 8 matching rows (avatar or icon, name, a second line such as the e-mail address), arrows and Enter pick, Escape or a click outside closes. Picking adds the item and closes it.
- Chips wrap, so many entries just make the block taller; the form around it never needs its own scrolling.

## Long Lists of People (Administration)

Component: [UserList.tsx](../frontend/src/features/settings/admin/UserList.tsx), search, filters and order in [userListView.ts](../frontend/src/features/settings/admin/userListView.ts). Used for the registered users of the administration; meant for any list that can hold hundreds of people.

- **On top:** a search field (name, `@username`, e-mail; every word must match, case and accents do not count, `NO_AUTOFILL`) and small `SelectMenu`s for the filters (role; organization with "Keine Organisation" when there are organizations) and the order (name A–Z as default, admins first, newest first; kept per device in `localStorage`). On phones the search has a row of its own and the three menus share the next one. With a filter set, "12 von 401" and "Filter zurücksetzen" appear below.
- **Compact rows:** one button per person, at least 44 px high: avatar, name with small badges (role only for admins and managers, members get none; locked or e-mail unconfirmed), username · e-mail in one muted line, from `sm` the organizations cut short on the right, a chevron. No dropdowns or action icons in the row.
- **Editing after a tap:** desktop opens the details below the row (one at a time); phones open them in a sheet from below (grip, avatar and name on top, Escape or the backdrop closes). The details hold the role menu, the organizations as information, and the actions as buttons with words (44 px on phones); one that is not allowed stays greyed out with the reason below it.
- **Only 50 rows are rendered**; "50 weitere anzeigen" below adds the next 50 and says how many are shown. A new search or filter starts again at 50. The data still comes in full from the server (`GET /admin/users`: 400 people are about 150 kB and take a few milliseconds), so searching needs no requests.
- Something waiting for an answer (registrations to approve) stays above the list in its own frame, with a `CountBadge` (`accent`) in the heading; the total of the list is plain text in its heading, as a badge stops at 99+.

## Profile Pictures as Stack

Component: [AvatarStack.tsx](../frontend/src/components/AvatarStack.tsx) (uses `UserAvatar`)

- Small circular profile pictures, **slightly overlapping**, **at most 3**. Additional users appear as a monochrome "+n" circle.
- Without a profile picture, `UserAvatar` displays the user's initials.
- **One color per person:** [userColor.ts](../frontend/src/lib/userColor.ts) derives a fixed color from the user id (12 hues mixed with the theme variables, so they work in every theme). `UserAvatar` uses it for the initials; always pass `userId` (or `user.id`), otherwise the name is used as the key and the color can differ from other places. With `colorRing` the circle gets a ring in that color, also around a real picture; the stack always sets it.
- Locks in shared notes use the same color: the locked bullet gets a faint tint and a stripe at its indent, the badge shows the profile picture and the name in that color.
- `ringClass` receives the color of the surface behind it (typically `ring-[var(--bg-panel)]` or `ring-[var(--bg-app)]`) to cleanly separate the circles.
- Sizes: `xxs` (16 px) in tabs, Kanban cards, and list items; `xs` (20 px) in task rows and headers.
- **No hover effect** on the stack itself. The only exception is presence in notes ([PresenceAvatars.tsx](../frontend/src/features/workspace/PresenceAvatars.tsx)): there, hover or keyboard focus displays the "Currently online" list.

| Location | Who is displayed |
|---|---|
| Note header | Users who currently have the note open (avatars from `/users/directory`) |
| Tabs of task lists and lists | Everyone with access except yourself (`members`) |
| Task row and Kanban card | Assigned users (only in shared lists) |
| Shared list item | The user who added it (`createdBy`); legacy items without an author show nothing |

## Switches

Component: [ToggleSwitch.tsx](../frontend/src/components/ToggleSwitch.tsx)

- On/Off settings are always switches, never checkboxes or "ticked" buttons (setup wizard, admin area, API key permissions, import and restore sections → `SectionPicker`).
- Text on the left (title, with a brief explanation in `text-muted` below), switch on the right.
- Choosing **one** option out of multiple choices (import mode, corner radius, theme tracking) remains a button group with `role="radio"`.

## Small Dialogs (Create, Rename)

Component: [FormSheet.tsx](../frontend/src/components/FormSheet.tsx), keyboard inset handled via [useKeyboardInset.ts](../frontend/src/lib/useKeyboardInset.ts)

- **Mobile:** Full-width bottom sheet positioned directly above the virtual keyboard (inset calculated via `visualViewport`), grab handle on top, inputs and buttons at least 44 px high, text inputs at 16 px (to prevent iOS auto-zoom), Cancel/Create buttons side-by-side spanning full width.
- **Desktop:** Centered window, or anchored next to click position via `anchor` (e.g., "New Folder" in explorer).
- Escape key and clicking the backdrop close the dialog. Used for new task lists, new shopping lists, new notes, and new folders; the emoji sheet uses the same keyboard inset logic.
- **Icon field:** [EmojiIconButton.tsx](../frontend/src/components/EmojiIconButton.tsx) instead of a text field: displays the emoji (or a subtle "Select icon" when empty) and opens the same emoji picker as the note header, including "Remove". In the dialog, the picker renders above the page via a portal; Escape closes only the picker.

## Confirmation at Mouse Position

Component: [ConfirmPopover.tsx](../frontend/src/components/ConfirmPopover.tsx)

- For confirming a single action (e.g., deleting a folder): a small popover directly at the click location (bottom right of the cursor, flipped upwards or leftwards at window edges), not a modal dialog centered on screen.
- "Cancel" and the action button (destructive actions in red via `danger`); the action button is focused, Enter confirms, Escape or clicking outside closes. Triggered via keyboard, it opens anchored to the button. On mobile, buttons are 44 px high.
- From handlers and hooks without state of their own: `await askConfirm({ message, confirmLabel, danger })` ([askConfirm.tsx](../frontend/src/components/askConfirm.tsx)) opens the same popover at the last click or tap and resolves `true` or `false`.
- **Never the browser's own dialogs** (`window.confirm`, `alert`, `prompt`). Ask only when an action cannot be undone (deleting a list, a folder, a backup, emptying the trash, revoking keys); actions that go to the trash or can be undone with `Ctrl+Z` run without a question (a task, a bullet with its children, removing a member or a share).

## One-Time Codes and Passkeys (Two-Factor)

Components: [MfaStep.tsx](../frontend/src/features/auth/MfaStep.tsx) (sign-in), [TwoFactorCard.tsx](../frontend/src/features/settings/user/TwoFactorCard.tsx) and [PasskeyCard.tsx](../frontend/src/features/settings/user/PasskeyCard.tsx) (settings), [SecondFactorFields.tsx](../frontend/src/features/settings/user/SecondFactorFields.tsx) (confirmations), [RecoveryCodesPanel.tsx](../frontend/src/features/settings/user/RecoveryCodesPanel.tsx).

- The app's code: `type="text"`, `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength={6}`, monospaced and spaced out; only digits are kept, and six digits send it at once (no button press needed, a button is still there). Anything that changes how it is sent (the "trust this device" switch) therefore sits **above** the field.
- A recovery code is a plain text field without auto-correct; one link switches between the two.
- A passkey is a button "Mit Passkey bestätigen" (fingerprint icon). With passkeys and no app it is the primary button of the second step; with the app too it sits below the code's button. Closing the browser's passkey dialog shows no error (`passkeyCancelled`). The options are fetched before the click where possible, so the browser's dialog opens within the click (Safari).
- Confirming a sensitive action uses `SecondFactorFields` in one `FormSheet`: the password, "Code der App oder Wiederherstellungscode" (only "Wiederherstellungscode" without app), and the passkey button when the account has passkeys; the server tells codes apart by their form (`confirmWithSecondFactor`).
- Removing the last second factor says so in red in the sheet before (two-factor sign-in goes off, recovery codes and trusted devices are deleted).
- On phones fields, buttons and the switch row are 44 px high.

## Error Notice

Component: [ErrorNotice.tsx](../frontend/src/components/ErrorNotice.tsx), `showError(message)` from anywhere.

- Red notice centered at the bottom (frame and text in `status-err`, warning icon), above the bottom navigation bar on mobile, with a short shake (none with reduced motion). Gone after 6 s or on a tap; the same error again shakes again.

## Notification with "Undo"

- Brief toast notification centered at the bottom (`role="status"`, surface `bg-panel-elevated`), placed above the bottom navigation bar on mobile; stays for 8–10 s when an action is present, otherwise 3–4 s.
- After moving items to trash: "… moved to trash · Undo" (workspace and tasks). In tasks, `Ctrl+Z` does the same; performing a new action hides the previous notification so "Undo" never targets the wrong step.

## Counters

Component: [CountBadge.tsx](../frontend/src/components/CountBadge.tsx), CSS classes `count-badge*` in [index.css](../frontend/src/index.css). No other counter styles are used.

- **Shape:** Solid round circle with a subtle border, no shadow or ring, minimum 16 px, displayed as "99+" from 100 upward (screen readers announce the actual number). Hidden at 0 unless `showZero` is set (e.g., member count, mobile menu).
- **Color (`variant`):**
  - `accent`: Something is waiting for you. Navigation bar: Triage (inbox), Tasks (open tasks), Lists (open items across all personal and shared lists). Workspace has no counter.
  - `muted` (default): Pure item count. Tabs of task lists and lists, organizations, mobile menu.
  - Both draw from theme variables (`--accent-primary`/`--text-on-accent` or `--text-muted`/`--bg-panel`), adapting seamlessly to any theme. The accent variant sits on an opaque panel surface so underlying icons do not show through on mobile.
- **Position (`position`):**
  - `text`: Attached to labels (navigation, task list and list tabs, workspace header). The badge sits inline directly after the word, slightly raised, hovering 2 px above the last letters regardless of digit count; wider numbers widen the tab. Text is wrapped in an `inline-flex items-center` span for this.
  - `corner`: Notification badge placed at the top right of the closest `relative` parent element; used for icons, e.g. in the mobile bottom bar (`-top-1.5 -right-2.5`).
  - `inline`: In normal text flow.
- Numbers in the mobile menu (`MobileActionContext`, `badge: number`) are automatically rendered as `CountBadge`; text badges such as "2 active" remain text tags.
- **Important for new classes:** Tailwind purges classes from `@layer components` that are not present verbatim in the source code. Therefore, never interpolate class names (`count-badge-${variant}`); write them out fully.

## View Switch (Segmented Control)

Component: [SegmentedControl.tsx](../frontend/src/components/SegmentedControl.tsx)

- A row of two or three short options on one surface (classes `seg-track`, `seg-item`, `seg-thumb` in `index.css`); the chosen one is raised with a light shadow, and the raised field slides to a newly chosen option (200 ms, off with reduced motion). From `sm` the surface is `--bg-panel-elevated` without a frame and the raised option `--bg-panel` (dark themes: `--bg-panel-hover`); phones keep the framed look of before. Used wherever a list can be shown in different ways: sorting of the hashtags (frequency / A–Z), the to-dos from notes (open / all, grouped / list), the task views (list / Kanban / calendar, with icons) and month / week of the calendar.
- Short labels, the longer explanation goes into `title` (hover). Screen readers get `radiogroup` and `radio` with `aria-checked`.
- The choice is a per-device convenience and is kept in `localStorage` where it should survive a reload (to-dos: `mindsift_todo_show`, `mindsift_todo_grouping`).
- Build new switches of this kind with this component instead of copying button classes. Rows that cannot be a radio group (they are buttons other code and tests click: the workspace views notes / to-dos / hashtags, open / done / trash of the task list) use the same classes, the chosen one with `seg-item-active seg-item-raised` and `aria-pressed`.

## Navigation Rail (Desktop)

Component: [NavRail.tsx](../frontend/src/app/NavRail.tsx), rows [RailItemContent.tsx](../frontend/src/components/RailItemContent.tsx), classes `rail-item`, `rail-item-active`, `rail-tip` in `index.css`. Phones keep their header and bottom bar unchanged.

- From `sm` the app has no header and no row of page tabs: a rail on the left holds the navigation, so every view starts at the top of the window. Collapsed it is 60 px wide (`--app-rail-w`, which the page leaves free and wide views such as the wide Kanban subtract), icons only.
- **Order from the top:** logo (back to the triage; expanded with the instance name and the version, or the demo's countdown, which the collapsed rail shows as `MM:SS` under the logo), the pages Triage, Workspace, Aufgaben, Listen with their `CountBadge` (`accent`; collapsed on the icon's corner, expanded after the label), a line, **Quick Dump** (a round, neutral `+`: `bg-panel-elevated`, frame, `text-main`, deliberately not the accent so it does not read as a second logo) and search. At the bottom: help, notifications (`NotificationBell`, its list opens beside the rail), the profile (avatar with the connection dot; expanded with name and status; the `ProfileDropdown` opens beside it, upwards) and the toggle.
- The open page is marked with `rail-item-active` (accent tint and accent text) and `aria-current="page"`. Every other row is a ghost button.
- **Names:** collapsed, a row keeps its label for screen readers (`sr-only`), so the button's name starts with it ("Workspace", "Aufgaben 9") and tests click it by name; a small tip with the name (`rail-tip`) appears beside the icon on hover or keyboard focus.
- **Expanded (220 px)** it lies over the content with a shadow and never pushes it: the page would have to lay out long notes again. A click beside it (which still reaches its target), Escape or the toggle folds it; navigating keeps it open. The state is kept per device (`localStorage` `mindsift:nav-rail-expanded`).

## Quick Dump Window (Desktop)

Component: [QuickDumpWindow.tsx](../frontend/src/app/QuickDumpWindow.tsx) with the unchanged `InstantCaptureBar` (target, list, priority, due date, voice).

- The `+` of the rail, the key **C** (bare, outside text fields; `useQuickDumpShortcut`) and every desktop "Quick Dump" action (the empty triage, the app icon shortcut) open the capture bar in a window at the top centre over everything, the page dimmed behind it like a spotlight search.
- **After sending it stays open** for the next thought: a dump rarely comes alone, the bar confirms each entry and keeps the cursor. Escape (empties the field, as in the bar) or a click beside the window closes it; a target "note" closes it too, as the new note opens. The window stays mounted while closed, so the chosen target and a text left by a click beside it are there next time.
- Phones keep their sheet from the `+` of the bottom bar (`MobileCaptureSheet`).

## Toolbars of the Views (Desktop)

Classes in `index.css`: `tool-tab`, `tool-tab-active`, `tool-btn`, `tool-icon`, `tool-ghost`, plus the segmented classes above. Used in the workspace bar (`WorkspaceTabBar` and the note's actions), the task list tabs (`TaskListTabs`, `TaskListView`, the Kanban and calendar controls in `TasksView`), the shopping list tabs (`ListTabsHeader`) and `MoreTabsButton`.

- **No frames:** tabs, buttons and switches in these rows have no border; the row itself has no rule below it either.
- **Tabs** (task lists, shopping lists): plain text (`tool-tab`), the open one gets `tool-tab-active`: the elevated surface, `text-main`, semibold and a 2 px accent line at its bottom. Counters stay `CountBadge` `position="text"`.
- **One of several views** (notes / to-dos / hashtags; list / Kanban / calendar; open / done / trash): a segmented switch.
- **Actions:** icon buttons are ghost buttons (`tool-icon`, 32 px; text buttons `tool-btn`, e.g. "Neue Liste", "Spalten"): muted icon, the elevated surface only on hover or while pressed / open (`aria-pressed`, `aria-expanded`). A framed button phones show as well (`btn-icon` in the note's header) gets `tool-ghost`, which drops the frame from `sm` only.
- Status (Live, "Geteilt", save state) stays flat text with a dot or icon; the divider `w-px h-5 bg-border` still separates status from actions.
- Everything uses theme variables, so all themes follow; rows that phones show keep their look below `sm`.

## Dropdown (Select Menu)

Component: [SelectMenu.tsx](../frontend/src/components/SelectMenu.tsx) (`SelectMenu`, `MultiSelectMenu`)

- Used everywhere instead of the browser's `<select>` (an ESLint rule rejects new ones), on phones too: a field with the chosen option and a chevron. A click opens the options right below it, above when there is no room; the chosen one carries a ✓.
- Sizes: `md` (default) is a form field in full width, 44 px on phones and 32 px from `sm`; `sm` is as wide as its content (filters, settings rows). `buttonClassName` replaces the look for tiny places such as the status in a task row or a code block's header.
- Each option can have a `lead` in front of its label, on the field and in the list (the colour dot of a Kanban column, the emoji of a list), be `disabled` and carry a `hint` as a second line.
- Keys as in a `<select>`: arrows, Home, End, Enter or Space pick, typing the first letters jumps to an option, Escape closes only the list (`preventDefault`, so a dialog around it stays open), Tab moves on. From 13 options the list has a search field on top (code block languages, voice languages).
- `MultiSelectMenu` ticks several options; the list stays open while ticking, the field shows the chosen labels (or a `summary`).
- The list is portalled to `<body>` with fixed position ([useAnchoredPopover.ts](../frontend/src/lib/useAnchoredPopover.ts)), so a scrolling dialog does not cut it off; it follows the field while the page scrolls. Events in the list do not reach the parents of the field (a note's bullet, a dialog's backdrop).

## Date and Time Fields

Components: [DateField.tsx](../frontend/src/components/DateField.tsx), [TimeField.tsx](../frontend/src/components/TimeField.tsx); typing and formats in [dateInput.ts](../frontend/src/lib/dateInput.ts)

- Values as everywhere in the app: days `YYYY-MM-DD`, times `HH:MM` (24 h), `''` for empty.
- **Touch** (`(pointer: coarse)`: phones, tablets): the browser's `<input type="date|time">`, which opens the system's own picker. **Mouse**: our own field and popover. Decided by the pointer, not the width, so a narrow desktop window keeps the calendar.
- Date with a mouse: shown and typed in the order of the language (`24.11.2026`, `11/24/2026`); `24.11.`, `24.11.26` and `24112026` are understood too, a wrong entry falls back to the old value when the field is left. A click opens a plain month calendar at the chosen day or today: the week starts as the language has it (`lib/calendar.ts`), today is framed, the chosen day filled, weekends faintly set off; the title switches to months of a year. Arrow down from the field goes into the calendar; there arrows move the day, Page Up/Down the month, Enter picks, Escape closes only the calendar. An × empties the field (`clearable={false}` where the form has its own button).
- Time with a mouse: typed to the minute (`14:30`, `1430`, `930`, `2:30 pm`), arrow up/down moves by 15 minutes; a click opens a list in steps of 15 minutes at the chosen time or now. 24 hours or AM/PM as the language writes it.
- Both take the typed value when the field is left or on Enter; `className` places the field in its row, `inputClassName` sets its look.

## Origin Badge (API Keys)

Component: [OriginBadge.tsx](../frontend/src/components/OriginBadge.tsx)

- A badge indicating items created or modified by an API key (field `origin`): neutral border, icon on the left representing access type (webhook = REST/curl, robot = MCP), followed by key name. Legacy items without a key name display "API" or "MCP".
- At most one badge per item: the key that created it, or alternatively the one that last modified it. It persists permanently, even after manual edits and after triage.
- Details (created / last modified, key name, and timestamp) via hover and tap (small tooltip popover, with enlarged tap target on mobile); in the task detail view, details are also shown at the bottom (`originDetails`). Tapping the badge never opens the item.
- Sizes: `sm` in task rows, inbox list, and detail view; `xs` on Kanban cards and in lists; `md` on triage cards.
- In the task detail view on mobile, the badge is omitted from the header (no room next to buttons); origin is shown only in the bottom details there.

## Switching Lists (Mobile)

Component: [ListSwitcher.tsx](../frontend/src/components/ListSwitcher.tsx)

- In the mobile top bar (Tasks, Lists), the open list title is a button with an arrow. Tapping it opens a dropdown of all lists with icon, counter (`CountBadge`, `muted`), and checkmark on the currently active list; tapping a list switches to it.
- Closes on outside tap and on Escape. On desktop, tabs remain visible above the list.

## Sorting Tabs (Drag and Drop)

Tab rows that the person can reorder (task lists, shared lists) use `useTabReorder` (`lib/useTabReorder.ts`) and `TabDropMarker` (a line on the side where the tab lands). The tab carries its own drag data type, so dropping tasks or list items onto a tab keeps working; `handleDragOver`/`handleDrop` return `true` when they handled a tab. The order is saved per person (`PUT /task-lists/order`, `/lists/order`) and applied with `inIdOrder` right away.

## Tab Row That Never Wraps (Lists)

Hook: [useOverflowTabs.ts](../frontend/src/lib/useOverflowTabs.ts), button: [MoreTabsButton.tsx](../frontend/src/components/MoreTabsButton.tsx). Used for the task lists (`TaskListTabs`) and shopping lists (`ListTabsHeader`).

- The tabs stay in one row; those that do not fit go behind **"⋯ n"** at the end of the row, a dropdown like the list switcher on phones. The open list always keeps its place, the order stays (no smaller tab jumps in after a gap). The actions on the right never move.
- Hidden tabs remain rendered (`OVERFLOW_HIDDEN_TAB`: absolute, invisible) so their widths can be measured; such a tab must not carry `relative` at the same time. Fixed parts of the row carry `data-tab-fixed`.
- While a task or entry is dragged, resting on "⋯ n" opens the dropdown; its rows take the drop like the tabs.

## Menu of the Open List (⋯)

Component: [ActionMenu.tsx](../frontend/src/components/ActionMenu.tsx), in the style of the note menu.

- Right of the status in the list header (task lists, shopping lists), instead of separate share and delete buttons: Mute (task lists; greyed out with a hint for lists nobody else sees), Share, Rename ([RenameListSheet.tsx](../frontend/src/components/RenameListSheet.tsx), a `FormSheet` like "Neue Liste"), Delete (asks at the mouse position).
- An entry someone may not use stays in the menu, greyed out with a short reason below it (read only, only the owner can delete), so the menu looks the same everywhere. Longer explanations go into the tooltip (`tooltip`), not below the entry.
- Groups are set apart by a thin line (`separatorBefore`); one choice of several (a table's line mode) carries `checked` and shows a ✓ at the chosen entry. `keepFocus` keeps the cursor in the text field while the menu is used (the table's menu acts on the cell with the cursor).

## Tables in Notes

Component: [TableBlock.tsx](../frontend/src/features/workspace/TableBlock.tsx), Markdown in [markdownTable.ts](../frontend/src/lib/markdownTable.ts), lines in `index.css` (`.note-table`).

- A table is a bullet (`/table`, 2 × 2); the first row is the header. One text field per cell lies over the formatted cell text, like a bullet's field over its text.
- **+ right of the table** adds a column: on phones always there and 44 px wide, on a desktop only on hover or with the cursor in the table. The **⋯** below it is an `ActionMenu` with the line modes, the alignment of the column with the cursor (left, centered, right; stored in the Markdown's separator row) and row/column actions; on a desktop + and ⋯ stay visible while the menu is open (a fading box would put the menu behind the bullet below).
- Lines come from the theme's `--border-color`, drawn per cell so the default mode can fade them out towards the edge; the frame of `grid` takes `--radius-card`. Wide tables scroll sideways inside the note (`.table-scroll`).

## Mentioning People (@)

Hook: [useMentionInput.ts](../frontend/src/lib/useMentionInput.ts), list: [MentionMenu.tsx](../frontend/src/components/MentionMenu.tsx), chip: [MentionChip.tsx](../frontend/src/components/MentionChip.tsx).

- In a field that knows its place (note, task, task list), "@" right after a space or at the start opens a list of people below the field (at most 8, filtered by name or username); arrows, Enter or Tab pick, Escape closes. People without access to the place are greyed out with "keine Berechtigung" and cannot be picked; there is no shortcut to share from there.
- The text stores `{{mention:<user id>}}`; it shows as "@Name" with the person's current name (`renderInlineMarkdown`, or `renderMentions` for plain text such as subtasks).
- Used in bullets of notes, a task's description and new subtasks; not in task titles.

## Notification Center (Bell)

Component: [NotificationBell.tsx](../frontend/src/components/NotificationBell.tsx).

- In the header between search and profile (phones: search, bell, profile side by side; below 380 px the "App" button shows only its icon). The number of unread entries is a `CountBadge` in the corner.
- A click opens a small list (desktop: dropdown under the bell; phones: full width under the header): icon per kind, short text, relative time, unread ones tinted with a dot. "Mark all as read" and "Delete all" on top. A click on an entry marks it read and opens its target.
- Quiet: no sound, nothing pops up; open apps update over the WebSocket.

## Calendar of Tasks

Component: [TaskCalendar.tsx](../frontend/src/features/triage/TaskCalendar.tsx), logic in [calendar.ts](../frontend/src/lib/calendar.ts).

- Third view next to list and Kanban (remembered per list). Desktop: month or week (`SegmentedControl`), 7 columns without hours; phones: the week with a date strip on top and the days below.
- Entries are compact: priority dot, time, title; overdue in red, done struck through, coming dates of repeating tasks greyed with ↻ (they open the task itself). A month day shows three and "+n more".
- Dragging (mouse: HTML5 with the half transparent ghost; finger: hold, as on the Kanban board) onto a day sets the date and keeps a time; onto "Unscheduled" removes it; undo with Ctrl + Z or the notice.
- Desktop, like the Kanban board: the month/week switch and the full-width button (the same setting as the board) sit at the right of the hashtag row; the height and scrolling come from `useKanbanLayout` (`isCalendar`): the calendar reaches the bottom of the screen, one wheel step scrolls the bar above away and the calendar grows to the full height (back up with one step; a long week day or the side column scrolls first).
- Desktop: on the left a column as tall as the calendar with what the calendar shows ("November 2026", "KW 46 · 9.–15. Nov.") and ‹ Today › on top, then two tabs: the day (today until a day is clicked; task rows in `compact` form: no due date, their buttons at the end of the status line, and "Task for this day") and "Unscheduled" (the same compact task rows, so they can be ticked off there; the panel and its tab take drops, captured before the rows). Day cells also take full task rows (`application/mindsift-task-id`). Month and week have the same height. Phones: a sheet from below.
- Desktop grid: a day column is a fifth of the visible width (at least 112 px), so Monday to Friday fill the view and the grid scrolls sideways to the weekend, stopping at a day's edge. Its weeks always run Monday to Sunday (also in languages whose week starts on Sunday, the phone view follows those), so the weekend lies together at the end. While dragging, the grid is not scrollable for the browser (`overflow-x: hidden`, so its own edge scrolling stays off) and a task held at the left or right edge jumps it one day on after 450 ms, then every 650 ms (one page-wide dragover listener; day cells stop the event). A button in the weekday row ("Sa – So ›", at the end "‹ Mo – Di"; fixed labels, they do not follow each scroll step) jumps there, as scrollbars are often hidden.
- Entries cannot be selected as text (`select-none`), so a long press on phones starts the drag.
- Weeks start per language (`firstWeekday`) on phones; repeating dates follow the server's rule (months fall back to their last day).

## Sharing Dialog

Component: [UnifiedShareModal.tsx](../frontend/src/components/UnifiedShareModal.tsx), for notes, folders, task lists and shopping lists.

- The header names what is shared small on top ("Share task list", `title`) and its name large below (`resourceName`), once.

## Fields That Are Not a Login

Search and filter fields get `NO_AUTOFILL` (`lib/noAutofill.ts`). Passwords that are not the person's own login (other accounts, the mail server, the password of a public link) are text fields with `style={MASKED}` instead of `type="password"`, otherwise password managers offer the person's login there.

## Header: Status | Actions

Component for connection status: [LivePill.tsx](../frontend/src/components/LivePill.tsx) (notes display their own sync transport in the same visual style).

- On the right side of headers in Notes, Tasks, and Lists (see "Toolbars of the Views" for their look), the same layout order applies: status indicators on the left (Live pill, "Shared"), followed by a vertical divider (`w-px h-5 bg-border`), and action buttons on the right (Share or the ⋯ menu, View). On mobile, the layout is identical, but the pill displays only "Live".
- The "shared" status in these headers is [SharedPill.tsx](../frontend/src/components/SharedPill.tsx): flat (`bg-panel`, 28 px high), "Shared (3)" in the accent colour for own items, "Shared by Anna" muted for someone else's; a click opens the sharing dialog. The journal shows the same header for the day marked in the calendar.

## Microphone in Input Fields

Component: [VoiceInputButton.tsx](../frontend/src/components/VoiceInputButton.tsx) (uses `useVoiceInput` like Quick Dump)

- Circular microphone button directly inside the input line on the right; dictated text is appended to any existing text in the field. 36 px on mobile, 28 px on desktop.
- Multi-line fields (a task's title and notes): the button floats in the field's top right corner (`absolute top-1 right-1`, the field gets `pr-11 sm:pr-9`). It is only there while the field is open, so the text can be watched arriving.
- During recording: `MicOff` in accent color, plus live waveform visualization when connected to a dedicated Whisper server, followed by "Recognizing…" with a spinner.
- Hidden when speech-to-text is disabled (`STT_DISABLED`, or `STT_ALLOW_BROWSER=false` without a Whisper server) or when unsupported by the browser (e.g., Firefox without a custom Whisper server). Errors are briefly indicated via input placeholder text.
- Used in: Quick Dump (custom implementation), Add Task (input row on PC, "Create new task" sheet on mobile), Add List Item.

## Splash Screen & Status Bar

- `manifest.json`: `name` "MindSift" (short name; slogan is placed in `description`), `background_color` and `theme_color` `#2563eb`—Android uses these to generate the splash screen.
- `index.html` contains a pure HTML placeholder inside `#root` (solid blue background, centered logo, no text). React replaces it during initial render, preventing white flashes.
- `meta theme-color` starts blue and is set to `--bg-app` of the active theme by [`theme.ts`](../frontend/src/lib/theme.ts) after startup and upon every theme switch, ensuring the browser status bar matches the application header.

## + Button: Tap and Hold

Component: [HoldToRecordFab.tsx](../frontend/src/features/capture/HoldToRecordFab.tsx)

- **Short tap (< 350 ms):** Executes the primary action of the current view (`primaryAction`) or opens the mobile capture dialog (`openMobileTriageCapture`), as before.
- **Press and hold (≥ 350 ms):** Immediately starts a voice recording via `useVoiceInput` (in server mode via Whisper with real waveform levels, otherwise via browser speech recognition). The button turns into a pulsing microphone (`bg-status-err`), with a floating pill above displaying "Listening… (release to save)" alongside the live transcript.
- **Release:** Stops recording, briefly awaits the final word, and saves the text as an idea to the inbox regardless of the active view (`source: 'voice'`, `target: 'inbox'`).
- **Drag upward (> 60 px):** Switches the pill to cancellation state ("🗑️ Release to cancel"); releasing here discards the recording (`abort()`).
- **Fallback:** If speech input is disabled (`STT_DISABLED=true`), unsupported by the browser, or microphone permissions are denied (`not-allowed`), holding the button opens the dialog just like tapping and briefly displays a status message above the bottom bar.

## Guided Tour

Folder: [features/tour/](../frontend/src/features/tour/) (steps in `tourSteps.ts`, step logic in `tourEngine.ts`, card placement in `tourLayout.ts`, overlay in `GuidedTour.tsx`, texts in `locales/<code>/tour.json`).

- **Start:** the button "Tour starten" on the help page (`TourStartCard`, through `requestTourStart()`), and once the offer after the first sign-in (below); never an automatic start. `GuidedTour` is mounted once in `App.tsx` and returns to the page it was started on when it ends (last step, ×, Esc).
- **Offer after the first sign-in:** `TourOfferCard` asks "Kurze Tour starten?" once the app is ready (after the setup wizard's rest, `FinishSetupView`, the data loaded, and after the install offer on phones): a small `panel-elevated` card at the bottom right, on phones over the full width above the navigation, not modal. "Starten", "Nein danke" and × all count as the answer, and so does starting the tour from the help page; it never comes back. The account keeps it (`tourOffered`, `PATCH /auth/settings`, on every device; accounts from before the offer count as asked). The demo's accounts are shared, so there the browser remembers it (`localStorage` `mindsift:tour-offered`); scripts that take pictures or click through the demo set that key, like `mindsift:demo-hint-closed`.
- **Seven steps, no more:** Triage (Quick Dump and the deck), notes (slash commands and blocks, drawing), linked tasks, focus mode, tasks (views, wide board, details), search, the help page. Sharing is one sentence of the last step.
- **Targets by attribute:** each step names `[data-tour="…"]` selectors in order of preference; the first visible one gets the card, `also` lights more controls with a dashed frame. A control the tour points at keeps its `data-tour` attribute when it is reworked. A step with nothing visible is skipped in the direction of travel (on phones the focus-mode step, as the phone shows the list of notes; with an empty account the "new note" button stands in for the note).
- **Look:** the page is dimmed with `--bg-overlay`, the controls are cut out with the corners of the control (or the theme's `--radius-card`); the card is `panel-elevated` with an arrow beside the control on desktops, docked at the top or bottom over the full width on phones. Small examples in the card (`TourDemos.tsx`) are static markup that moves (still with reduced motion) and never touch data.
- **Nothing changes underneath:** `#root` is `inert` while the tour runs, the overlay takes every click, and the keys are caught before the app's shortcuts (→ / Enter next, ← back, Esc ends, Tab stays in the card), so the triage's own keys cannot sort a card. `e2e/tour.e2e.mjs` checks that notes, tasks, inbox and lists are the same afterwards.
