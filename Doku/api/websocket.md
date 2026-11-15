# Real-Time: WebSocket, SSE, and Long Polling

The server distributes changes as JSON events to connected clients. Events are generated **after** a REST mutation; the only write channel over the connection is live drawing (`DRAW_*`, see below). Implementation: [hub.go](../../internal/ws/hub.go), Client: [realtime.ts](../../frontend/src/lib/api/realtime.ts).

> No CRDTs, and cursor presence only in live drawings. Earlier versions of this documentation described DocRooms, `clientId` echo suppression, and Yjs; these no longer exist.

## Transports

| Transport | Endpoint | Notes |
|---|---|---|
| WebSocket | `GET /api/v1/ws` (also `/ws/lists/{id}`) | Ping every 30 s, read deadline 60 s, messages up to 4 MB |
| SSE | `GET /api/v1/events` | Comment ping every 15 s, header `X-Accel-Buffering: no` |
| Long Polling | `POST /api/v1/events/poll` → `{pollId}`, then `GET /api/v1/events/poll/{pollId}?wait=25` | Response `{events: [...]}`, as soon as events are available, returns empty after at most `wait` s; `404` = expired, reopen |

The client first attempts WebSocket and falls back to SSE for the tab's session in the following cases:

- Connection cannot be established within 2.5 s, or terminates uncleanly (e.g. code 1006/1008).
- **Heartbeat:** Every 15 s, the client sends `{"event":"PING"}` and the server responds with `PONG`. If no message is received for 35 s, the WebSocket is considered dead (e.g. proxy accepted the upgrade but forwards nothing).

Over SSE, the server first sends `SSE_CONNECTED` with an `sseId`; only then is SSE considered connected. If this initial event does not arrive within 5 s of starting the request (opened or not: a proxy may hold the request without ever answering), or if the stream fails twice although the server answered the ticket request, a proxy is in the way: SSE is disabled for the tab and long polling takes over. Rooms are subscribed to via `POST /api/v1/events/rooms` (`sseId`, `room`, `action`: `join`/`leave`).

Without WebSocket and SSE, the client retrieves events via **long polling**: It opens a polling connection (passing initial rooms in `rooms` or subscribing later as with SSE via `POST /events/rooms` using the `pollId` as `sseId`), the server buffers its events (up to 256), and each poll request waits up to 25 s. If a polling connection is not polled for 2 minutes, the server closes it. Requires an active session; API keys are not accepted. This allows task and list updates to arrive live even behind restrictive proxies. Note synchronization then uses the same connection as a wake-up signal; without it, note sync falls back to its own long polling (`GET /docs/{id}/changes`) and ultimately to polling every 3 s (see [modules/collaboration.md](../modules/collaboration.md)).

**Authentication:** Browsers obtain a one-time ticket right before connecting (`POST /auth/stream-ticket` with standard `Authorization` header → `{ticket, expiresIn: 60}`) and append it as `?ticket=`; it is single-use and valid for 60 seconds, and is immediately invalidated if all sessions are revoked. Other clients may send the `Authorization` header instead. Session tokens in the URL and API keys are rejected (`401`). Upon logout, "revoke all sessions", password changes, or account deactivation, the server terminates all streams for that account; clients with a valid session reconnect using a new ticket. When `BASE_URL` is set, the WebSocket only accepts connections from this address or the requested host.

**Rooms:** Every room join (room in URL, `JOIN_ROOM`, SSE query parameters `rooms`/`docId`, `POST /events/rooms`) is validated: `doc:<id>` requires read access to the note; otherwise the ID must be a readable shared list. Unauthorized rooms are ignored; `POST /events/rooms` responds with `403` in such cases. SSE rooms can only be modified by the owner of the respective `sseId`.

## Message Format

```json
{ "event": "TASK_UPDATED", "listId": "", "payload": { … }, "timestamp": "2026-10-27T12:00:00Z" }
```

Client → Server: The server processes `{"event":"JOIN_ROOM","room":"<id>"}`, `{"event":"LEAVE_ROOM","room":"<id>"}`, `{"event":"PING"}` (replies with `PONG`) and the live drawing messages `DRAW_*` (below). Rooms are named `doc:<docId>` for notes, `drawing:<docId>:<blockId>` for live drawings (read access to the note) or `<listId>` for shared lists.

## Delivery

| Channel | Recipients |
|---|---|
| User channel (`BroadcastToUser`) | All connections belonging to a user |
| Room (`BroadcastRoom`, `Broadcast`) | Connections in the room |
| Multiple users (`BroadcastToUsers`) | All connections of a computed user group, e.g. owners and members of a task list |

## Events

| Event | Trigger | Channel |
|---|---|---|
| `TASK_CREATED` | `POST /inbox`, webhook | Owner and list members |
| `TASK_UPDATED` | `PATCH /thoughts/{id}`, triage | Owner and members of old and new list |
| `TASK_DELETED` | `DELETE /thoughts/{id}` | Owner and list members |
| `TASK_REORDERED` | Reordering tasks (payload: `taskListId`, `items[{id, sortOrder, kanbanStatus, isCompleted}]` as stored, `skipped`, `reload`, `userId`; only sent when something changed) | Members of all affected lists |
| `TASK_LIST_UPDATED` / `TASK_LIST_DELETED` | Update, (un)share, or delete list; payload only `{id}`, clients reload their lists | Members before and after modification |
| `DOC_CREATED`, `DOC_UPDATED`, `DOC_DELETED` | Create/update/delete note, note shares, note restored from the trash (`DOC_CREATED`). Payload of the first two: the note as each person's note list has it (`GET /documents`: no bullets, with `openTodos`, `tagCounts`, `tagOpenTodos`); `DOC_DELETED` only `{id}` (deleting a folder sends `WORKSPACE_FOLDERS_UPDATED` `deleted` instead) | Authorized users |
| `DOC_COUNTS` | Bullets of a note changed (sync, a linked task ticked): `{id, openTodos, tagCounts, tagOpenTodos}`, the counts the note list shows, the same for everyone. Checked at most every 3 s per note (two grouped queries, [doc_counts.go](../../internal/api/doc_counts.go)) and sent only when they differ from the counts sent last (the first check after a server start always sends) | Authorized users |
| `DOC_SEQ` | Note change, a lease changing hands (renewals do not count), or a new session (`docId`, `headSeq`); clients fetch data via `/docs/{id}/sync` | Room `doc:<id>` |
| `WORKSPACE_FOLDERS_UPDATED` | Folders/mounts modified; `type` says what changed (below) | User; for shared folders, owner and all collaborators |
| `LIST_CREATED`, `LIST_UPDATED`, `LIST_DELETED`, `LIST_SHARED`, `LIST_UNSHARED`, `LIST_CLEARED` | List administration | User or list room |
| `ITEM_CREATED`, `ITEM_UPDATED`, `ITEM_TOGGLED`, `ITEM_DELETED`, `ITEM_REORDERED` | List items | List room |
| `USER_PRESENCE` | Connection connected/disconnected (`onlineCount`) | Room |
| `DEMO_RESET` | Periodic reset in demo mode; clients invalidate local caches and reload data | All active connections |
| `SSE_CONNECTED` | SSE only, sent immediately after connecting | Connection |

### `WORKSPACE_FOLDERS_UPDATED` types

| `type` | Payload besides `type` | Sent after | The app fetches |
|---|---|---|---|
| `created` | `path` | `POST /folders` | the folders |
| `moved` | `sourcePath`, `newPath` | `POST /folders/move`; a `DOC_UPDATED` per moved note before it | the folders |
| `deleted` | `path`, `deletedDocIds` (notes now in the trash) | `DELETE /folders` | the folders and the trash; the note list only if other notes it holds were in the folder (shared notes placed there go back to the top level) |
| `deleted` (no `path`) | `deletedDocIds` (the notes of the folder this person had access to) | `DELETE /folders` by someone else; one event per person instead of a `DOC_DELETED` per note | the folders and the trash, once |
| `restored` | `restored` (note id, or `folder`) | restoring a note or folder from the trash; a `DOC_CREATED` per note before it | the folders and the trash (the restoring app fetches the folders itself as well, so empty subfolders show without a realtime connection) |
| `noteMoved` | `docId` | `POST /documents/{id}/move`; `DOC_UPDATED` before it | the folders and the trash; the note list only if the note is new there |
| `mount` | `folderId`/`mountPath` or `sourcePath`/`newPath` | a shared folder placed elsewhere | everything (folders, shared folders, note list, trash) |
| `shared` | `folderId` | shared folder created, deleted, shared or unshared | everything |

An event without `type` (or of a type the app does not know) makes it fetch everything.

## Live Drawing

Several people draw in one drawing bullet at once (concept: [architecture.md](../architecture.md#collaboration-live-drawing)). Messages from the browser go over the WebSocket only, as `{"event": "DRAW_…", "payload": {"docId", "blockId", …}}`, at most 1 MB each. Watching works on every transport: SSE and long-poll connections register with `POST /docs/{id}/drawings/{blockId}/watch` (`{sseId}`) and then receive the room's events.

| Client → Server | Payload (besides `docId`, `blockId`) | Effect |
|---|---|---|
| `DRAW_JOIN` | `base` (block content when opened), `els` (own whole state: elements with `ver`, `nonce`, tombstones), `grid` | Draw along (write access). Starts a session without one (host), resumes one everyone left within 10 min if `base` matches, or joins a running one; merges `els` by version. Answer `DRAW_STATE`; joining again after a lost connection or a server restart works the same way. A connection draws in one drawing at a time: joining another leaves the previous one. Limits per person and server: [architecture.md](../architecture.md#collaboration-live-drawing) |
| `DRAW_WATCH` | – | Watch (read access); answer `DRAW_STATE` (`active: false` without a session) |
| `DRAW_OPS` | `els` (changed elements and tombstones), `order` (new order of the ids, optional), `grid` (optional) | Merged by version; the winners go to the room as `DRAW_OPS`, the sender gets `DRAW_ACK` |
| `DRAW_PRESENCE` | `x`, `y` (drawing coordinates), `gone`, `touch`, `sel` (selected ids) | Pointer and selection, at most 30 a second, the rest dropped |
| `DRAW_SYNC` | – | The whole state again as `DRAW_STATE` (after a gap in `seq`) |
| `DRAW_LEAVE` | – | Leave (drawing or watching); the host's leaving hands over to the person drawing longest |
| `DRAW_DONE` | `clientId` (the note's sync client) | Host only: ends the session; the host gets `DRAW_END` with the final state and saves it via `/docs/{id}/sync`, the bullet's lease goes to `clientId` |
| `DRAW_DISCARD` | – | Host only: ends the session without saving |

| Event | Payload (besides `docId`, `blockId`) | Recipients |
|---|---|---|
| `DRAW_STATE` | `active`, `host`, `participants`, `watchers` (each `{id, userId, name}`, `id` = connection), `els`, `order`, `grid`, `seq`, `you` | The joining or watching connection |
| `DRAW_OPS` | `from`, `els`, `order`, `grid`, `seq` | Room, without the sender |
| `DRAW_ACK` | `seq` | Sender of `DRAW_OPS` |
| `DRAW_PEOPLE` | `active`, `host`, `participants`, `watchers` | Room (joined, left, new host) |
| `DRAW_PRESENCE` | `from`, `userId`, `name`, `x`, `y`, `gone`, `touch`, `sel` | Room, without the sender |
| `DRAW_END` | `reason` (`done`, `discard`, `expired`), `by`; for the host also the final `els`, `order`, `grid` | Room |
| `DRAW_ERROR` | `code`: `forbidden`, `locked` (someone edits alone), `no_session`, `not_host`, `limit` (session too large), `too_many` (the person keeps too many sessions going), `busy` (the server holds as many sessions or bytes as it takes), `rate` (changes, or joining and watching, too fast), `invalid` | The sender |

`seq` counts the merged changes of a session; a browser that sees a gap (a message was dropped because its connection was too slow) fetches the state again (`DRAW_SYNC`, or `GET …/live` without WebSocket).

## Frontend Behavior

- The global connection (a singleton) forwards every message as a browser event `mindsift:ws`; views (`TasksView`, `WorkspaceView`, `SharedListsView`) listen for it and reload or patch their state.
- After a disconnect, the client reconnects with a backoff delay. Once it is back, counters (`GET /stats`) and the triage deck load once, since the events of the gap are lost.
- **Counters and triage deck** ([useSessionBootstrap.ts](../../frontend/src/app/useSessionBootstrap.ts), [realtimeCounters.ts](../../frontend/src/app/realtimeCounters.ts)): in a shared list every change reaches every member, so the app reacts only as far as an event can change something. `TASK_*`, `DOC_*`, `ITEM_*` and `LIST_*` reload the counters, except `DOC_SEQ` and `ITEM_REORDERED`. An event within 3 s of a change this tab sent counts as its echo and reloads them after 300 ms; everyone else's changes reload them in a shared rhythm: 1.5 s after the first event, then at most once every 5 s while events keep coming, and once after the last one. The deck reloads only for `TASK_CREATED`/`TASK_UPDATED` of a thought with status `inbox` and for `TASK_CREATED`/`TASK_UPDATED`/`TASK_DELETED` of a thought that is in the deck, not for task changes in task lists. A hidden tab ignores these events and loads everything when it becomes visible.
- **Reloads because of events** ([realtimeReload.ts](../../frontend/src/lib/realtimeReload.ts)): views apply what an event carries; only what it cannot carry is loaded, in the same rhythm as the counters (300 ms after an own change, otherwise 1.5 s after the first event and at most once every 5 s, one request per burst). A hidden tab puts the reload off until it is visible again, and a reconnect reloads once.
- **Notification center** ([notificationCenter.ts](../../frontend/src/components/notificationCenter.ts)): both bells (phone header and desktop rail) share one list, loaded when the first one mounts, when a bell opens and after a reconnect. `NOTIFICATION` puts the entry on top (a `watched` entry replaces the earlier ones of the same task, as the server does), `NOTIFICATIONS_READ` marks the named ids read (all without ids), `NOTIFICATIONS_CLEARED` empties it, all without a request. Only a `watched` entry without a target (the task was deleted) loads the list, since the entry it replaced is not known.
- **Shopping lists** ([useListRealtime.ts](../../frontend/src/features/lists/useListRealtime.ts)): the open list's room is joined on the app's connection; `ITEM_*`, `LIST_CLEARED` and `ITEM_REORDERED` (places, category and text of the entries) are applied. `LIST_UPDATED` takes title, icon, type, entries, shares and members from the payload but keeps this person's `isOwner`/`role` (the payload is the list as the person who changed it sees it). `LIST_DELETED` removes the list. `LIST_CREATED`, `LIST_SHARED`, `LIST_UNSHARED`, a `LIST_UPDATED` of a list not shown and the deletion of the last list reload the lists.
- **Tasks** ([useTaskRealtime.ts](../../frontend/src/features/triage/useTaskRealtime.ts), [taskMoves.ts](../../frontend/src/features/triage/taskMoves.ts)): `TASK_CREATED`/`UPDATED`/`DELETED` and `TASK_REORDERED` are applied; `TASK_LIST_*` reload the task lists, a `TASK_REORDERED` with `reload` and a reconnect reload the tasks. A move sends only the tasks whose place or column changed, and its answer is applied unless a newer move was made meanwhile. The echo of an own move (`userId` and places of a move this tab sent in the last 10 s) is dropped; another person's move that arrives while own moves are on their way is not applied but loads the tasks once they are answered. Undoing a move works the same way.
- **Server side:** the server keeps each user's counters for 3 s (`GET /stats`, `GET /auth/me`, [stats_cache.go](../../internal/api/stats_cache.go)). Every request of the user other than GET/HEAD/OPTIONS and every event that can change counters delivered to the user (same events as above, `Hub.SetDeliveryListener`) drops them, so the own change and changes announced by an event show at once.
- Note contents are never pushed; they are always fetched via `POST /docs/{id}/sync`; `DOC_SEQ` serves purely as a wake-up signal. Conflicts are resolved authoritatively by the server (versions and leases, see [modules/collaboration.md](../modules/collaboration.md)).
