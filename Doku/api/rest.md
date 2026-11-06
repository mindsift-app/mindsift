# REST API

Base: `/api/v1`. Responses are JSON; errors take the form `{"error": "Text"}`, some with a stable `code` for clients to react to (`email_unverified` on login). Error texts follow `Accept-Language` when MindSift speaks it, else the server's default language; the language used is returned as `Content-Language`. MCP always answers in English. Authentication via `Authorization: Bearer <JWT>`. **API keys** (`Bearer mindsift_sec_…` or header `X-API-Key`) have scopes that apply equally to REST and [MCP](#mcp-for-ai-agents-post-apiv1mcp), see [API Keys](#api-keys-scopes-and-origin). Everything else, including notes, settings, and live streams, responds to an API key with `403`. Timestamps are ISO-8601 (UTC). Request bodies are limited to 2 MB (note sync 8 MB, imports 101 MB). In demo mode, endpoints that send messages/emails, modify server settings, or alter shared demo accounts respond with `403` "Disabled in demo". The source of truth is the route definitions in [server.go](../../internal/api/server.go).

## Public

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/auth/status` | `needsSetup`, `allowRegistration`, `instanceName`, `demoMode`, `sharingMode`, `legal` (`imprintUrl`, `hasImprintContent`, `privacyUrl`, `hasPrivacyContent`, `customLinkLabel`, `customLinkUrl`), `voice` (`mode` = `server`/`browser`/`off`, `maxSeconds`, `browserAllowed`), `mcpEnabled`, `mcpConnectorUrl`, `defaultLanguage` (the server's default language: admin setting, else `DEFAULT_LANGUAGE`, else `de`) |
| GET | `/legal/{imprint\|privacy}` | Stored Markdown text (`content`), without login; `404` if none set |
| POST | `/share-target` | PWA Web Share Target fallback: redirects to `/` (`303 See Other`) if service worker is still inactive |
| POST | `/auth/setup` | First administrator account (`email`, `password`, `displayName`, `instanceName`, `allowRegistration`, `sharingMode`, `createSampleData`, `defaultLanguage`: becomes the server's default language and the admin's own, `400` for unknown codes); only while no accounts exist. Sample data comes in German for German accounts, otherwise in English |
| POST | `/auth/verify-email` | Link from verification email (`token`): activates account or forwards it to pending approval (`{"verified","pending","message"}`) |
| POST | `/auth/resend-verification` | Resend verification link (`email`); always responds identically, at most once every 2 minutes per account |
| POST | `/auth/register` | Registration (`email`, `password`, `displayName`, `inviteCode`); always allowed with code, otherwise depending on registration mode. `201` with token or `202 {"pending":true,"verify","message"}` if email verification (`verify`) and/or admin approval is required (login returns `403` until then); `429` after 20 attempts per address in 15 minutes or when more than 50 accounts are pending approval |
| POST | `/auth/login` | Login (`login`/`email`/`username`, `password`) → `{token, user}`. `login` is the email address or the username; typed like a display name ("Sandro Dach") it is read as the username (`sandro.dach`), and the part of the email before the @ still works. The display name itself does not sign in |
| POST | `/auth/forgot-password` | `{email}` → always `{ok: true}`; email with link sent only if the account exists. `503` if SMTP or `BASE_URL` is missing; `429` after 10 requests per address in 15 minutes |
| POST | `/auth/reset-password` | `{token, password}` (min. 8 characters) → new password, terminates all sessions; `400` on invalid or expired link |
| POST | `/auth/quickstart` | Always `403` (guest access disabled) |
| POST | `/webhooks/ingest` | Ingest via webhook, key as `X-API-Key` (recommended), Bearer or `?token=` (URL parameter accepts only API keys, no session tokens). Body: `title`/`content`/`text`/`message`, `priority`, `source`, `tags`, `dueDate`; `target` (or `type`): `triage` (default, inbox), `task` (optional `taskListId`), `list_item` (`listId`, `category`, `quantity`). Plain text body is treated as content. `403` without matching scope or without write permission on the list |
| GET | `/ws`, `/ws/spaces/{id}`, `/ws/lists/{id}` | WebSocket, see [websocket.md](websocket.md); `?ticket=` or `Authorization` header |
| GET | `/events` | SSE fallback; `?ticket=` or `Authorization` header |

## Account and General (Authenticated)

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/me` | User profile and metrics |
| POST | `/events/rooms` | Join/leave SSE room (`sseId`, `room`, `action`); own `sseId` only, rooms with read access only |
| POST | `/events/poll` | Open long-polling connection (`rooms` optional) → `{pollId}`; requires session |
| GET | `/events/poll/{pollId}?wait=25` | Retrieve buffered events, waits up to `wait` s → `{events}`; `404` = expired |
| POST | `/auth/stream-ticket` | One-time ticket (60 s) for WebSocket/SSE |
| POST | `/voice/transcribe` | Only in server mode for voice recognition: `multipart/form-data` with `file` (recording, e.g. WebM/Opus or MP4/AAC) → `{text}`. `404` without `STT_URL`, `413` too large, `429` hourly rate limit, `503` busy, `502` Whisper error (details in log) |
| POST | `/auth/logout` | Terminate session of this device |
| GET | `/auth/sessions` | Logged-in devices: `[{id, createdAt, lastUsedAt, userAgent, ip, current}]` |
| DELETE | `/auth/sessions/{id}` | Log out a device; `404` on unknown session or one belonging to another user |
| POST | `/auth/revoke-all` | Terminate all sessions (`token_version` +1) |
| PATCH | `/auth/settings` | `displayName`, `username` (2–32 characters, lower case letters, digits, `.`, `-`, `_`; `400` with code `username_invalid`, `409` with `username_taken`; `403` in demo mode), `email`, `password`, `avatarUrl`, `alarmChannels`, `alarmEmail`, `discordWebhookUrl`, `customWebhookUrl`, `notifyBeforeMinutes`, `retention` (`doneTasks`, `taskTrash`, `triageTrash`, `noteTrash`, `listDone`: days selected from 7, 14, 30, 90, 365, 730, or 0 = never; always all five, `400` on other values or for 0 if the server has disabled "never"), `voiceInput` (`""` = Whisper server, `browser`), `voiceLanguage` (language spoken into the microphone: `""` = the app language, `auto` = Whisper detects it, or one of Whisper's language codes such as `ru`; `400` for unknown codes), `language` (`de`, `en`, `es`, `fr`, `it` or `""` = follow the browser, then the server's default; `400` for other codes; `GET /auth/me` returns it as `language`), `doneRetentionDays` (legacy single field for `retention.doneTasks`). `GET /auth/me` includes `retention` and `retentionNeverAllowed`. `notificationSettings` (`paused`, `includeOwnWatched`, `events.{due,shared,taskDone,watched}.{email,discord}`, `dailySummary.{enabled,time,email,discord}`) for notifications. New `email` or `password` requires `currentPassword` (`403` if incorrect, `429` if login locked); after password change, other devices are logged out and the new token is returned in the `X-Session-Token` header |
| POST | `/auth/alarms/test` | Test alarm (`channel`: `email`/`discord`/`webhook`, optional `target`) |
| GET | `/users/directory`, `/collaborators` | Users you can see and share with (depending on `sharingMode`, [sharing-and-permissions.md](../sharing-and-permissions.md)). Only public profile per person: `id`, `email`, `username`, `displayName`, `avatarUrl`, `organizationId` – no private details (webhooks, alarm email, role) |
| GET | `/stats` | Counters for the dashboard (including `inboxCount`, `tasksOpenCount`, `listItemsOpenCount` = open items across all visible lists) |
| GET | `/search?q=` | Global FTS5 search across accessible notes (title & blocks), tasks, and lists → `{thoughts, documents, listItems, hits, counts}`. Open tasks and list items appear before completed ones. Optional: `type` (`document`/`thought`/`list_item`), `limit` (matches per type, default 40, max 200), for tasks `taskStatus` (`open`/`done`), `taskListId` (`personal` = without list), `priority`, `due` (`today`/`overdue`/`week`), for notes `folder` (including subfolders), for lists `listId`, `itemStatus` (`open`/`done`). Matches in bullets include `content` (raw text of the bullet), with `context=1` also `before`/`after` (text of adjacent bullets); `documents` holds only `id`, `title` and `icon` of the matched notes; `counts` = matches per type in this response |
| GET | `/export` | Data export as JSON; with `?format=zip`, the same data as `mindsift-backup.json` inside a ZIP (used by UI for backup downloads) |
| GET | `/export/markdown` | Obsidian-compatible ZIP (`mindsift-vault-DATE.zip`), streamed directly: notes as `.md` with YAML frontmatter in user's folder hierarchy (including shared ones), `Aufgaben/<List>.md` in Tasks plugin format (`📅`, `⏫`/`🔺`), `Listen/<List>.md` (folder names in the user's language, e.g. `Tasks/`, `Lists/`; the import reads them in every language) |
| GET/POST | `/themes` | Custom CSS themes; create or update with `id` (`name`, `css`, max 200 KB) |
| DELETE | `/themes/{id}` | Delete custom theme |
| POST | `/import/mindsift`, `/import/obsidian` | Import (multipart field `file`, max 100 MB): MindSift JSON/archive or Obsidian vault ZIP; `?preview=1` returns only the summary (`folders`, `notes`, `taskLists`, `tasks`, `lists`, `listItems`, `inbox`, `skipped`) |
| — | `/import/mindsift?mode=restore` | Restore: deletes all own notes, folders, tasks, thoughts, and lists prior to import (only after the file has been completely read and validated) |
| DELETE | `/user/data` | Delete all personal user data, account remains (`{"password"}` required; 403 in demo mode) |
| DELETE | `/user/account` | Delete user account along with all data (`{"password"}` required); `403` for the last server admin. `/auth/me` provides `isLastAdmin` for this purpose |
| GET | `/backups`, `/backups/{name}` | List or download own automatic server backups |
| POST | `/backups/{name}/restore` | Restore server backup: `mode=merge` or `restore` (clears selected sections beforehand), `sections=notes,tasks,lists,inbox,themes`, `preview=1` |
| GET/POST | `/keys` | List or create API keys (plain text revealed only upon creation); `POST` with `name` and `scopes` (`webhook:triage`, `webhook:task`, `webhook:list`, `tasks:read`, `tasks:write`, `lists:read`, `lists:write`, `notes:read`, `notes:create`, `notes:write`, `inbox:read`, `inbox:write`; default `["webhook:triage"]`) |
| POST | `/mcp` | MCP endpoint for AI agents, see below |
| PATCH | `/keys/{id}` | Update name (`name`) and/or permissions (`scopes`); the key itself remains unchanged |
| DELETE | `/keys/{id}` | Delete API key |

### Global Search (`GET /api/v1/search?q=`)

Performs a full-text search via SQLite FTS5 with BM25 relevance ranking.
- Searches tasks/thoughts (content, notes, subtasks), notes (titles and contents of active blocks), and list items.
- Strictly enforces all access rules: only own thoughts/tasks and those in accessible task lists; only own and shared notes (directly, via groups, or shared folders); only own and shared lists.
- Title matches are weighted higher than body matches.
- Returns backward-compatible collections (`thoughts`, `documents`, `listItems`) as well as structured `hits` with snippets and `<mark>` highlighting:
  ```json
  {
    "thoughts": [...],
    "documents": [...],
    "listItems": [...],
    "hits": [
      {
        "type": "document",
        "id": "blk_123",
        "title": "Project Planning",
        "snippet": "... important note for <mark>Release</mark> ...",
        "docId": "doc_abc",
        "blockId": "blk_123"
      }
    ]
  }
  ```

### MCP for AI Agents (`POST /api/v1/mcp`)
<a id="mcp-für-ki-agenten-post-apiv1mcp"></a>

MindSift is an [MCP](https://modelcontextprotocol.io) server (Streamable HTTP, stateless, JSON-RPC 2.0 only via `POST`; no server stream, `GET` returns `405`, batches are rejected). Authentication as everywhere via `X-API-Key` or `Authorization: Bearer`; a user session can do everything, an API key is restricted to the tools matching its scopes, and `tools/list` only exposes those tools. Protocol versions `2025-06-18`, `2025-03-26`, `2024-11-05`. Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`; notifications return `202`. Tool errors are returned as `isError` results so the agent can read them; results are returned as `structuredContent` (lists as `{items}`) and as JSON text.

The admin settings (`GET`/`PUT /admin/settings`) carry `defaultLanguage`: a supported code; empty in a `PUT` leaves it unchanged, an unknown code gives `400`. Registration and first-time setup start the new account in the browser's language (`Accept-Language`) when MindSift speaks it, otherwise in the default language.

Administrators can disable MCP (`MCP_ENABLED=false` or toggle in administration settings, field `mcpEnabled` in `/admin/settings`). In that case, the endpoint responds with `404`, OAuth is likewise disabled, and `GET /auth/status` returns `mcpEnabled: false`.

| Tool | Scope | Purpose |
|---|---|---|
| `list_task_lists` | `tasks:read` | Task lists with `permission`, open tasks, and board columns (`columns`: valid values for `kanbanStatus`) |
| `create_task_list` | `tasks:write` | Create own task list with default columns (`title`, `icon`) |
| `list_tasks` | `tasks:read` | Tasks (`taskListId`, `status` open/done/all, `dueBefore` YYYY-MM-DD, `limit`); due tasks first |
| `get_task` | `tasks:read` | A single task |
| `create_task` | `tasks:write` | Create task (`content`, `taskListId`, `priority`, `dueDate`, `notes`); source `agent` |
| `update_task` | `tasks:write` | Update fields (`content`, `isCompleted`, `dueDate`, `priority`, `notes`, `kanbanStatus`, `taskListId`, `tags`) |
| `complete_task` | `tasks:write` | Mark completed (`completed` false = reopen) |
| `add_subtask` | `tasks:write` | Append subtask (`taskId`, `title`) |
| `update_subtask` | `tasks:write` | Check off subtask (`completed`), rename (`title`), or remove (`delete`) |
| `delete_task` | `tasks:write` | Delete task (e.g. created accidentally); moves it to task trash |
| `list_lists` | `lists:read` | Shared lists with open items |
| `create_list` | `lists:write` | Create list (`title`, `icon`, `listType` shopping/checklist/vacation) |
| `get_list` | `lists:read` | List with items |
| `add_list_item` | `lists:write` | Add item (`listId`, `content`, `category`, `quantity`) |
| `check_list_item` | `lists:write` | Check off item (`completed` false = revert) |
| `update_list_item` | `lists:write` | Change text, category, quantity |
| `list_notes` | `notes:read` | Notes without content, most recently modified first (`folder` including subfolders, `query` in title, `limit`) |
| `get_note` | `notes:read` | A single note; `content` consists of bullets formatted as an indented Markdown list (tab per level, `- [ ]` for to-dos, images and audio recordings as placeholders), `bullets` contains the same bullets with `id`, `level`, `type`, `text`, `checked` |
| `create_note` | `notes:create` | New note (`title`, `content` as Markdown like in import, `folderPath`, `icon`); creating in shared folders requires write permission |
| `update_note` | `notes:write` | Change title, icon, or folder of a note |
| `add_note_bullet` | `notes:write` | Add bullet: after a bullet (`afterId`), as the last child (`parentId`), or at the end; `type` text/todo/h1–h3/numbered/callout/warning/error, `checked` |
| `update_note_bullet` | `notes:write` | Update text, checked state, or type of a bullet (`bulletId` from `get_note`) |
| `delete_note_bullet` | `notes:write` | Remove bullet including sub-bullets |
| `delete_note` | `notes:write` | Move own note to trash (recoverable); shared notes and notes in trash cannot be deleted this way |
| `search` | a read scope | Full-text search across tasks, list items, and notes (only within the scope of the key); notes returned as `notes` with `noteId`, `title`, `snippet` |
| `capture_to_inbox` | `webhook:triage` | Capture thought to inbox |
| `list_inbox` | `inbox:read` | Open inbox items, newest first (`query` in text, `limit`) |
| `convert_inbox_item` | `inbox:write` | Convert inbox item as in triage: `to` task (with `taskListId`, `dueDate`), note, or list_item (with `listId`) |
| `discard_inbox_item` | `inbox:write` | Discard inbox item (triage trash, recoverable) |

Tools modify note bullets using the same operations as the editor (note synchronization): Anyone with the note open sees the change immediately; a bullet currently being edited by someone else is not touched (error message returned, try again later). Inbox tools accept only open inbox items; tasks remain out of reach for them. List items cannot be deleted via MCP, only checked off (they have no trash).

Items created or modified by an agent receive a permanent origin (`origin`, see [API Keys](#api-keys-scopes-and-origin)). `create_task` also works with `webhook:task`, and `add_list_item` with `webhook:list`.

Sharing permissions apply just as for the user: read-only lists cannot be modified, and other users' private lists remain invisible. Setup in Claude Code, for example: `claude mcp add --transport http mindsift https://mindsift.example.com/api/v1/mcp --header "X-API-Key: mindsift_sec_…"`; settings display the variants for Codex (`config.toml`) and JSON configurations (Claude Desktop, Cursor). claude.ai and ChatGPT connect via OAuth (next section).

### OAuth for claude.ai and ChatGPT

Clients unable to set an `X-API-Key` header connect via OAuth 2.1 in accordance with the MCP specification (authorization, as of 2025-06-18). In claude.ai, only `<BASE_URL>/api/v1/mcp` needs to be added as a custom connector; the client handles the rest. Prerequisite is `BASE_URL` (issuer and resource); without `BASE_URL`, in demo mode, or when MCP is disabled, all endpoints respond with `404`. `GET /auth/status` provides the address as `mcpConnectorUrl` (empty when OAuth is disabled).

| Method | Path (without `/api/v1`) | Purpose |
|---|---|---|
| GET | `/.well-known/oauth-protected-resource` (also with `/api/v1/mcp` suffix) | Resource metadata (RFC 9728): `resource`, `authorization_servers`, `scopes_supported` |
| GET | `/.well-known/oauth-authorization-server` | Server metadata (RFC 8414) |
| POST | `/oauth/register` | Dynamic client registration (RFC 7591), JSON `client_name`, `redirect_uris` (only `https://` or `http://localhost`/`127.0.0.1`, max 10). All clients are public (`token_endpoint_auth_method: none`); rate limited to 20 registrations per address per 15 minutes |
| GET | `/oauth/authorize` | Consent page in the app (login, select scopes, allow/deny). Required: `response_type=code`, `client_id`, `redirect_uri` (exact match with registration), `code_challenge` with `code_challenge_method=S256`; optional: `state`, `scope` (space-separated scopes), `resource`. The response to the client contains `code`, `state`, and `iss` or `error` |
| POST | `/oauth/token` | Form: `grant_type=authorization_code` (`code`, `client_id`, `redirect_uri`, `code_verifier`) or `refresh_token` (`refresh_token`, `client_id`). Errors returned as `{"error":"invalid_grant",…}` |
| POST | `/oauth/revoke` | Revoke token (RFC 7009); revoking a refresh token terminates all tokens associated with the connection |

The consent page uses `GET`/`POST /api/v1/oauth/authorize` (requires user login, cannot be accessed with API keys).

- **Scopes:** Same as for API keys; offered scopes include `tasks:read`, `tasks:write`, `lists:read`, `lists:write`, `notes:read`, `notes:create`, `notes:write`, `webhook:triage`, `inbox:read`, and `inbox:write`. If the client does not request specific scopes, read and write for tasks and lists are preselected.
- **Connection = Entry under `/keys`** with `kind: "oauth"` and name "<Client> (OAuth)". Modifying scopes, renaming, and deleting work like any other API key; origin (`origin`) carries this name. Re-consenting by the same client reuses the existing entry.
- **Tokens:** Code valid for 10 minutes (single-use), access token (`mindsift_oat_…`) valid for 1 hour, refresh token (`mindsift_ort_…`) valid for 90 days and rotated upon each refresh. If an already superseded refresh token is reused, all tokens for that connection are immediately invalidated. Access tokens are valid only for `POST /mcp`, not for REST or webhooks.
- **Expiration:** A connection that remains unused for `OAUTH_IDLE_DAYS` (default 90, `0` = never) is deleted.
- Without a valid token, `/mcp` responds with `401` and `WWW-Authenticate: Bearer resource_metadata="…"`.

### API Keys: Scopes and Origin
<a id="api-schlüssel-rechte-und-herkunft"></a>

A key is only permitted to access the following endpoints and requires one of the specified scopes:

| Scope | Meaning | REST | MCP Tools |
|---|---|---|---|
| `webhook:triage` | Populate inbox | `POST /inbox`, `POST /webhooks/ingest` (target `triage`) | `capture_to_inbox` |
| `tasks:read` | Read tasks | `GET /task-lists`, `GET /tasks` | `list_task_lists`, `list_tasks`, `get_task`, `search` |
| `webhook:task` | Create tasks | `POST /inbox` or `/webhooks/ingest` with target `task` | `create_task` |
| `tasks:write` | Modify tasks (includes creation) | plus `PATCH`/`DELETE /thoughts/{id}` | plus `update_task`, `complete_task`, `delete_task`, `create_task_list` |
| `lists:read` | Read lists | `GET /lists`, `GET /lists/{id}` | `list_lists`, `get_list`, `search` |
| `webhook:list` | Add list items | `POST /lists/{id}/items`, `/webhooks/ingest` with target `list_item` | `add_list_item` |
| `lists:write` | Modify lists (includes adding items) | plus `PATCH`/`PUT /lists/{id}/items/{itemId}` | plus `check_list_item`, `update_list_item`, `create_list` |
| `notes:read` | Read notes | – | `list_notes`, `get_note`, `search` |
| `notes:create` | Create notes | – | `create_note` |
| `notes:write` | Modify notes | – | `update_note`, `add_note_bullet`, `update_note_bullet`, `delete_note_bullet`, `delete_note` |
| `inbox:read` | Read inbox | – | `list_inbox` |
| `inbox:write` | Triage inbox | – | `convert_inbox_item`, `discard_inbox_item` |

Each area provides Read, Create, and Write tiers; in settings, enabling "Write" automatically includes the corresponding "Read" scope. Notes as well as reading and triaging the inbox are available exclusively via MCP; they remain blocked for API keys via REST. Notes do not carry an `origin`.

The `webhook:…` scope IDs originate from the time when keys could only ingest data, and remain unchanged for existing keys.

`GET /tasks` supports filters for scripts and smart home integrations: `status=open|done|all` (default `all`), `due=today`, `due=overdue` (open only), or `due=YYYY-MM-DD` (due on or before date); days are evaluated in the server's time zone (`TZ`). Without parameters, the response remains unchanged as before.

**Origin:** Anything created or modified by a key includes the `origin` field on the task, thought, or list item: `createdVia`/`createdKey` (creation) and `changedVia`/`changedKey`/`changedAt` (last modified via key), with `api` or `mcp` as the access method and the name of the key; a key deleted since has no name and sets `createdKeyDeleted`/`changedKeyDeleted`. The origin is preserved permanently, even if a user subsequently edits the item manually, and is carried over during triage conversion (including into a list item). An MCP request executed from an authenticated user session counts as `mcp` without a key.

## Thoughts, Triage, Tasks

| Method | Path | Purpose |
|---|---|---|
| POST | `/inbox` | Quick capture. Body: `content`, `priority`, `source`, `dueDate`, `target` (`inbox`/`task`/`list_item`/`document`), `targetListId`, `taskListId` (snake_case variants are accepted) |
| GET | `/thoughts?status=` | Thoughts (`inbox`, `kept`, `converted`, `discarded`, `all`) |
| GET/PATCH/DELETE | `/thoughts/{id}` | Retrieve item; partial update (`content`, `isCompleted`, `dueDate`, `priority`, `taskListId`, `kanbanStatus`, `notes`, `subtasks`, `tags`, `assignees`, `recurrence` = `daily`/`weekly`/`monthly`/`yearly`/empty); delete: a task is moved to the task trash, while a thought from inbox or triage trash is permanently deleted. `assignees` replaces all assignments; only users with access to the list, otherwise `403` |
| DELETE | `/thoughts/discarded/purge` | Empty triage trash (discarded thoughts) |
| GET | `/triage/deck` | Inbox deck (max 100) |
| PATCH | `/triage/{id}` | `action`: `keep`/`discard`/`restore`; with `convertTo`: `task`/`document`/`list_item` |
| GET | `/tasks?taskListId=&status=&due=` | Tasks (optionally filtered by list; filters see [API Keys](#api-keys-scopes-and-origin)) |
| POST | `/tasks/clear-done` | Move completed tasks to task trash (`taskListId`, empty = all editable) → `{deleted}` |
| GET | `/tasks/trash?taskListId=` | Task trash (for a list, otherwise all visible): `id`, `content`, `taskListId`, `isCompleted`, `trashedAt`, `trashedBy` (name, empty = automatic), `canEdit` |
| POST | `/tasks/trash/{id}/restore` | Restore task unchanged (with assignees; if the original list was deleted, it becomes a personal task for its creator) → task |
| DELETE | `/tasks/trash/{id}` | Permanently delete (requires edit permission on the list, otherwise `403`) |
| POST | `/tasks/trash/empty` | Empty trash (`taskListId`, empty = all editable) → `{deleted}` |
| POST | `/tasks/reorder`, `/task-lists/{id}/tasks/reorder` | Update task order/column (`items[{id, sortOrder, kanbanStatus}]`) |
| POST | `/tasks/{id}/unlink` | Unlink from note block |
| POST/DELETE | `/tasks/{id}/watch` | Watch or unwatch a task → `{watching}`; `404` without access. Task responses include `isWatching` |

## Task Lists

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/task-lists` | Lists (`permission` per list: `owner`/`editor`/`viewer`); create (`title`, `icon`, `color`, `teamId`; `icon: ""` = no icon, if omitted: 📋) |
| PUT/DELETE | `/task-lists/{id}` | Update (`title`, `icon`, `color`, `teamId`, `columns`) – not allowed for viewers; delete allowed for owner only |
| GET | `/task-lists/{id}/shares` | Sharing permissions |
| POST | `/task-lists/{id}/shares` | Owner only. Body: `targetType` (`team`/`user`), `targetId`, `permission` (`editor`/`viewer`, default `editor`). Re-submitting for the same target updates the permission tier |
| DELETE | `/task-lists/{id}/shares/{shareId}` | Owner only |

Write attempts by viewers on lists or their tasks return `403` ("No write permission for this task list (read-only)").

## Workspace

| Method | Path | Purpose |
|---|---|---|
| GET/POST/DELETE | `/folders` | Folder list; create (`path`); delete (deleting an own folder moves it along with all subfolders and notes as a single entry to trash) |
| POST | `/folders/trash/{id}/restore` | Restore folder from trash (with all subfolders, even empty ones, and notes) → `restoredDocIds` |
| DELETE | `/folders/trash/{id}` | Permanently delete folder in trash along with notes |
| POST | `/folders/move` | `sourcePath`, `targetParentPath` |
| GET/POST | `/workspace/folders/shared` | Shared folders; create (`name`, `mountPath`) |
| GET/DELETE | `/workspace/folders/shared/{id}` | Retrieve; delete |
| PUT | `/workspace/folders/shared/{id}/mount` | Change own mount path (`mountPath`) |
| GET/POST | `/workspace/folders/shared/{id}/shares` | Shared folder permissions (`permission`: `read`/`write`) |
| DELETE | `/workspace/folders/shared/{id}/shares/{shareId}` | Remove share of a shared folder |
| GET | `/workspace/tags`, `/workspace/tags/{tag}` | Tag overview and details |
| PUT | `/workspace/tags/{tag}/note` | Save tag note page (`content`) |
| GET/POST | `/documents` | List notes; create (`title`, `icon`, `folderPath`, `blocks`, `tags`, `isPinned`; `icon: ""` = no icon, if omitted: 🗒️) |
| GET/PUT/DELETE | `/documents/{id}` | Retrieve; update `title`, `icon`, `folderPath`, `isPinned` (updating blocks here returns `400`, as they are handled via `/docs/{id}/sync`); delete = move to trash (owner) or leave share (others) |
| GET/DELETE | `/documents/trash` | List trash (`id`, `kind` `note`/`folder`, `title`, `icon`, `folderPath`, `deletedAt`, `isOwner`, for folders `noteCount`; notes from a deleted folder are contained within its trash entry) or empty trash (notes and folders) |
| GET | `/documents/{id}/backlinks` | Notes containing a `[[Title]]` link to this note (visible notes only, excluding trash): `docId`, `title`, `icon`, `folderPath`, up to 5 `blocks` (`id`, `content`), `more` |
| POST | `/documents/{id}/restore` | Restore from trash (missing folder is recreated) |
| DELETE | `/documents/{id}/permanent` | Permanently delete note from trash |
| PUT | `/documents/{id}/move` | Move to another folder (`folderPath`) |
| POST | `/documents/{id}/blocks/{blockId}/enhanced-task` | Turn a block into a linked task (`content`, `checked`) |
| GET/POST | `/documents/{id}/shares` | Note shares (`userId`/`email`/`teamId`, `permission`: `read`/`write`) |
| DELETE | `/documents/{id}/shares/{userId}` | Remove note share |
| POST | `/documents/{id}/extract` | `{blockId, clientId}`: creates a new note from the bullet's sub-bullets (title = text without hashtags, same folder, shares inherited, non-owner recipient receives write permission) → `{document, link}`. The server does not modify the source note; the editor itself replaces the sub-tree with `link` (standard local change, Ctrl+Z possible). Requires write permission; `409` if someone else is currently typing in the branch; `400` if the bullet is now only a link to a note (optionally with hashtags) |
| GET | `/push/key` | `{enabled, publicKey}` – public VAPID key for `pushManager.subscribe` (`enabled: false` in demo) |
| GET | `/push/devices` | Own registered push devices → `{devices: [{id, endpoint, device, createdAt}]}` |
| POST | `/push/subscribe` | `{endpoint, keys: {p256dh, auth}, device}` – register device (only `https` endpoints) |
| POST | `/push/unsubscribe` | `{endpoint}` – unregister device |
| POST | `/push/test` | Send test notification to all own devices → `{devices}`; `400` if no devices |
| GET | `/journal` | Days in own journal, newest first → `{days: [{date, docId, empty}]}` (`empty`: note has no text yet; days in trash are excluded) |
| POST | `/journal/{date}` | Open journal note for date (`YYYY-MM-DD`); if none exists yet, it is created (title e.g. "Friday, October 30, 2026", icon 📅) → document, `201` if newly created. Journal notes are standard notes (sharing, search, sync) |
| POST | `/documents/{id}/extract/undo` | Moves extracted note `{id}` back to trash (creator only) |
| POST | `/documents/{id}/move` | `{blockId, targetId, clientId}`: copies the bullet with its sub-bullets to the end of note `targetId` (through the target's sync operations, open editors follow live) and moves links of tasks and subtasks on these checkboxes along → `{targetId, targetTitle, rootId, moved}` (`moved`: new block ID in the target → block ID in the source). The server does not modify the source note; the editor removes the branch itself (or leaves a link `[[Title#^rootId]]` when extracting into an existing note), so Ctrl+Z works. Requires write permission on both notes; `400` same note, `404` bullet not found, `409` someone else is typing in the branch |
| POST | `/documents/{id}/move/undo` | Body: the result of `move` plus `clientId`: removes the branch from the target note again and gives the task links back to the source note's checkboxes (which the editor restores by its own undo) |
| POST | `/documents/{id}/inline` | `{blockId}`: counterpart to `extract` for a bullet consisting solely of `[[Note]]` (optionally with hashtags) → `{sourceId, content, blocks}`: text for the bullet (title plus hashtags) and note bullets with new IDs (`level` 0 = directly beneath the bullet). The linked note is moved to trash; undo with `POST /documents/{sourceId}/restore`. The editor modifies the source note locally. `400` not a link bullet (a link to a single bullet, `[[Note#^id]]`, does not count), `404` note not found, `403` another user's note, `409` still referenced by other notes |
| POST | `/documents/{id}/merge` | `{sourceId}`: appends (own) source note as a heading with sub-bullets to this note, moves source to trash → `{targetId, sourceId, sourceTitle, headingId}` |
| POST | `/documents/{id}/merge/undo` | `{sourceId, headingId}`: removes section, restores source note |
| POST | `/documents/{id}/media` | Upload image or audio for a note (`multipart/form-data`, field `file`; requires write permission) → `{id, kind, mime, size, url}`. `415` invalid format, `413` too large or storage quota exceeded |
| POST | `/documents/{id}/media/fetch` | Copy external image: `{url}` (https only, no internal addresses; disabled in demo) → same response as above |
| GET | `/media/{id}` | Retrieve file (requires read permission on a note referencing it), supports HTTP range requests; otherwise `404` |
| GET | `/link-preview?url=https://…` | Preview of a webpage (`title`, `description`, `siteName`, `hasImage`, `hasIcon`, `ok`, `key`), fetched by server and cached for 7 days; `422` without https, `403` in demo, `429` rate limit exceeded |
| GET | `/link-preview/{key}/image` and `/icon` | Image or icon for a preview |

Note content (blocks) is modified exclusively via `POST /docs/{id}/sync`. `POST /documents` still accepts an initial block list upon creation; this is internally converted into operations.

## Collaborative Note Editing
<a id="gemeinsames-bearbeiten-von-notizen"></a>

Concept and rules: [modules/collaboration.md](../modules/collaboration.md). Access via role `owner`/`editor`/`viewer` (`Store.DocRole`); `404` without a role.

| Method | Path | Purpose |
|---|---|---|
| GET | `/docs/{id}/snapshot` | Complete block tree including tombstones, `title`, `titleVersion`, `headSeq`, `role`, `shared` |
| POST | `/docs/{id}/sync` | Single round-trip: submit local operations, acquire/release leases, fetch log starting at `lastSeq` |
| GET | `/docs/{id}/changes?since=N&wait=S` | Long polling: returns immediately if `headSeq > N`, otherwise on next change (including leases/presence) or after at most 25 s. Response `{headSeq, changed}`; client then retrieves data via `/sync` |
| POST | `/docs/{id}/leave` | Terminate session, release all client leases (`{clientId}`) |

`/sync` request:

```json
{
  "clientId": "tab-7f3…",
  "lastSeq": 412,
  "ops": [
    { "opId": "c1a…", "kind": "set_content", "blockId": "b9…", "baseVersion": 7, "content": "Milk and bread" },
    { "opId": "c1b…", "kind": "insert", "blockId": "bA…", "parentId": "b2…", "orderKey": "a0V", "type": "bullet", "content": "" }
  ],
  "leases": { "hold": ["b9…", "bA…"], "release": [] }
}
```

- Operation kinds: `insert`, `set_content`, `set_props` (`patch`: `type`, `checked`, `collapsed`, `lang`, `clearConflict`), `move`, `delete`, `restore` (`ids`), `set_title` (`baseVersion`, `title`).
- `leases.hold` is the complete list of blocks the client intends to hold; all other leases belonging to the client are released. Newly inserted blocks and conflict copies are automatically granted to the author.
- At most 500 operations per request. Viewers cannot submit operations (`403`), but may query.
- `skipLog: true` suppresses returning the operation log; intended for single mutations without an active editor (e.g. checking off items in the to-do overview).

Response: `results` (per operation: `status` `applied`/`conflict`/`rejected`, optionally `conflictBlockId`, `version`, `seq`), `ops` (log entries `{seq, opId, userId, clientId, effect}` from `lastSeq`, at most 1000; `hasMore` if more exist), `headSeq`, `resync` (reload snapshot: the client is ahead of the server, or its `lastSeq` precedes the compacted boundary `log_floor`; submitted operations are applied regardless), `role`, `shared`, `sessions`, `presence`, `leases` (`granted`, `denied`, `others`).

Duplicate operations (same `opId`) are not reapplied; the response returns the previously stored result.

## Shared Lists

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/lists` | Lists; create (`title`, `icon`, `listType`; `icon: ""` = no icon, if omitted: 🛒) |
| GET/DELETE | `/lists/{id}` | Retrieve with items; delete |
| GET/POST | `/lists/{id}/shares` | Retrieve or create shares (`targetType`, `targetId`, `role`: `editor`/`viewer`) |
| DELETE | `/lists/{id}/shares/{shareId}` | Remove share |
| POST | `/lists/{id}/items` | Add item (`content`, `category`, `quantity`) |
| PATCH | `/lists/{id}/items/{itemId}` | Check off item (`isCompleted`) |
| PUT | `/lists/{id}/items/{itemId}` | Update item (`content`, `category`, `quantity`) |
| DELETE | `/lists/{id}/items/{itemId}` | Delete item |
| POST | `/lists/{id}/items/{itemId}/move` | Move to another list (`targetListId`); requires edit permissions on both lists; item is placed at the top |
| POST/PUT | `/lists/{id}/items/reorder` | Order/category (`items[{id, sortOrder, category, content}]`) |
| POST | `/lists/{id}/clear-completed` | Remove completed items |

## Groups

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/teams` | Own groups; create (`name`, `description`) – creator becomes group admin, group belongs to their organization; blocked in `private` mode |
| PUT/DELETE | `/teams/{id}` | Group admin only |
| POST | `/teams/{id}/members` | Add member (`userId` or `email`, `role`); only visible users, otherwise `404` |
| PUT/DELETE | `/teams/{id}/members/{userId}` | Change role (`admin`/`member`); remove |

## Administration (`role = admin`)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/admin/users` | List users; create (`email`, `password`, `displayName`, `role`, optional `organizationId`) |
| PUT | `/admin/users/{id}/organization` | Assign organization (`organizationId`, empty = none); revokes shares, groups, and assignments from the previous organization |
| GET/POST | `/admin/organizations` | Organizations with `memberCount`; create (`name`) |
| PUT/DELETE | `/admin/organizations/{id}` | Rename (`name`); delete (members afterwards have no organization) |
| PATCH/DELETE | `/admin/users/{id}` | `displayName`, `username` (rules and errors as in `/auth/settings`), `email`, `role`, `isActive`, `discordWebhookUrl`; delete (for pending accounts = reject). `GET /admin/users` flags pending accounts with `pendingApproval` |
| POST | `/admin/users/{id}/approve` | Approve pending account; the user receives an email (`409` if not pending) |
| PUT | `/admin/users/{id}/password` | Reset password |
| GET/POST | `/admin/invites` | List or create invitations (`email`, `role`, `organizationId`, `validDays`, `maxUses` 1–1000; multi-use invites are not bound to an email address). Response includes `maxUses`/`useCount`. As link: `/?invite=<CODE>` opens registration with code pre-filled |
| POST | `/admin/invites/{id}/send` | Send invitation via email (`email`); binds single-use codes to this address; requires SMTP |
| DELETE | `/admin/invites/{id}` | Revoke/delete invitation |
| GET/PUT | `/admin/settings` | `instanceName`, `allowRegistration`, `sharingMode` (`private`/`organizations`/`open`), SMTP fields; changing mode cleans up shares. `smtpPass` is never returned (`smtpPassSet` indicates whether one is stored); empty = unchanged |
| GET | `/admin/settings/sharing-impact?mode=` | Dry run: how many shares and group memberships a mode change would remove (`affected`) |
| POST | `/admin/smtp/test` | Test email (`toEmail`) |
| GET | `/admin/voice` | Active voice recognition (`mode`: `server`/`browser`/`off`), settings from `STT_*` without secrets, limits, and in server mode fresh health status (`status.reachable`, `status.modelReady`) |
| GET/POST | `/admin/backups` | List database dumps or create backup immediately (database dump + all user backups) |
| GET | `/admin/backups/{name}` | Download database dump |
| DELETE | `/admin/backups/{name}` | Delete database dump (returns remaining list; disabled in demo) |

## Examples

```bash
# Capture thought via API key
curl -X POST https://mindsift.example.com/api/v1/webhooks/ingest \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" \
  -d '{"title":"Buy milk #shopping","priority":"high","dueDate":"2026-11-01"}'

# What is due today (scope tasks:read), e.g. for a Home Assistant sensor
curl "https://mindsift.example.com/api/v1/tasks?due=today&status=open" -H "X-API-Key: mindsift_sec_…"

# Complete task (scope tasks:write)
curl -X PATCH https://mindsift.example.com/api/v1/thoughts/th_… \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" -d '{"isCompleted":true}'

# Add item to shopping list via API key (scope webhook:list or lists:write)
curl -X POST https://mindsift.example.com/api/v1/webhooks/ingest \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" \
  -d '{"target":"list_item","listId":"lst_…","content":"Oat milk","quantity":"2"}'

# Share task list as read-only
curl -X POST https://mindsift.example.com/api/v1/task-lists/tkl_…/shares \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"targetType":"user","targetId":"usr_…","permission":"viewer"}'
```
