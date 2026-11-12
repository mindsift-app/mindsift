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
| `TASK_REORDERED` | Reordering tasks | Members of all affected lists |
| `TASK_LIST_UPDATED` / `TASK_LIST_DELETED` | Update, (un)share, or delete list; payload only `{id}`, clients reload their lists | Members before and after modification |
| `DOC_CREATED`, `DOC_UPDATED`, `DOC_DELETED` | Create/update/delete note, note shares | Authorized users |
| `DOC_SEQ` | Note change, a lease changing hands (renewals do not count), or a new session (`docId`, `headSeq`); clients fetch data via `/docs/{id}/sync` | Room `doc:<id>` |
| `WORKSPACE_FOLDERS_UPDATED` | Folders/mounts modified | User; for shared folders, owner and all collaborators |
| `LIST_CREATED`, `LIST_UPDATED`, `LIST_DELETED`, `LIST_SHARED`, `LIST_UNSHARED`, `LIST_CLEARED` | List administration | User or list room |
| `ITEM_CREATED`, `ITEM_UPDATED`, `ITEM_TOGGLED`, `ITEM_DELETED`, `ITEM_REORDERED` | List items | List room |
| `USER_PRESENCE` | Connection connected/disconnected (`onlineCount`) | Room |
| `DEMO_RESET` | Periodic reset in demo mode; clients invalidate local caches and reload data | All active connections |
| `SSE_CONNECTED` | SSE only, sent immediately after connecting | Connection |

## Live Drawing

Several people draw in one drawing bullet at once (concept: [architecture.md](../architecture.md#collaboration-live-drawing)). Messages from the browser go over the WebSocket only, as `{"event": "DRAW_…", "payload": {"docId", "blockId", …}}`, at most 1 MB each. Watching works on every transport: SSE and long-poll connections register with `POST /docs/{id}/drawings/{blockId}/watch` (`{sseId}`) and then receive the room's events.

| Client → Server | Payload (besides `docId`, `blockId`) | Effect |
|---|---|---|
| `DRAW_JOIN` | `base` (block content when opened), `els` (own whole state: elements with `ver`, `nonce`, tombstones), `grid` | Draw along (write access). Starts a session without one (host), resumes one everyone left within 10 min if `base` matches, or joins a running one; merges `els` by version. Answer `DRAW_STATE`; joining again after a lost connection or a server restart works the same way |
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
| `DRAW_ERROR` | `code`: `forbidden`, `locked` (someone edits alone), `no_session`, `not_host`, `limit`, `rate`, `invalid` | The sender |

`seq` counts the merged changes of a session; a browser that sees a gap (a message was dropped because its connection was too slow) fetches the state again (`DRAW_SYNC`, or `GET …/live` without WebSocket).

## Frontend Behavior

- The global connection (a singleton) forwards every message as a browser event `mindsift:ws`; views (`TasksView`, `WorkspaceView`, `SharedListsView`) listen for it and reload or patch their state.
- After a disconnect, the client reconnects with a backoff delay.
- Note contents are never pushed; they are always fetched via `POST /docs/{id}/sync`; `DOC_SEQ` serves purely as a wake-up signal. Conflicts are resolved authoritatively by the server (versions and leases, see [modules/collaboration.md](../modules/collaboration.md)).
