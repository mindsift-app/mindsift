# Plan: Split Large Frontend Files (Implemented)

As of 2026-11-03. Resolves [FLAW-41](../flaws.md). Goal: Large views are broken down into components, hooks, and pure utility functions so that specific code can be located without reading 3,000 lines, changes collide less frequently, and logic becomes testable. **Nothing changes for users**, neither behavior nor appearance.

## Current State

| File | Lines | `useState` | `useEffect` | Dedicated Tests |
|---|---|---|---|---|
| `features/triage/TasksView.tsx` | 3,349 | 51 | 16 | none |
| `features/workspace/WorkspaceView.tsx` | 3,147 | 60 | 22 | sidebar only |
| `features/settings/UserSettingsView.tsx` | 2,202 | 51 | 6 | alarms only |
| `lib/api.ts` | 2,059 | – | – | none |
| `App.tsx` | 2,005 | 38 | 22 | none |
| `features/settings/AdminSettingsView.tsx` | 1,632 | 32 | 2 | none |
| `features/lists/SharedListsView.tsx` | 1,597 | 25 | 11 | none |

Below these are `OutlinerBlock.tsx` (1,825) and `DocumentEditor.tsx` (1,635). Both are large but cohesively structured around domain logic (editor core) and are not part of this plan.

## Principles

- **Pure refactoring.** Every step moves code without changing logic. Bugs discovered during the process are added to the Mindsift list and resolved separately, not in passing.
- **Safety net first, then the cut.** Before a file is decomposed, tests and screenshots ensure its existing behavior is preserved (see below).
- **Small steps.** One cut per commit (extracting one component or one hook), followed by `tsc`, linting, and tests. This isolates any regression to a single step.
- **Interfaces remain intact.** Anything imported by other files (`api`, `TasksView`, `WorkspaceView`) keeps its name and path. New files reside alongside the old ones in the same `features/…` folder; hooks follow the `use…` naming convention like the existing `useKanbanTouchDrag`.
- **No new state framework.** State needed by multiple parts stays in the view and is passed down via props. Only where this spans more than two levels is a small context introduced per view (e.g. `TasksContext`). No Redux, no Zustand, etc.
- **Target guideline ≤ 800 lines** per file, non-dogmatically. A cohesive file of 900 lines is preferable to three artificially split ones.

## Safety Net (Step 0, before every cut)

1. **Screenshots as reference:** `e2e/refshots.sh capture vorher` records 57 views (desktop 1440 px, mobile 390 px: Triage, tasks as list and Kanban in "All Tasks" and in a specific list, task details, workspace with note, to-dos, hashtags, hashtag page, journal, focus mode (including with pinned bars), note share dialog, lists with their share dialog, profile menu, every section of account settings in a tall window (also: unsaved inputs surviving a section switch; danger zone confirmation prompt), every section of administration, help (also: scroll position preserved across page navigation), global search via Ctrl+K and /, log out and log in via the form, task trash bin, expanded and filtered hashtag row, task list share dialog, on mobile install banner and instructions, profile sheet, quick-dump sheet with save, capture sheet, workspace, lists, and task menus, and filter sheet). The version number is replaced with a placeholder; if a step fails, an image of the failure is saved alongside as `FAIL_….png`. Each run executes against the same database fixture with a frozen clock; two runs of the same code are pixel-identical, except for real server timestamps (login timestamp in session list, deletion timestamp in trash bin). After each step: `capture nachher` and `compare vorher nachher`; discrepancies are saved as red masks in `.refshots/shots/diff-…`.
2. **Characterization tests** for currently untested logic, targeting business logic rather than markup:
   - Kanban columns: `activeColumns`, `boardColumns`, `ownColumnOf`, `boardIdOf` (merged columns in "All Tasks"). Converted to pure functions in Step 2, making them directly testable.
   - `lib/api.ts`: `request()` with token renewal via `X-Session-Token`, offline outbox, WS → SSE → long-polling fallback/switching (with mocked `fetch`/`WebSocket`).
   - `App.tsx`: scroll position per page, keyboard shortcuts (Ctrl+K, `C`, `/`).
3. **Mouse and touch drag-and-drop:** `e2e/refshots.sh drag vorher` (`e2e/refdrag.mjs`) performs drag operations on a fresh copy of reference data: Kanban card into another column, into the Done column, within the same column, then Ctrl+Z; list row upwards, row onto another list tab; checking off, deleting, and restoring from trash bin via click; task creation via quick add, new task list via dialog; on mobile, a card via touch drag. Plus three real-time steps: a task is externally renamed, created, and deleted via API; the open page must reflect this without a reload. After each step, task state is captured from the server (list, column, completed, order); two runs of the same code produce the same file, compared before/after with `diff`.
4. **Workspace:** `e2e/refshots.sh ws vorher` (`e2e/refworkspace.mjs`) creates a note and folder by click, drags the note into the folder and into the trash bin, restores it, checks off a to-do in the rollup and deletes the folder after confirmation prompt, drags a note into the trash bin and restores it via "Undo" in the notification, selects two notes with Ctrl+click and drags them together into a folder, drags one to the root level, verifies real-time updates (note created, renamed, or deleted externally appears in sidebar; external thought increments triage counter); on mobile, creates a new note with a title via the plus button; after each step, notes, folders, and trash bin are captured from the server.
5. **Lists:** `e2e/refshots.sh lists vorher` (`e2e/reflists.mjs`) creates items with quantity and hashtag, accepts a hashtag suggestion, checks items off, updates a quantity, deletes, drags within and across categories and onto another list's tab, reopens a completed item, clears completed items, creates a list, verifies real-time updates (item created and checked off externally) and mobile plus button; after each step, all lists are captured from the server.

## Execution Order

Sorted by benefit and risk: start with what provides the most relief with the least potential to break things.

### Step 1: `lib/api.ts` → `lib/api/` (low risk) – completed

Pure module split without React.

| New File | Contents |
|---|---|
| `lib/api/client.ts` | Token (`getToken`, `setToken` …), `request()`, error handling, outbox |
| `lib/api/tasks.ts`, `docs.ts`, `lists.ts`, `account.ts`, `admin.ts` … | Endpoints of the current `api` object, split by domain |
| `lib/api/realtime.ts` | WebSocket/SSE/long-polling (currently starting around line ~1500, roughly 500 lines): connection establishment, switching, `onWebSocketMessage`, rooms |
| `lib/api/index.ts` | Combines `export const api = { ...tasks, ...docs, … }` and exports everything as before |

All imports `from '../lib/api'` remain valid. Effort: small.

**Implemented:** As outlined above; REST domains are named `auth`, `tasks`, `workspace`, `lists`, `teams`, `admin`, `data`; `rest.ts` combines them into `api` (spies and mocks on `api` continue to work), `realtime.ts` imports `api` from there to avoid circular dependencies. Largest file: `realtime.ts` with just under 600 lines. Tests: `lib/__tests__/api.request.test.ts`; reference screenshots unchanged.

### Step 2: `TasksView.tsx` (medium risk, highest benefit) – completed

| Extraction | Current Approx. | Destination |
|---|---|---|
| Column logic (`activeColumns`, `boardColumns`, `ownColumnOf`, `boardIdOf`) | L. 492–562 | `lib/kanbanColumns.ts`, pure functions with tests |
| Kanban layout (column heights, rows, mobile snapping, wheel jumps row by row) | L. 565–697 | Hook `useKanbanLayout` |
| Kanban drag-and-drop (slot, hidden card, drop) | dispersed, `handle*Drag*` | Hook `useKanbanDrag` (alongside `useKanbanTouchDrag`) |
| Board rendering | L. ~2895–3174 | `KanbanBoard.tsx`, `KanbanColumn.tsx` |
| List view | before board | `TaskListView.tsx` |
| Header with list tabs | L. ~2056–2370 | `TaskListTabs.tsx` |
| Hashtag row | L. ~2372–2450 | `TagFilterRow.tsx` |
| Mobile capture sheet | L. ~2460–2794 | `MobileTaskCreateSheet.tsx` |
| Trash bin | from L. ~3174 | `TaskTrashView.tsx` |
| Loading, per-list cache, realtime handlers, undo | L. ~300–450, ~870–920 | Hooks `useTasksData`, `useTaskUndo` |

What remains is `TasksView` as an orchestrating shell connecting data hooks and subcomponents. Effort: large, in 8–10 commits.

**Implemented (v0.68.3–v0.68.18):** `TasksView` 3,349 → 1,002 lines. New in `features/triage/`: logic `taskListing.ts` (filtering, sorting, grouping), `lib/kanbanColumns.ts`, `tasksMenu.tsx` (mobile menu), `taskViewTypes.ts`; hooks `useKanbanLayout`, `useTaskDrag`, `useTaskRealtime`, `useTaskUndo`, `useTaskActions`; components `KanbanBoard`, `TaskListView`, `TaskRow`, `TaskListTabs`, `TagFilterRow`, `QuickAddTaskBar`, `ActiveFilterBanner`, `TaskTrashList`, `MobileTaskCreateSheet`, `TasksFilterSheet`, `NewTaskListSheet`, `TaskListShareDialog`. Pure logic has tests (columns, list assembly, real-time). Every cut: reference screenshots unchanged, `refdrag` (drag-and-drop, click actions, real-time, Ctrl+Z, quick add, new list) identical. Per-list loading and caching intentionally remained in the view (tightly coupled with list navigation).

### Step 3: `WorkspaceView.tsx` (medium risk) – completed

| Extraction | Current Approx. | Destination |
|---|---|---|
| Folder tree (folders, subfolders, notes, multi-selection with Ctrl/Shift) | L. ~160–300 + drag | `FolderTree.tsx`, hook `useDocDragDrop` |
| Tab bar with live, share, and save status | L. ~1672–1900 | `WorkspaceTabBar.tsx` |
| Focus mode chrome (fade-in bars, pins) | L. ~1913–1990 | `FocusModeChrome.tsx` |
| Sidebar | from L. ~1991 | `WorkspaceSidebar.tsx` |
| Hashtag overview (tiles) | L. ~2406–2564 | `HashtagOverview.tsx` |
| Hashtag page | L. ~2564–2652 | `TagDetailView.tsx` |
| To-do rollup | L. ~2652–2990 | `TodoRollupView.tsx` |
| Folder dialogs, deletion confirmation prompt | L. ~2990–3060 | `FolderDialogs.tsx` |
| Loading notes/folders/tags/journal | L. ~540–600 | Hook `useWorkspaceData` |
| Journal state, merging with undo | L. ~367–391, ~499–1010 | Hooks `useJournal`, `useMergeNotes` |
| Hide bar on scroll (v0.67.0) | in `wsBar` | Hook `useTabRowSnap` |

Effort: large, in 8–10 commits.

**Implemented (v0.69.2–v0.69.18):** `WorkspaceView` 3,147 → 1,119 lines. New in `features/workspace/`: logic `workspaceListing.ts` (to-do rollup, hashtag page and tiles, with tests), `workspaceMenu.tsx` (mobile menu), `workspaceTypes.ts`; hooks `useWorkspaceData` (loading and real-time), `useDocDragDrop` (drag-and-drop and selection), `useFocusMode`, `useJournal`, `useTabRowSnap`, `useToast`, `useShareModal`; components `FolderTree`, `FolderTreeItem`, `SidebarSections` (journal entry, hashtags, trash bin), `WorkspaceTabBar`, `FocusModeChrome`, `FolderDialogs`, `WorkspaceToast`, `WorkspaceShareModal`, `TodoRollupView`, `HashtagOverview`, `TagDetailView`. Every cut: reference screenshots unchanged, `refworkspace` identical; where a cut touched untested ground, a safety net step was added beforehand (pinned focus mode, share dialog, mobile menu, delete folder, multi-selection, root level, undo in toast notification, real-time). Intentionally remained in the view: merging (`handleMerged` primarily controls view state), sidebar chrome and header, creating, renaming, and deleting notes and folders. Noticed in passing: the workspace trash bin had been positioned below the window edge since v0.67.0 (fixed in v0.69.1); a pinned note loses its pinned state after trash and restore (noted as a task).

### Step 4: `App.tsx` (medium risk) – completed

`AppHeader.tsx`, `MobileNav.tsx`, hooks `useScrollPositions` (scroll position per page), `useGlobalShortcuts`, `useSessionBootstrap` (login, status, demo reset). `App` retains only page selection and outer shell. Effort: medium.

**Implemented (v0.69.19–v0.69.25):** `App` 2,005 → 776 lines. New in `src/app/`: `appTabs.ts`, `ViewErrorBoundary.tsx`, `AppHeader.tsx` (header bar for mobile and desktop, page tabs), `MobileNav.tsx`, `ProfileMenus.tsx` (profile menu desktop and mobile), `MobileCaptureSheet.tsx`, `PwaInstallSheet.tsx`; hooks `useSessionBootstrap` (status, login, counters, real-time connection, demo reset), `useScrollPositions`, `useCommandPaletteShortcuts`, `useMobileCapture`, `usePwaInstall`. Before each cut, the affected functionality was added to the safety net (scroll position, global search, install banner, profile menus, quick-dump sheet with save, log out and log in, triage counter via real-time). Remained in `App`: page selection, themes, share target handling from other apps, app shortcuts, per-page mobile menu, and outer shell. Not covered: demo countdown instead of version and demo reset (test runs run without demo mode).

### Step 5: Settings and Lists (low risk) – completed

`UserSettingsView` and `AdminSettingsView` have natural cut lines: one file per tab or section (profile, notifications, retention, themes, sessions; users & invitations, server, organizations, backups). `SharedListsView` follows the same pattern as `TasksView` (tabs, list, items). Effort: medium, low risk.

**Implemented (v0.69.26–v0.69.38):**
- `UserSettingsView` 2,202 → 302 lines. One component per section in `features/settings/user/` (profile with danger zone, appearance & themes, alarms, voice input, retention, export & import). State remains in the view via individual hooks so that unsaved inputs survive section switches (verified in the safety net).
- `AdminSettingsView` 1.632 → 192 lines. The sections share their data, hence a `useAdminSettings` hook and one component per section in `features/settings/admin/`.
- `SharedListsView` 1,597 → 573 lines. New in `features/lists/`: `listItems.ts` (reading items, grouping, hashtag suggestions; with tests), `useListRealtime` (with tests), `useListDrag`, `useItemEditing`, `ListItemGroups`, `ListHeaders`, `listsMenu.tsx`. Preceded by adding `e2e/reflists.mjs`.
- Finally, extracted folder tree (pure functions with tests) and trash bin actions (`useTrashActions`) from `WorkspaceView`: 1,119 → 1,030 lines.
- Noticed in passing, not changed: A list item dragged into another category saves the category in lowercase; in the mobile list menu, the plus icon for "Add new item" is invisible (accent color on accent background).

## Known Pitfalls

- **DOM bindings remain:** Scroll and snap effects look up elements via `data-app-scroll`, `data-kanban-col`, `data-kanban-list`, `data-ws-pane`, `data-mobile-nav`. These attributes must be preserved when moving code.
- **Refs across effects** (`kanbanBoardRef`, `tagRowRef`, the once-registered real-time handler with a ref to the current list): When extracting into hooks, carry the ref along or return it from the hook; do not recreate it.
- **No new `exhaustive-deps` warnings.** Where a dependency is intentionally omitted today, keep it that way and add an explanatory comment rather than changing it on the fly.
- **Re-renders:** Keep callbacks passed to extracted components stable using `useCallback`; otherwise, e.g., every Kanban card will re-render on every keystroke.
- **Mobile and desktop:** Breakpoints via `isPhoneWidth()` and classes `sm:`/`lg:` must be carried over unchanged.

## Releases

Every push is a release. For pure refactorings, this means: accumulate commits for a step on `dev` and release as a **patch** once the step is completed and tested (CHANGELOG under "Changed": "Internal refactoring, no visible changes"). Alternatively, bundle with the next feature release.

## Done When

- None of the files from the table above exceeds ~1,000 lines (target guideline: 800),
- Logic from Step 0 is covered by tests,
- Reference screenshots remain unchanged.

Then FLAW-41 is removed from `flaws.md`.

**Result (v0.69.38):** `TasksView` 1,024, `WorkspaceView` 1,030, `App.tsx` 776, `SharedListsView` 573, `UserSettingsView` 302, `AdminSettingsView` 192 lines; `lib/api.ts` is `lib/api/` (largest file under 600). The logic from Step 0 and the new pure modules have tests (286 total), reference screenshots (57) and workflows `drag`, `ws`, and `lists` are unchanged. FLAW-41 has been removed from `flaws.md`.

## Open Questions

- Release cadence: one patch per step (5 releases) or bundle along?
- Tackle Step 5 (Settings) right away, or wait until work is needed there anyway?
