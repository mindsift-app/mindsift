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

**Losing access leaves the room:** a room is checked when it is joined, so every change that can take a list or note away rechecks the rooms concerned right after it and takes out the connections (WebSocket, SSE, long poll) whose person may no longer read them ([realtime_access.go](../../internal/api/realtime_access.go), `Hub.RecheckRooms`, `RecheckRoomsWhere`, `RecheckAllRooms`). Otherwise an open connection would keep receiving the list's entries (`ITEM_*`) or the live drawing (`DRAW_*`). The changes: a list deleted or a share of it removed (`broadcastListAudience` does it), a note deleted (REST, MCP `delete_note`) or a share of it removed, a folder deleted, a note or folder moved (out of a shared folder), a shared folder deleted or unshared, someone out of a group or a group deleted (every member's rooms, since the shares the person made with the group go as well), and, for every connection, an organization or account removed or a stricter sharing mode (these also send `ACCESS_CHANGED`, so the overviews follow). A connection taken out of a live drawing's room also leaves its session and gets `DRAW_ERROR` `forbidden`. A new way to take access away calls one of these helpers.

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
| Room, per connection (`BroadcastRoomEach`) | Connections in the room, each with its own message (the bundled pointers of a live drawing leave out the receiver's own) |
| Multiple users (`BroadcastToUsers`) | All connections of a computed user group, e.g. owners and members of a task list |
| Multiple users, about a list (`BroadcastListToUsers`) | As `BroadcastToUsers`, the message carrying the list's `list_id` like a room event (list deleted, shared, unshared) |

Each WebSocket connection has a queue of up to 128 events; when it is full, further events for that connection are dropped (live drawing notices that by `seq`). The writer takes what is waiting in the queue in one go (up to 256 events): every event is still a WebSocket message of its own, but they go to the network in one write (one system call and usually one TCP packet instead of one each), which saves the server, the proxy in front and the network most of their per-message work when many small events go out at once.

## Events

Every event has one name, a constant in [events.go](../../internal/api/events.go) (the hub's own in [ws/events.go](../../internal/ws/events.go)); handlers never spell it out. [frontend/src/lib/realtimeEvents.json](../../frontend/src/lib/realtimeEvents.json) lists the same names for the app: `server` the events the server sends, `client` the messages it takes. A Go test checks the constants against that list, a Vitest test checks that the app listens for and sends no other names. A new event therefore needs its constant, its line in the list and its row here. The payloads below stay as they are: older apps and the desktop app in server mode read them, so a payload only grows (new fields), it is not reshaped.

Each operation sends its events from one place that REST and MCP share (e.g. `createTaskList`, `createList`, `addListItem`, `updateListItem`, `setListItemDone`, `afterDocCreated`, `afterTriage`), so both ways reach the same people.

| Event | Trigger | Channel |
|---|---|---|
| `TASK_CREATED` | `POST /inbox`, webhook, MCP `create_task`, a task made from a note's bullet | Owner and list members |
| `TASK_UPDATED` | `PATCH /thoughts/{id}`, triage | Owner and members of old and new list |
| `TASK_DELETED` | `DELETE /thoughts/{id}` | Owner and list members |
| `TASK_REORDERED` | Reordering tasks (payload: `taskListId`, `items[{id, sortOrder, kanbanStatus, isCompleted}]` as stored, `skipped`, `reload`, `userId`; only sent when something changed) | Members of all affected lists |
| `TASK_LIST_CREATED` / `TASK_LIST_UPDATED` / `TASK_LIST_DELETED` | Create (`POST /task-lists`, MCP `create_task_list`; a team's list reaches the team), update, (un)share, group members changed (below), mute (the person's own sessions only) or delete list; payload only `{id}`, clients reload their lists | Members before and after modification |
| `DOC_CREATED`, `DOC_UPDATED`, `DOC_DELETED` | Create/update/delete note, note shares, note restored from the trash (`DOC_CREATED`). A new note (`POST /documents`, also from a template, MCP `create_note`, a bullet extracted into a note of its own) also records the @-mentions in its bullets and tells the people mentioned who can see it, as an edit does; extracted bullets were told in their first note and are only recorded. Payload of the first two: the note as each person's note list has it (`GET /documents`: no bullets, with `openTodos`, `tagCounts`, `tagOpenTodos`); `DOC_DELETED` only `{id}` (deleting a folder sends `WORKSPACE_FOLDERS_UPDATED` `deleted` instead). Pinning a note or marking it as a template (`PUT /documents/{id}` with only `isPinned`/`isTemplate`) sends `DOC_UPDATED` to the person's own sessions only, both are personal | Authorized users |
| `DOC_COUNTS` | Bullets of a note changed (sync, a linked task ticked): `{id, openTodos, tagCounts, tagOpenTodos}`, the counts the note list shows, the same for everyone. Checked at most every 3 s per note (two grouped queries, [doc_counts.go](../../internal/api/doc_counts.go)) and sent only when they differ from the counts sent last (the first check after a server start always sends) | Authorized users |
| `DOC_SEQ` | Note change, a lease changing hands (renewals do not count), or a new session (`docId`, `headSeq`); clients fetch data via `/docs/{id}/sync` | Room `doc:<id>` |
| `TRANSCRIPTION_UPDATED` | A background transcription was queued, started, failed or is waiting for its retry (the job as `GET /voice/jobs`) | Its owner; for a recording in a note everyone with access to the note |
| `TRANSCRIPTION_DONE` | A background transcription ended (`id`, `kind`, `userId`, `text`; `docId`, `blockId` for a note, `thoughtId` of the inbox entry it became). Empty `text`: nothing heard, the recording is gone or the job was discarded | As `TRANSCRIPTION_UPDATED` |
| `WORKSPACE_FOLDERS_UPDATED` | Folders/mounts modified; `type` says what changed (below) | User; for shared folders, owner and all collaborators |
| `LIST_CREATED` | `POST /lists`, MCP `create_list`; payload the new list (shared with nobody yet) | The creator (their other devices) |
| `LIST_UPDATED` | List renamed or new icon, inbox entry made into an entry; payload the list without what differs per person (`isOwner`, `role` left out): title, icon, type, entries, shares, members | Everyone who sees the list, on all their connections (`broadcastListAudience`): the list overview shows title and icon of every list, not only of the open one |
| `LIST_DELETED`, `LIST_SHARED`, `LIST_UNSHARED` | List deleted (`{listId}`), shared (the share), a share removed (`{listId, shareId}`), group members changed (below); the message carries `list_id` like the room's events | Everyone who saw the list before or sees it now, on all their connections, not only the list's room (`broadcastListAudience`): the list overview of someone without the list open drops or loads it as well |
| `LIST_CLEARED` | Checked entries removed (`{listId, removed}`) | List room |
| `LIST_COUNTS` | The open entries of a list may have changed (entry added, ticked, deleted, moved, checked ones cleared): `{listId, open}`, the number the list overview shows. Checked at most every 3 s per list (one `COUNT`, [list_counts.go](../../internal/api/list_counts.go)) and sent only when it differs from the count sent last, so a burst of ticks makes one small event; the message carries `list_id` | Everyone who sees the list, on all their connections |
| `ACCESS_CHANGED` | The administration removed shares or group memberships in bulk (`storage.PruneSharing`), which are not sent one by one: someone taken out of an organization (only when something went, `RemoveOrganizationMemberImpact`), an organization deleted, an account deleted (by the administration, the command line or its owner), a stricter sharing mode (only when something went). Payload `{}`; the app loads its lists, task lists, notes, folders, groups and counters again (every view with `useRealtimeReload`, the notes and folders included), in the shared rhythm | The members of the organization (and the person taken out); for an account deleted or the sharing mode every connection (`BroadcastSystem`): who saw what of the account, or what the mode removed, is not known without working out everyone's access, and these changes are rare ([realtime_access.go](../../internal/api/realtime_access.go), `tellAccessChanged`) |
| `TEAM_UPDATED` | A group created, renamed, someone added, removed or leaving, a role changed, the group deleted (`{id}`); the groups page reloads the groups | The members before and after the change (the person removed and every member of a deleted group included) |
| `NOTIFICATION` | A new entry in the notification center; payload the entry (`GET /notifications`) plus `replaces`: the ids of the entries it replaced (same group key, e.g. one entry per watched task), left out when none | The recipient |
| `NOTIFICATIONS_READ`, `NOTIFICATIONS_CLEARED` | Entries marked read (`{ids}`, empty: all) or the notification center emptied (`{}`) | The person's own sessions |
| `DRAW_*` | Live drawing (below) | Drawing room or the connection |
| `PONG` | Answer to `PING` | Connection |
| `ITEM_CREATED`, `ITEM_UPDATED`, `ITEM_TOGGLED`, `ITEM_DELETED`, `ITEM_REORDERED` | List items | List room: only the connections that have the list open apply entries; sending every entry to everyone with the list would multiply the traffic of a busy list (the open counts of the other lists in the overview follow `LIST_COUNTS`) |
| `USER_PRESENCE` | Connection connected/disconnected (`onlineCount`) | Room |
| `DEMO_RESET` | Periodic reset in demo mode; clients invalidate local caches and reload data | All active connections |
| `SSE_CONNECTED` | SSE only, sent immediately after connecting | Connection |

**Group changes** (`afterTeamChange` in [handlers_teams.go](../../internal/api/handlers_teams.go)): adding someone to a group, removing someone (or leaving) and deleting a group send what sharing or unsharing each thing shared with the group would, to everyone who saw it before or sees it now: `TASK_LIST_UPDATED` per task list, `LIST_SHARED` (the group's share) or `LIST_UNSHARED` (`{listId, shareId}`) per list, `DOC_CREATED` to whoever gains a note and `DOC_DELETED` to whoever loses it, `WORKSPACE_FOLDERS_UPDATED` `shared` per shared folder. What was shared with the group before or after counts: removing someone also removes the shares they had made with the group. Removing and deleting take everyone who was a member out of the rooms they lost. The person added gets a `NOTIFICATION` (kind `shared`, `targetType` `team`, so the same settings and channels as a share); removing tells nobody. Adding someone who is a member already only changes the role and sends nothing of this. Every change of a group (members, roles, name, deleted) also sends `TEAM_UPDATED` to its members before and after, so the groups page of the others follows.

### `WORKSPACE_FOLDERS_UPDATED` types

| `type` | Payload besides `type` | Sent after | The app fetches |
|---|---|---|---|
| `created` | `path` | `POST /folders` | the folders |
| `moved` | `sourcePath`, `newPath` | `POST /folders/move`, `POST /folders/rename`; a `DOC_UPDATED` per moved note before it | the folders |
| `deleted` | `path`, `deletedDocIds` (notes now in the trash) | `DELETE /folders` | the folders and the trash; the note list only if other notes it holds were in the folder (shared notes placed there go back to the top level) |
| `deleted` (no `path`) | `deletedDocIds` (the notes of the folder this person had access to) | `DELETE /folders` by someone else; one event per person instead of a `DOC_DELETED` per note | the folders and the trash, once |
| `restored` | `restored` (note id, or `folder`) | restoring a note or folder from the trash; a `DOC_CREATED` per note before it | the folders and the trash (the restoring app fetches the folders itself as well, so empty subfolders show without a realtime connection) |
| `noteMoved` | `docId` | `POST /documents/{id}/move`, `PATCH /documents/{id}` with `folderPath`, MCP `update_note` with `folderPath`; `DOC_UPDATED` before it | the folders and the trash; the note list only if the note is new there |
| `mount` | `folderId`/`mountPath` or `sourcePath`/`newPath` | a shared folder placed elsewhere | everything (folders, shared folders, note list, trash) |
| `shared` | `folderId` | shared folder created, deleted, shared or unshared | everything |

An event without `type` (or of a type the app does not know) makes it fetch everything.

## Live Drawing

Several people draw in one drawing bullet at once (concept: [architecture.md](../architecture.md#collaboration-live-drawing)). Messages from the browser go over the WebSocket only, as `{"event": "DRAW_…", "payload": {"docId", "blockId", …}}`, at most 1 MB each. Watching works on every transport: SSE and long-poll connections register with `POST /docs/{id}/drawings/{blockId}/watch` (`{sseId}`) and then receive the room's events.

| Client → Server | Payload (besides `docId`, `blockId`) | Effect |
|---|---|---|
| `DRAW_JOIN` | `base` (block content when opened), `els` (own whole state: elements with `ver`, `nonce`, tombstones), `grid`, `join` (optional), `resume` (optional) | Draw along (write access). Starts a session without one (host; the browser sends this only after "Gemeinsam zeichnen", or again after a lost connection), with `join: true` ("Mitzeichnen" in a session someone else runs) only joins a running one and answers `ended` otherwise; with `resume: true` ("Rückgängig" after discarding) only brings back a session discarded within 15 s for the same `base`, else `ended`, and a join without it never resumes a discarded session; resumes one everyone left within 10 min if `base` matches, or joins a running one; merges `els` by version. Answer `DRAW_STATE`; joining again after a lost connection or a server restart works the same way. A connection draws in one drawing at a time: joining another leaves the previous one. Limits per person and server: [architecture.md](../architecture.md#collaboration-live-drawing) |
| `DRAW_WATCH` | – | Watch (read access); answer `DRAW_STATE` (`active: false` without a session) |
| `DRAW_OPS` | `els` (changed elements and tombstones), `order` (new order of the ids, optional), `grid` (optional) | Merged by version; the winners go to the room as `DRAW_OPS`, the sender gets `DRAW_ACK`. Write access is checked again, at most once a second per connection (`drawEditRecheck`): someone whose share became read-only gets `DRAW_ERROR` `forbidden` and leaves the session (the 5 s tick does the same for everyone drawing) |
| `DRAW_PRESENCE` | `x`, `y` (drawing coordinates), `gone`, `touch`, `sel` (selected ids) | Pointer and selection, at most 30 a second, the rest dropped (the app sends at most 20). The server keeps the latest of each person and sends them bundled (`DRAW_POINTERS`) |
| `DRAW_SYNC` | – | The whole state again as `DRAW_STATE` (after a gap in `seq`) |
| `DRAW_LEAVE` | – | Leave (drawing or watching); the host's leaving hands over to the person drawing longest |
| `DRAW_DONE` | `clientId` (the note's sync client) | Host only: ends the session; the host gets `DRAW_END` with the final state and saves it via `/docs/{id}/sync`, the bullet's lease goes to `clientId` |
| `DRAW_DISCARD` | – | Host only: ends the session without saving; everyone is out (`DRAW_END` `discard`), the state stays 15 s for `DRAW_JOIN` with `resume`. The app sends it only when nobody else draws along; otherwise closing without saving is `DRAW_LEAVE` |

| Event | Payload (besides `docId`, `blockId`) | Recipients |
|---|---|---|
| `DRAW_STATE` | `active`, `host`, `participants`, `watchers` (each `{id, userId, name}`, `id` = connection), `els`, `order`, `grid`, `seq`, `you` | The joining or watching connection |
| `DRAW_OPS` | `from`, `els`, `order`, `grid`, `seq` | Room, without the sender |
| `DRAW_ACK` | `seq` | Sender of `DRAW_OPS` |
| `DRAW_PEOPLE` | `active`, `host`, `participants`, `watchers` | Room (joined, left, new host) |
| `DRAW_POINTERS` | `pointers`: `[{from, x, y, sel?, touch?, gone?}]`, `from` = connection (name and colour come from `participants`), `sel`, `touch` and `gone` left out when empty or false | Room; every connection without its own pointer, none when only its own changed |
| `DRAW_END` | `reason` (`done`, `discard`, `expired`), `by`; for the host also the final `els`, `order`, `grid` | Room |
| `DRAW_ERROR` | `code`: `forbidden`, `locked` (someone else edits alone), `ended` (`join` without a running session), `no_session`, `not_host`, `limit` (session too large), `too_many` (the person keeps too many sessions going), `busy` (the server holds as many sessions or bytes as it takes), `rate` (changes, or joining and watching, too fast), `invalid` | The sender |

**Pointers are bundled** (`drawPresence`, `sendDrawPointers` in [drawlive.go](../../internal/api/drawlive.go)): per drawing, the server collects the latest pointer of each person drawing and sends one `DRAW_POINTERS` per receiver every 50 ms with the pointers that changed since the last one; a newer pointer of the same person replaces one still waiting. The first pointer after a quiet tick goes out at once; a tick without pointers stops the timer, so a drawing nobody moves in has none, and the end of the session stops it too. A person thus receives at most 20 pointer messages a second, however many draw (before, every pointer went to every other connection on its own: N people at 20 a second made N×(N−1)×20 messages a second). Changes (`DRAW_OPS`) keep their own, immediate way and order; a bundle may come before or after a change sent at the same time. Servers before this version sent every pointer as `DRAW_PRESENCE` with `from`, `userId`, `name`, `x`, `y`, `gone`, `touch`, `sel`; the app still accepts that.

`seq` counts the merged changes of a session; a browser that sees a gap (a message was dropped because its connection was too slow) fetches the state again (`DRAW_SYNC`, or `GET …/live` without WebSocket).

## Frontend Behavior

- The global connection (a singleton) hands every message and every change of its status to [realtimeBus.ts](../../frontend/src/lib/realtimeBus.ts), the one way they reach the app: views subscribe with `useRealtimeEvents` ([useRealtimeEvents.ts](../../frontend/src/lib/useRealtimeEvents.ts)), other modules with `onRealtimeMessage`, `onRealtimeStatus` and `onRealtimeReconnect`. Tests feed events in through [test/realtime.ts](../../frontend/src/test/realtime.ts).
- After a disconnect, the client reconnects with a backoff delay. Once it is back, counters (`GET /stats`) and the triage deck load once, since the events of the gap are lost.
- **Counters and triage deck** ([useSessionBootstrap.ts](../../frontend/src/app/useSessionBootstrap.ts), [realtimeCounters.ts](../../frontend/src/app/realtimeCounters.ts)): in a shared list every change reaches every member, so the app reacts only as far as an event can change something. `TASK_*`, `DOC_*`, `ITEM_*` and `LIST_*` reload the counters, except `DOC_SEQ` and `ITEM_REORDERED`. An event within 3 s of a change this tab sent counts as its echo and reloads them after 300 ms; everyone else's changes reload them in a shared rhythm: 1.5 s after the first event, then at most once every 5 s while events keep coming, and once after the last one. The deck reloads only for `TASK_CREATED`/`TASK_UPDATED` of a thought with status `inbox` and for `TASK_CREATED`/`TASK_UPDATED`/`TASK_DELETED` of a thought that is in the deck, not for task changes in task lists. A hidden tab ignores these events and loads everything when it becomes visible.
- **Reloads because of events** ([realtimeReload.ts](../../frontend/src/lib/realtimeReload.ts)): views apply what an event carries; only what it cannot carry is loaded, in the same rhythm as the counters (300 ms after an own change, otherwise 1.5 s after the first event and at most once every 5 s, one request per burst). A hidden tab puts the reload off until it is visible again, and a reconnect reloads once. Every view with data from events (notes and folders, tasks, lists, notification center, counters and deck, transcriptions) loads once after a reconnect, since the events of the gap are lost.
- **Notification center** ([notificationCenter.ts](../../frontend/src/components/notificationCenter.ts)): both bells (phone header and desktop rail) share one list, loaded when the first one mounts, when a bell opens and after a reconnect. `NOTIFICATION` puts the entry on top and drops the entries named in `replaces`, `NOTIFICATIONS_READ` marks the named ids read (all without ids), `NOTIFICATIONS_CLEARED` empties it, all without a request. Only a replaced entry the bell does not hold while it holds the newest 50 loads the list (it may have been unread).
- **Shopping lists** ([useListRealtime.ts](../../frontend/src/features/lists/useListRealtime.ts)): the open list's room is joined on the app's connection; `ITEM_*`, `LIST_CLEARED` and `ITEM_REORDERED` (places, category and text of the entries) are applied. `LIST_UPDATED` takes title, icon, type, entries, shares and members from the payload and keeps this person's `isOwner`/`role` (the payload has none). `LIST_DELETED` removes the list. `LIST_COUNTS` of a list not open shows its count in the overview and marks the list's entries out of date: opening it loads the lists (the open list ignores it, its entries are current). `LIST_SHARED`, `LIST_UNSHARED`, a `LIST_CREATED` of a list not shown (another device of the creator), a `LIST_UPDATED` of a list not shown and the deletion of the last list reload the lists.
- **Tasks** ([useTaskRealtime.ts](../../frontend/src/features/triage/useTaskRealtime.ts), [taskMoves.ts](../../frontend/src/features/triage/taskMoves.ts)): `TASK_CREATED`/`UPDATED`/`DELETED` and `TASK_REORDERED` are applied; `TASK_LIST_*` reload the task lists, a `TASK_REORDERED` with `reload` and a reconnect reload the tasks. A move sends only the tasks whose place or column changed, and its answer is applied unless a newer move was made meanwhile. The echo of an own move (`userId` and places of a move this tab sent in the last 10 s) is dropped; another person's move that arrives while own moves are on their way is not applied but loads the tasks once they are answered. Undoing a move works the same way.
- **Server side:** the server keeps each user's counters for 3 s (`GET /stats`, `GET /auth/me`, [stats_cache.go](../../internal/api/stats_cache.go)). Every request of the user other than GET/HEAD/OPTIONS and every event that can change counters delivered to the user (same events as above, `Hub.SetDeliveryListener`) drops them, so the own change and changes announced by an event show at once.
- Note contents are never pushed; they are always fetched via `POST /docs/{id}/sync`; `DOC_SEQ` serves purely as a wake-up signal. Conflicts are resolved authoritatively by the server (versions and leases, see [modules/collaboration.md](../modules/collaboration.md)).
