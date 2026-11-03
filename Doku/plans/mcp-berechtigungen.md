# Plan: Three-Tier MCP Permissions (Implemented in v0.72.0)

As of 2026-11-03. Goal: An API key receives the same three permission tiers per domain (Tasks, Lists, Notes, Inbox), and everything permitted by the tier can actually be executed via MCP. Currently missing most of all: modifying and deleting notes, deleting list items, reading and managing the inbox.

## The Three Tiers

| Tier | Allowed | Not Allowed |
|---|---|---|
| **Read** | list, read, search | change anything |
| **Create** | create new items (task, list item, note, inbox) | modify or delete existing items |
| **Write** | modify **and delete** existing items | – (most powerful tier) |

The tiers are technically independent permissions (as is currently the case). In the UI, "Write" automatically enables "Read" as well, because modifying items requires IDs obtained from reading; "Create" remains independently selectable (webhooks, smart home: ingestion only).

## Scopes

Existing IDs remain so that existing keys continue to work. Only marked items are new.

| Domain | Read | Create | Write |
|---|---|---|---|
| Tasks | `tasks:read` | `webhook:task` | `tasks:write` |
| Lists | `lists:read` | `webhook:list` | `lists:write` |
| Notes | `notes:read` | `notes:create` | **`notes:write`** (new) |
| Inbox | **`inbox:read`** (new) | `webhook:triage` | **`inbox:write`** (new) |

Note on `tasks:write` and `lists:write`: They currently also allow creation. This remains the case (anyone allowed to write is also allowed to create); "Create" is the narrower tier for keys intended purely for ingesting new items.

## New and Modified MCP Tools

**Notes** (`notes:write`)
- `get_note` additionally returns bullet points with their IDs (previously markdown only) so individual bullets can be targeted for modification.
- `update_note`: change title, icon, folder.
- `add_note_bullet`: add a new bullet after an existing one (or at the end), with level, type (text, to-do, heading), and text.
- `update_note_bullet`: change text of a bullet, check/uncheck to-do.
- `delete_note_bullet`: remove bullet (along with its sub-bullets).
- `delete_note`: move note to trash bin (restorable).

All bullet modifications run through the same operations as the editor (note synchronization, `internal/collab`): Anyone who currently has the note open sees updates live, and concurrent typing does not cause a conflict with the entire text. Replacing entire notes via markdown is deliberately **not** supported (as it would overwrite concurrent changes).

**Lists** (`lists:write`)
- No deletion via MCP: List items do not have a trash bin; a deleted item would be permanently gone. Agents check off items (`check_list_item`, already exists); cleanup remains the responsibility of the user.

**Inbox** (`inbox:read` / `inbox:write`)
- `list_inbox` (Read): open inbox items with text, priority, due date, hashtags; searchable.
- `convert_inbox_item` (Write): convert into a task (with task list), a note, or a list item – just like Triage.
- `discard_inbox_item` (Write): discard (lands in the Triage trash bin, restorable).
- Searching the inbox via `list_inbox` with `query` (general search remains scoped to tasks, lists, and notes).

## User Interface

Account Settings → API: instead of the current list of toggles, a **Domain × Tier** grid (4 rows, 3 columns) with a brief explanation of each tier. Chips on existing keys display the tiers per domain. Stacked vertically on mobile.

## Implementation

1. Backend: Scopes `notes:write`, `inbox:read`, `inbox:write` (`storage/apikeys.go`), permission checks in `mcpToolAllowed`, new tools in `internal/api/mcp.go` with tests (per tool: allowed with permission, rejected without; note edits appear in the open editor).
2. Frontend: Grid in `ApiKeysPanel`, labels in `lib/apiScopes.ts`.
3. Documentation: `Doku/api/` (MCP tools, permissions), help text.

Effort: medium (backend ~2/3, mostly for the note tools).

## Decided (2026-11-03)

- Inbox "Write": convert and discard, like Triage; no "Later".
- Lists: no deletion of items via MCP, checking off only.
- Notes: bullet-level editing via note synchronization; no full-note replacement.
