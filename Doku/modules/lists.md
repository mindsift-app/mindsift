# Module: Shared Lists

Shopping, packing, and checklists for collaboration. Code: [SharedListsView.tsx](../../frontend/src/features/lists/SharedListsView.tsx); Backend: `*List*` handlers in [server.go](../../internal/api/server.go), `Store.CreateList` and related methods.

## Data Model

- `lists`: Owner, `title`, `icon`, `list_type` (`shopping`, `checklist`, `vacation`).
- `list_items`: `content`, `category`, `quantity`, `is_completed`, `completed_by(_name)`, `created_by`, `sort_order`.
- `list_shares`: Target (user or group) and role `editor` or `viewer`.

## Features

- **Categories via hashtag:** `Oat milk #Refrigerated` lands in the "Refrigerated" category. Categories are displayed alphabetically as sections; the input suggests existing hashtags.
- **Quantity:** Field `quantity` (e.g. `2x`, `500g`).
- **Drag & Drop** reorders items; dragging an item into another category updates the hashtag in the text (`items/reorder` with `category` and `content`).
- **Checking off items** records who completed them and when; completed items appear in a dedicated section and can be removed via "Clear completed" (`clear-completed`). After the list owner's retention period expires (Account Settings → Data Retention, default 7 days), the server deletes checked-off items automatically ([retention.go](../../internal/storage/retention.go)).
- **Sharing** via the `UnifiedShareModal` dialog (Editor or Read-Only). A viewer sees updates in real time, but cannot make changes.
- **Live Sync:** Events `ITEM_*` and `LIST_*` in the list's room ([websocket.md](../api/websocket.md)). Checking off items appears instantly for all participants.
- **Added by:** In shared lists, each entry displays a small avatar of the person who created it (`createdBy`, `createdByName`). Entries created prior to this feature have no author and display nothing.
- **Tabs** show open items as a round badge counter and users with access as an avatar stack ([ui-patterns.md](../ui-patterns.md)); the API provides them per list as `members`.
- Thoughts from Triage can be converted directly into list items.
