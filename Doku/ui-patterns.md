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

- A row of two or three short options in one frame; the chosen one is raised (`bg-panel-elevated`, light shadow). Used wherever a list can be shown in different ways: sorting of the hashtags (frequency / A–Z), the to-dos from notes (open / all, grouped / list).
- Short labels, the longer explanation goes into `title` (hover). Screen readers get `radiogroup` and `radio` with `aria-checked`.
- The choice is a per-device convenience and is kept in `localStorage` where it should survive a reload (to-dos: `mindsift_todo_show`, `mindsift_todo_grouping`).
- Build new switches of this kind with this component instead of copying button classes.

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

- Third view next to list and Kanban (remembered per list). Desktop: month or week (segment switch), 7 columns without hours; phones: the week with a date strip on top and the days below.
- Entries are compact: priority dot, time, title; overdue in red, done struck through, coming dates of repeating tasks greyed with ↻ (they open the task itself). A month day shows three and "+n more".
- Dragging (mouse: HTML5 with the half transparent ghost; finger: hold, as on the Kanban board) onto a day sets the date and keeps a time; onto "Unscheduled" removes it; undo with Ctrl + Z or the notice.
- Desktop: on the left a column as tall as the calendar (which fits the window) with two tabs: the day (today until a day is clicked; task rows in `compact` form: no due date, their buttons at the end of the status line, and "Task for this day") and "Unscheduled" (the same compact task rows, so they can be ticked off there; the panel and its tab take drops, captured before the rows). Day cells also take full task rows (`application/mindsift-task-id`). Month and week have the same height. Phones: a sheet from below.
- Desktop grid: a day column is a fifth of the visible width (at least 112 px), so Monday to Friday fill the view and the grid scrolls sideways to the weekend, stopping at a day's edge. Its weeks always run Monday to Sunday (also in languages whose week starts on Sunday, the phone view follows those), so the weekend lies together at the end. A button in the weekday row ("Sa · So ›" / "‹ Mo") jumps there, as scrollbars are often hidden.
- Entries cannot be selected as text (`select-none`), so a long press on phones starts the drag.
- Weeks start per language (`firstWeekday`); repeating dates follow the server's rule (months fall back to their last day).

## Sharing Dialog

Component: [UnifiedShareModal.tsx](../frontend/src/components/UnifiedShareModal.tsx), for notes, folders, task lists and shopping lists.

- The header names what is shared small on top ("Share task list", `title`) and its name large below (`resourceName`), once.

## Fields That Are Not a Login

Search and filter fields get `NO_AUTOFILL` (`lib/noAutofill.ts`). Passwords that are not the person's own login (other accounts, the mail server, the password of a public link) are text fields with `style={MASKED}` instead of `type="password"`, otherwise password managers offer the person's login there.

## Header: Status | Actions

Component for connection status: [LivePill.tsx](../frontend/src/components/LivePill.tsx) (notes display their own sync transport in the same visual style).

- On the right side of headers in Notes, Tasks, and Lists, the same layout order applies: status indicators on the left (Live pill, "Shared"), followed by a vertical divider (`w-px h-5 bg-border`), and action buttons on the right (Share or the ⋯ menu, View). On mobile, the layout is identical, but the pill displays only "Live".
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
