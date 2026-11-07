# Module: Workspace (Outliner Notes)

Code: [WorkspaceView.tsx](../../frontend/src/features/workspace/WorkspaceView.tsx) (explorer, tags, to-do rollup), [DocumentEditor.tsx](../../frontend/src/features/workspace/DocumentEditor.tsx), [OutlinerTree.tsx](../../frontend/src/features/workspace/OutlinerTree.tsx), [OutlinerBlock.tsx](../../frontend/src/features/workspace/OutlinerBlock.tsx), [CodeBlockEditor.tsx](../../frontend/src/features/workspace/CodeBlockEditor.tsx), [LinkModal.tsx](../../frontend/src/features/workspace/LinkModal.tsx); Backend: document, folder, and tag handlers, sync handler in `internal/api/docsync.go`, `internal/collab`, `internal/storage/docsync.go`.

## Data Storage

- A note is a record in `documents` plus a tree of blocks in `blocks` (`parent_id`, sort key `order_key`). Every change goes through `internal/collab` and is recorded in the `doc_ops` log. Depth level and position for the UI are calculated by the server on read. The log and deleted blocks are compacted regularly ([database.md](../database.md#verdichtung-des-notiz-logs)). Everything resides in SQLite; there are no files on disk.
- On every change, `documents.markdown_cache` is regenerated; `block_tags` is rebuilt from `#hashtags` in the blocks.
- **Hashtag rule:** `#word` only counts at the start of text or after whitespace or `(`. Anchors in links (`example.com/blog#heading`) and words like `C#` are not tags. The same rule applies on the server (`domain.ExtractTags`) and in the browser (`lib/hashtags.ts`). On first start after migration, `migrateAnchorTags` runs a one-time cleanup of stored tags that originated solely from anchors.
- Export as `.md` is handled in the browser (button in editor, blob download).
- Block types: Headings `h1`–`h3`, `paragraph`/`text`, `bullet`, `todo`, `code`, `callout`, `divider`, `table`, `progress`, `drawing`.
- **Drawings** (`drawing`, prototype): the block content is a small JSON model (`lib/drawing/model.ts`: shapes, text, arrows docked by element id, freehand points, optional `frame` and `grid`), never SVG markup; React renders it as SVG with theme colour roles. The preview (`drawing/DrawingBlock.tsx`) fills the note's width and fits everything up to 420 px high, or shows the saved `frame` scaled to the width. The full-screen editor (`drawing/DrawingEditor.tsx`) keeps changes local, stores a draft in `localStorage` and writes the block once on closing (`set_content`, at most 100 KB like any block).

## Editor

- **Outliner:** `Enter` new block, `Tab`/`Shift+Tab` indent/outdent, `Shift+Enter` soft line break, collapse/expand blocks.
- **Zoom (Hoisting):** Clicking a bullet focuses the branch; the breadcrumb bar navigates back.
- **Drag & Drop** moves blocks including sub-branches; dragging onto another block turns it into a child item.
- **Slash commands:** `/todo`, `/link`, `/h1`, `/h2`, `/h3`, `/code` (with VS Code style syntax highlighting), `/callout`, `/divider`, `/extract` (extract branch into a separate note), `/image` (insert/upload images, aliases `/bild`, `/foto`), `/audio` (voice note/audio file, alias `/sprachnotiz`), `/diktat` (voice input with live transcription, alias `/dictate`), `/secret` (hidden value, see below), `/canvas` (drawing, aliases `/draw`, `/sketch`, `/diagram`, `/zeichnung`) (list in `OutlinerBlock.tsx`). The menu opens only at the start of text or after a space and closes with `Esc` or `Backspace`.
- **Link preview:** If a bullet point consists solely of a single `https` URL (or was inserted into an empty bullet via `/link`), MindSift displays an interactive preview card above it (`LinkPreviewCard`, fetched server-side via `/link-preview`). ✕ dismisses the card and synchronously converts the URL to `[Title](url)`.
- **Extract branch (`/extract`):** Converts the current bullet and all its children into an independent note in the same folder. The server creates the note and returns the link; the editor locally replaces the branch via the sync engine as a separate operation (Ctrl+Z reverts the extraction and moves the newly created note to the trash via `POST /documents/{id}/extract/undo`).
- **Inline note:** If a bullet contains only a link to a note (such as after `/extract`), its toolbar displays "Inline note". `POST /documents/{id}/inline` fetches the items of the linked note and moves it to the trash; the editor restores the title (including any hashtags from the link) as text and inserts the items as children, preceding any already existing items. Ctrl+Z or "Undo" restores the link and recovers the note from trash. Only works with own notes, and only as long as no other notes still link to it.
- **Merge notes:** Via drag & drop of one note onto another in the sidebar or via the three-dots menu in the note header ("Merge with another note…"). The source note owned by the user is appended as an `h2` section and moved to the trash; a toast offers full undo (`POST /documents/{id}/merge/undo`).
- **Backlinks:** Under each note, "Linked to this note (n)" lists all notes containing `[[Title]]` (including `[[Title|Text]]`, `[[Title#Section]]`, case-insensitive) along with match locations; clicking jumps directly to the bullet. Without backlinks, the section remains hidden; when collapsed, its state is remembered in the browser ([BacklinksSection.tsx](../../frontend/src/features/workspace/BacklinksSection.tsx), `GET /documents/{id}/backlinks`).
- **Hidden values (`/secret`):** For an IP address or a token in a technical note, not a password manager. The sheet sends the value once to `POST /documents/{id}/secrets`; the server stores it encrypted (`note_secrets`, key `SECRETS_KEY`) and the bullet only gets the reference `{{secret:<id>}}`. So API keys, MCP, search, sync, the Markdown export (`••••`) and copying bullets (`••••`) never see the value. The bullet shows a lock with dots ([SecretChip.tsx](../../frontend/src/features/workspace/SecretChip.tsx)); a click reveals it through a login-only endpoint for 20 s, with copy and (for editors) change buttons. The value is drawn via CSS `attr()`, so it is not part of the bullet's text. Who can see the note can reveal it; a reference copied into a note of someone without access to the original reveals nothing. A bullet moved to another note takes the value along on the next reveal or the hourly cleanup. Values no bullet references any more are kept 30 days (undo, trash), then deleted; purging the note deletes its values at once.
- **Links:** `[[Note Title]]`, Markdown links `[Title](url)`, and plain URLs are rendered as tokens; `LinkModal` assists with linking notes.
- **Pasting:** Multiline text is split into blocks based on Markdown prefixes and indentation; headings group subsequent text and code underneath.
- **Saving:** Every note in the browser runs a `DocSyncEngine` ([lib/docSync/](../../frontend/src/lib/docSync/)). The editor reports any change to the block list; the engine converts them into operations, writes them first to IndexedDB, and sends them batched (300 ms) to `POST /docs/{id}/sync`. When opened, it immediately displays the stored state, even offline.
- **Synchronization for shared or multi-tab notes**, by availability:
  1. **Push** via WebSocket or SSE: The server broadcasts `DOC_SEQ`, the engine syncs immediately (0.2–0.3 s in tests).
  2. **Long-polling** (`/docs/{id}/changes`), when a proxy blocks WebSocket and SSE or buffers SSE: equally fast.
  3. **Polling every 3 s**, if long-polling fails three times in a row (on `online`, long-polling is re-attempted).

  As long as 1 or 2 is running, the engine additionally syncs every 7 s when holding leases (renewal), otherwise every 30 s as a safeguard. Focusing a bullet acquires a lease immediately. The editor indicates the connection mode ("Live", "Live (Long-Polling)", "Syncing every 3 s").
- **Private notes** opened in only one tab sync every 30 s, plus immediately upon returning online or switching back to the tab. When leaving, the engine sends pending changes using `keepalive` and releases its leases.
- **Text conflicts:** Each text edit carries the version the user saw while typing. If someone else modified or locked the bullet in the meantime, the server creates a conflict copy; changes are never silently overwritten.
- **Locks (Leases):** The bullet with the cursor, recently left bullets for 20 s, and newly created bullets are held with a lease. Bullets held by someone else show a lock with their name and are read-only; pressing Enter inside creates a new bullet below. Deleting, merging, indenting/outdenting, and dragging are blocked on locked bullets (notice displayed at the bottom of the editor).
- **Presence:** The note header shows who else currently has the note open.
- **Conflict copies** are highlighted in color ("Conflict – version by …") with "Keep" (text replaces the original bullet or title, and the copy is removed) and "Discard".
- **Undo:** `Ctrl+Z`/`Cmd+Z` reverts the user's last change, `Ctrl+Shift+Z` or `Ctrl+Y` redoes it (also in the title and via context menu/mobile keyboards). Typing in the same bullet up to a 1 s pause counts as one step; up to 200 steps per tab. If someone else modified or locked the bullet in the meantime, the step is skipped with a notice.
- `PUT /documents/{id}` only changes icon, pin status, and folder (title is synced via the log); content changes exclusively run through the engine. The to-do rollup checks off items via a single operation through the same sync endpoint.
- **Note icon (Emoji picker):** Comprehensive emoji catalog with category tabs, search, recently used icons history (`localStorage`), and theme colors. On desktop, compact like a context menu in its own popover without a title bar; on mobile (< 640 px) as a bottom sheet with touch-friendly targets (≥ 44 px) and a `text-base` search input (preventing iOS auto-zoom). The same picker is used when creating notes, task lists, and lists (`EmojiIconButton`). "Remove" clears the icon entirely; without an icon, only the title is shown. New notes start with 🗒️.
- **Multi-bullet selection** ([OutlinerTree.tsx](../../frontend/src/features/workspace/OutlinerTree.tsx)): Dragging with the mouse across bullets selects text across bullet boundaries (CSS Highlight API, falling back to colored lines). Del/Backspace deletes just like a text editor (the remainder of the first and last bullets merge into one, bullets in between including sub-items are removed, sub-items of the last move under the first) in a single step (`onReplaceRange`, a single `Ctrl+Z` recovers everything); typing a character replaces the selection, `Ctrl+C`/`Ctrl+X` copy or cut.

## Explorer, Tags, To-Dos

- Folder tree with favorites (`doc_pins`), moving via drag & drop (`/documents/{id}/move`, `/folders/move`). Folders indicate their state via open or closed folder icons (no arrow).
- **Multiple notes** (desktop): Ctrl/Cmd+click selects individual items, Shift+click selects a range in display order (a pinned note appears twice in the tree; the range begins at the clicked location); a normal click, Escape, or clicking into empty space clears the selection. Dragging a selected note moves all selected notes together into a folder or onto the trash (merging is not available in multi-select).
- **Dragging to trash** (including single notes, on mobile via long press like moving into folders) moves items to the trash; a toast offers "Undo".
- **Tags:** All `#hashtags` are aggregated (`/workspace/tags`). A tag page contains its own freeform note (`tag_pages`) and displays below it each note containing matches as a fixed heading, followed by the actual outliner of bullets containing the hashtag along with their children (`DocumentEditor` with `variant="tag"`, separate sync connection per note, loaded only when scrolled into view). Edits apply directly inside the note; a bullet without a hashtag (removed or newly created via Enter) remains visible as long as the cursor is inside it, and disappears once the cursor leaves. Note order is preserved while the page remains open.
- **To-Do Rollup:** The "To-Dos" view aggregates all `todo` blocks across all notes, filterable by folder. Checking off items in the rollup updates the block in the note.
- **Enhanced Tasks:** A `todo` block can be tracked as a linked task (`/documents/{id}/blocks/{blockId}/enhanced-task`); completion status stays synchronized between note and task view.

## Trash

- Deleting (individually or with a folder) moves user-owned notes to the trash (`is_archived = 1`). Deleting a shared note not owned by the user merely removes their share.
- Notes in the trash are excluded from the tree, search, export, and stats, and are invisible to all recipients (`DocRole` = no role). Owners and deleting users see them read-only with an info banner and "Restore"; rename, move, and share actions are rejected.
- A "Trash" entry with a counter sits at the bottom of the folder sidebar and in the mobile menu. The list displays folder and deletion timestamp; "Delete permanently" and "Empty trash" require a second confirmation tap.
- Restoring recreates a previously deleted folder; if a shared folder no longer exists, the note is placed at the root level. Shares remain intact. After the owner's retention period expires (Account Settings → Data Retention, default 30 days after deletion), the server permanently deletes the note ([retention.go](../../internal/storage/retention.go)).

## Sharing

- Individual notes and entire **shared folders** can be shared with users or groups – with either the **Editor** (`write`) or **Viewer** (`read`) role ([sharing-and-permissions.md](../sharing-and-permissions.md)). Editors modify content and structure via the sync engine; viewers see changes live.
- Recipients organize shared notes and folders within their own folder tree (`doc_user_folders`, `workspace_folder_mounts`) without affecting the owner's hierarchy.
- Changes reach open windows via the `DOC_SEQ` wake-up call followed by sync; note lists update via `DOC_UPDATED` ([websocket.md](../api/websocket.md)).

## Limitations

- No concurrent editing within the same individual bullet (per-bullet leases and conflict copies instead of character-by-character merging), no remote cursor display, no version history.
- No virtualization for long documents; very large notes may become sluggish on mobile devices *(unmeasured)*.
- ~~Search (`/search`) only covers titles and contents of personal notes~~: With global FTS5 search (`Cmd+K` / `Ctrl+K` / `/`), both titles and block contents of all accessible notes (personal and shared) are searchable.

## Export as Markdown Archive

Account Settings → Export & Import → "Download Markdown archive" (`GET /export/markdown`, code: [export_markdown.go](../../internal/storage/export_markdown.go)).

- Folders and notes reflect the user's view (own folders, mounted shared folders, notes shared with them); empty folders are preserved.
- Each note: YAML frontmatter (`title`, `icon`, `tags`, `created_at`, `updated_at`) and Markdown formatted for immediate rendering in Obsidian: top-level headings, dividers, callout boxes (`> [!note]`), and code blocks as top-level blocks with their children shifted forward one level; everything else as a list indented with one tab per level, to-dos formatted as `- [ ]`.
- Filenames are sanitized across operating systems (no `/ \ : * ? " < > |`, never `.`/`..`); duplicate titles receive " (2)".
- The ZIP is streamed directly to the response while reading data, without temporary files.

## Import

Account Settings → Export & Import → "Import Data", with **two separate paths** (code: [import_markdown.go](../../internal/storage/import_markdown.go), [ImportCard.tsx](../../frontend/src/features/settings/ImportCard.tsx)):

| Method | Endpoint | Files | Result |
|---|---|---|---|
| MindSift Data | `POST /import/mindsift` | Backup ZIP or JSON (`/export`) or Markdown archive (`/export/markdown`), format is auto-detected | Notes placed in their folders, task lists with subtasks, due dates, priorities, and notes, lists with quantities, categories, and completion status, plus Triage thoughts for JSON backups. Third-party content merely shared with the exporter in JSON is skipped. |
| Obsidian Vault | `POST /import/obsidian` | ZIP of a vault | Everything imported into a new folder named after the vault, preserving subfolders. Checkboxes remain checkboxes, frontmatter tags become `#hashtags`, callouts become callout boxes, wikilinks remain `[[…]]`. Hidden folders (`.obsidian`, `.trash`) are ignored, attachments skipped. |

- **Preview:** The UI first uploads the file with `?preview=1`. The server reads and validates everything, reporting what would be created (including skipped files with reasons), but writes nothing. Only clicking "Import now" creates the data.
- **Append or Restore** (MindSift data only): "Append" only adds new items; existing items remain unchanged. "Restore" (`?mode=restore`, in the UI only after confirming a warning dialog) wipes all existing personal notes, folders, tasks, thoughts, and lists beforehand – only after the file has been fully read and validated, so a corrupted file will not erase anything. Third-party content shared with the user is retained. Obsidian import always appends.
- **Markdown → Note:** Lists preserve their nesting (tabs or spaces), content under a heading is indented beneath it (counterpart to export), paragraphs become bullets, code blocks become code blocks.
- **Limits:** Upload max 100 MB, single note max 10 MB, uncompressed total max 500 MB, at most 20,000 files. Paths containing `..` or absolute paths are sanitized and contained within the target folder.
- If an import aborts due to an error, items created up to that point are retained; the error message identifies the element that failed.
