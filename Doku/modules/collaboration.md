# Module: Collaborative Note Editing

Code: [internal/collab/](../../internal/collab/) (rules, without database), [internal/storage/docsync.go](../../internal/storage/docsync.go) (log, snapshot, roles, compaction), [internal/api/docsync.go](../../internal/api/docsync.go) (endpoints, background job), [frontend/src/lib/docSync/](../../frontend/src/lib/docSync/) (engine in the browser), UI in [DocumentEditor.tsx](../../frontend/src/features/workspace/DocumentEditor.tsx), [OutlinerTree.tsx](../../frontend/src/features/workspace/OutlinerTree.tsx), and [OutlinerBlock.tsx](../../frontend/src/features/workspace/OutlinerBlock.tsx).

Multiple people and devices edit the same note simultaneously. Every note, including private ones, saves via this mechanism; there is no secondary storage path.

## Requirements

1. **No data loss.** Whatever someone typed ends up in the note, even after connection loss, reloads, or concurrent editing of the same bullet.
2. **Works without WebSocket.** Behind proxies that block WebSockets or buffer streams, editing remains fully functional, just with slightly higher latency.
3. **Works with poor network connectivity.** Inputs are saved locally and transmitted reliably later, even after days offline.
4. **Clear conflict resolution rules.** If two people edit the same bullet, one gets precedence. The other's text is preserved as a conflict copy.
5. **Permissions.** Notes and folders can be shared as *Editor* or *Viewer*; the server verifies this on every modification.

## Approach

**Server-authoritative operations log with per-block versions and block leases.** Data always flows via standard HTTP requests; WebSocket, SSE, and long-polling serve only as wake-up calls.

| Component | Responsibility |
|---|---|
| **Operations Log** | Every modification is a small operation (change text, insert block, move, delete …). The server validates and applies it, appending the resulting effects with a sequential `seq` number per note to the log. Clients who know their `seq` fetch everything after it. |
| **Version per Block** | Each text modification specifies the block version the user saw while typing. If it no longer matches, a conflict has occurred. |
| **Lease per Block** | Clicking into a bullet holds it for 20 s, renewed as long as the user works there. Others see "Anna is editing …" and cannot edit that specific bullet during that time, while all other bullets remain editable, even within the same branch. |
| **Conflict Copy** | If a conflict occurs nonetheless (lease expired, someone was offline), the block retains the first-saved version; the conflicting text is inserted directly below as a highlighted block. |
| **Local Queue** | Every change is first stored in IndexedDB and sent from there. Each operation has a unique ID; duplicate transmissions are harmless. |

### Why Not CRDT (Yjs/Automerge) or OT

- **CRDT** merges character by character. Doing this would require a full Yjs implementation in the Go backend to evaluate permissions, hashtags, and Markdown server-side; mature implementations do not exist in Go. Without it, the server would merely be an opaque binary storage it cannot validate. An earlier attempt failed because of this.
- **OT** requires a bug-free transformation core for every operation type; difficult to get right and hard to test.
- The desired behavior is that for any bullet, **one party takes precedence**. Leases plus version checking are straightforward to understand, fully verifiable server-side, and testable against network failures.
- Deliberate trade-off: Two people cannot type simultaneously in the **same** bullet. In **different** bullets, even within the same branch, they can.

## Data Model

Details in [database.md](../database.md).

- **Tree instead of a flat list.** `blocks.parent_id` (empty = top level) and `blocks.order_key` sort siblings. Indenting or moving a branch is *one* operation on *one* block. Depth level and position for the UI are calculated by the server on read.
- **Sort keys (Fractional Index).** A new block between `a0` and `a1` gets a key in between; renumbering never occurs. Identical keys (two simultaneous insertions) are broken by block ID. Go (`orderkey.go`) and TypeScript (`orderKey.ts`) generate identical keys, validated using shared test vectors.
- **Tombstones.** Deleted blocks remain with `deleted = 1` and `deleted_at`. A late text change restores the block rather than being lost. After 30 days, they are permanently purged (see [Compaction](#compaction)).
- **Log** `doc_ops` (effects per `seq`) and **idempotency** `doc_op_results` (result per operation ID). Replaying the log from a snapshot yields the exact server state.
- **Leases and sessions live in memory** (`collab.LeaseManager`). They are short-lived; after a restart, clients automatically request them again. MindSift runs as a single instance, so this fits well.
- **Derived data** (`markdown_cache`, search text, `tags`, `block_tags`) are generated in the same transaction as the change.

## Protocol

Endpoints and fields: [api/rest.md](../api/rest.md#gemeinsames-bearbeiten-von-notizen).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/docs/{id}/snapshot` | All blocks including tombstones, title, `headSeq`, own role, `shared` |
| POST | `/api/v1/docs/{id}/sync` | **Single call for everything:** submit own operations, renew leases, fetch new log entries |
| GET | `/api/v1/docs/{id}/changes?since=N&wait=25` | Long-polling: responds as soon as the note (or leases/presence) changes, at latest after `wait` seconds |
| POST | `/api/v1/docs/{id}/leave` | Terminate session, release leases |

Operations: `insert`, `set_content`, `set_props` (type, checked, collapsed, language, conflict resolved), `move`, `delete`, `restore`, `set_title`. The log additionally contains `purge` (compaction).

### Server Rules

All operations on a note run sequentially: one mutex per note and one SQLite transaction per `/sync`. "First come, first served" is therefore always unambiguous.

1. **Idempotency:** If the operation ID is already known, the stored result is returned without re-applying. Lost responses are harmless.
2. **Permissions:** Operations require role `owner` or `editor`, otherwise `403`. Block IDs of other notes are prohibited.
3. **`set_content`:** If *another* client holds a lease or the base version does not match → **Conflict**. Identical text → applied without bumping the version. Deleted block → restore (if parent block is deleted, place under the nearest surviving ancestor) and apply. Permanently purged block → text is appended as a new block at the end.
4. **Conflict:** The block retains its content. Directly after it, a block is created with the rejected text, `conflictOf` and `conflictAuthor` set, using a deterministic ID (`blk_cf_` + hash of the operation ID) so retries do not create a duplicate copy. The same applies to the title with its own title version.
5. **`move`:** Rejected on cycles, when target parent is deleted, or when someone else holds the block itself. Sub-items move along; anyone typing within them simply continues typing at the new location.
6. **`delete`:** Rejected if someone else holds a block within the branch; otherwise a tombstone is created for the entire branch.
7. **`insert`:** If the parent block is deleted, inserted under the nearest surviving ancestor; if permanently purged, inserted at top level.
8. **Leases:** Granted only if free, expired, or already owned by the same client; valid for 20 s from the last confirmation. `leases.hold` is always the complete list. Newly inserted blocks and conflict copies are automatically assigned to their author.
9. **No lease on parent blocks:** Inserting, indenting, and outdenting under a parent block do not require a lease on that parent.

### Typing Flow

```mermaid
sequenceDiagram
  participant A as Client Anna
  participant S as Server
  participant B as Client Ben
  A->>S: /sync leases.hold=[b9]
  S-->>A: granted b9
  S--)B: DOC_SEQ (wake-up)
  B->>S: /sync lastSeq=412
  S-->>B: leases.others: b9 = Anna (bullet locked)
  A->>S: /sync op set_content b9 base=7
  S-->>A: applied, seq 414
  S--)B: DOC_SEQ headSeq=414
  B->>S: /sync lastSeq=413
  S-->>B: ops [set_content b9 v8]
```

## Client (`DocSyncEngine`)

- **States:** *confirmed state* (from server, with `lastSeq`) and *queue* (own, unconfirmed operations). The UI displays the confirmed state with the local queue overlaid on top; this is handled by `model.ts` following the same rules as the server.
- **Editor integration:** Editor components work with a flat list (depth level + order). `diff.ts` translates every modification into operations via diffing.
- **Persistence:** Queue and confirmed state reside in IndexedDB, together with the ID of the signed-in user. Opening a note immediately renders the stored state, even offline; if the note's metadata cannot be fetched without a connection, the editor keeps working on the stored state. Changes waiting in notes that are no longer open (typed offline, then the note was left) are sent at app start and when the connection returns ([flushClosed.ts](../../frontend/src/lib/docSync/flushClosed.ts)), only for the user they were stored for. A state stored for another account is never loaded or sent. Signing out asks first when changes are unsent (`askConfirm`), then deletes all stored notes; the offline notice counts notes with unsent text and, when tapped, explains that it lives only in this browser (survives closing and restarts, lost on sign-out, cleared browser data or in a private window). While changes wait offline, the app asks the browser once for persistent storage (`navigator.storage.persist()`), so it is not cleared when disk space runs low.
- **Transmission:** Batched after 300 ms, strictly one `/sync` at a time; retries with exponential backoff 1 s, 2 s, 4 s … up to 30 s max. Multiple text edits to a block are merged; the base version remains that of the first edit (what the user saw when typing), ensuring no concurrent remote change is ever overwritten.
- **Leases:**
  - Typing never blocks waiting for a lease. On focus, a lease request is dispatched immediately.
  - New bullets (Enter, paste) immediately belong to the creator.
  - Left bullets remain held for 7 s and are released with a sync right then; after 60 s without input, the focused bullet is also released.
  - Remotely locked bullets display a lock with the user's name and are read-only; pressing Enter inside creates a new bullet below. Deleting, merging, indenting/outdenting, and dragging that touch a locked bullet are prevented entirely (notice shown at the bottom of the editor).
  - A text field sends text on leaving only if the user changed it since it last took over the block's text; an unchanged field takes over remote text even with the cursor inside (so a locked bullet shows the other person typing). As a second guard, the engine drops a text change that only repeats what the editor last showed in agreement with it (`uiSeen`) while the block has moved on: such a field held old text and would otherwise turn the other person's text into a conflict copy.
- **Conflicts:** Conflict copies are highlighted in color, with "Keep" (replaces the original text) and "Discard" actions. Both check the leases of the original and the copy beforehand.
- **Background and network:** When hiding the page, the engine sends pending changes using `keepalive` and releases its leases; upon `online` and tab reactivation, it synchronizes immediately.
- **Permission revocation:** The next `/sync` returns `403` or `404`. The engine does not discard the queue, but stops sending and displays the error.
- **Reloading:** If the server reports `resync` (client ahead or behind the compacted log floor) or a `seq` is missing, the engine reloads the snapshot; the queue is retained and reapplied afterwards.

## Transport: Robust Even Behind Proxies

Data flows exclusively via `/sync` and `/snapshot`. Push channels only notify that "Note X now has `headSeq` N" (`DOC_SEQ` in room `doc:<id>`, see [api/websocket.md](../api/websocket.md)).

| Level | Failure detected by | Fallback to |
|---|---|---|
| 1. WebSocket | Connection error or 35 s without `PONG` to the `PING` sent every 15 s (WebSocket accepted, but nothing comes through) | SSE |
| 2. SSE | First event does not arrive within 5 s (proxy buffering); then applies to the entire tab | Long-polling |
| 3. Long-polling: app-wide (`/events/poll`, `DOC_SEQ` same as SSE), otherwise dedicated (`/changes`, 25 s) | 3 consecutive failures | Polling interval |
| 4. Polling interval | – | Poll every 3 s; on `online`, long-polling is re-attempted |

Additionally, as long as levels 1–3 are active: sync every 7 s when the engine holds leases (renewal), otherwise every 30 s as a safeguard. The editor indicates the connection mode ("Live", "Live (Long-Polling)", "Syncing every 3 s"). Measured in browser tests: 0.2–0.3 s via WebSocket, SSE, and long-polling, around 3 s via polling interval.

Long-polling stays at 25 s, below standard proxy limits (Nginx 60 s, Cloudflare 100 s). The server removes the write timeout for streams and long-polling. Only users allowed to read the note may join rooms. Proxy examples: [reverse-proxy.md](../reverse-proxy.md).

## Permissions

- Roles per note: `owner`, `editor`, `viewer`. The effective role is the highest among ownership, direct share, group share, and shared folder share. A central function `Store.DocRole` determines access for snapshot, sync, long-polling, room joining, and task links.
- Only the owner manages shares and deletes the note. Editors are otherwise permitted all actions: content, structure, title, and icon.
- Shares are stored in `doc_shares`, `doc_team_shares`, and `workspace_folder_shares` (`read`/`write`). Merging them into a single table was deliberately avoided: `DocRole` already handles resolution centrally, and rewriting around 20 visibility queries would only introduce risk. More details: [sharing-and-permissions.md](../sharing-and-permissions.md).

## Private Notes

Same model, but lightweight: As long as a note is not shared (`shared = false`) and only open in a single tab (`sessions = 1`), there are no leases, no heartbeat, and only the 30 s poll interval. If a second device opens the note or it is shared, all open clients switch to the full collaborative flow with the next response. Compared to previously saving the entire document every 800 ms, this model only transmits and writes modified blocks.

## Undo and Redo

- `Ctrl+Z`/`Cmd+Z` reverts the last **own** change, `Ctrl+Shift+Z` or `Ctrl+Y` redoes it. External changes remain untouched.
- For every local change, the engine computes the inverse operation (`undo.ts`) and submits it as a normal operation; server and log require no special handling.
- Typing within the same bullet is grouped into a single step up to a 1 s pause; inserting, deleting, indenting, moving, checking off, and multiline pasting are each a single step. Up to 200 steps per tab and note.
- If someone else has modified the bullet in the meantime or is currently holding it, the undo step is skipped with a notice, never blindly overwritten.
- Native text field undo is intercepted (`keydown` and `beforeinput` with `historyUndo`) so browser undo and application undo do not conflict with each other.

## Compaction

A background job (`startCompaction`) runs at startup and every 6 hours thereafter:

| Item | Retention |
|---|---|
| Log of shared notes | 30 days; the floor is stored in `documents.log_floor` |
| Log of private notes | 7 days |
| Tombstones | 30 days after `deleted_at`, then permanently removed via log entry `purge` (open editors apply this without reloading) |
| Idempotency results | 90 days |
| In-memory leases and sessions | Expired entries are removed |

Clients behind the floor reload the snapshot while preserving their local queue. Boundaries of this approach: After 30 days, deleted blocks are permanently gone; undo is no longer possible for them. Text typed offline into a block that was deleted more than 30 days ago is appended as a new block at the end of the note. Submitting an operation again after more than 90 days is no longer recognized as a retry; text changes will at most create a conflict copy.

## Tests

| Level | Scope | Location |
|---|---|---|
| Rules | Conflict matrix covering lease, version, tombstone, move, delete, purge | `internal/collab/ops_test.go` |
| Simulation | 4 clients, 25 seeds × 600 steps over a network that drops and duplicates requests and responses; clients go offline; intermittent compaction. Verified: convergence, valid tree, every operation applied exactly once, no text lost. Validated via counter-tests (deliberately injected faults). | `internal/storage/docsync_sim_test.go` |
| Storage and API | Log ↔ snapshot, roles, long-polling, compaction | `internal/storage/docsync_test.go`, `internal/api/docsync_test.go` |
| Browser Engine | Vitest with mock server and network, `fake-indexeddb`: offline, reloads, dropped responses, push transitions, compaction | `frontend/src/lib/docSync/__tests__/` |
| End-to-End | Playwright with two users: collaborative typing, sharing, locks, conflicts, undo, all transport levels with blocked WebSocket/SSE; offline: the note tree after starting without connection (only notes opened on the device open), restarts with unsent text, merging with someone who edited, added and deleted bullets meanwhile | `e2e/` (`e2e/run.sh`) |
