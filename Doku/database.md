# Database

SQLite file `mindsift.db` (default: `$DATA_DIR/mindsift.db`), opened with `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=10000`, and at most 8 connections. **Rule:** a function never needs a second connection while it holds one: no query inside a loop over open `rows` and none between `Query` and the loop (read the rows, close them, then query on), and no `s.db` call inside a transaction (use the `tx`). Otherwise enough parallel requests use up the pool and every request waits forever (load test 2026-11-05). The tests run with `DB_MAX_CONNS=1` in the build, so such code hangs there at once (`TestQueriesNeedOnlyOneConnection` covers search, list and folder shares and task lists). Reads that must be consistent but not block writers (note snapshot, sync log) use `readConsistent`: one connection with a deferred `BEGIN`, a WAL snapshot without the write lock that `s.db.Begin()` takes (`_txlock=immediate`). The schema is constructed in `Store.migrate()` ([sqlite.go](../internal/storage/sqlite.go)): first `CREATE TABLE IF NOT EXISTS`, followed by a list of idempotent `ALTER TABLE`/`CREATE` statements for older databases. IDs are text prefixed with type identifiers (`usr_…`, `th_…`, `tkl_…`, `lst_…`, `tls_…`, `blk_…`, `doc_…`) followed by 96 random bits encoded in hex; older records have shorter IDs (40 bits).


## Tables

### Users and Access
| Table | Purpose | Key Columns |
|---|---|---|
| `users` | User accounts | `email` (unique), `username`, `password_hash` (`sha256-bcrypt:<bcrypt hash>`, or plain bcrypt from before v0.96 until the next sign-in), `display_name`, `role` (`admin`/`manager`/`member`), `is_active`, `token_version`, `alarm_channels` (comma-separated), `alarm_email` (unused since Migration 35, always empty: mail alarms go to `email`), `discord_webhook_url`, `custom_webhook_url`, `notify_before_minutes`, `avatar_url`, `organization_id` (unused since Migration 23, always empty), `notification_settings` (JSON of channels and events), `last_daily_summary` (date of last dispatch), retention periods in days (`done_retention_days` 30, `task_trash_days` 30, `triage_trash_days` 14, `note_trash_days` 30, `list_done_days` 7; 0 = never), `voice_input` (`''` = Whisper server, `browser`), `tour_offered` (1 = the app asked about the guided tour; migration 36 set it for every account that existed then) |
| `user_invites` | Invitation codes | `code`, `email`, `role` (always `member`), `organization_ids` (comma-separated, Migration 23), `expires_at`, `used_by` |
| `organization_members` | Who belongs to which organization (Migration 23); a person can be in several | `org_id`, `user_id`, `created_at`; primary key `(org_id, user_id)` |
| `public_links` | Public read-only links to notes (Migration 24), at most one per note | `doc_id` (unique), `created_by`, `token_hash` (SHA-256 of the token), `token_sealed` (token encrypted with `SECRETS_KEY`, so the owner can copy it again), `password_hash` (bcrypt, `''` = none), `theme_family` (unused since v0.87.1), `expires_at` |
| `media` | Images and audio in notes (Migration 5); file stored under `$DATA_DIR/media/<doc_id>/<id>.<ext>` | `id`, `doc_id`, `owner_id`, `kind` (`image`/`audio`), `mime`, `size`, `source_url` (fetched external image), `created_at` |
| `link_previews` | Cached link previews (Migration 6) | `key` (hash of URL), `url`, `title`, `description`, `site_name`, `image`/`icon` (BLOB, with `*_mime`), `ok`, `fetched_at` |
| `notification_queue` | Queued notifications pending bundled digest dispatch (Migration 7) | `user_id`, `kind` (`shared`/`assigned`/`mentioned`/`taskCreated`/`taskDone`/`watched`), `payload` (JSON; `title`, `text`, optional `key` to send repeated changes once), `created_at`, `attempts` |
| `task_watchers` | Watched tasks (Migration 7) | `task_id`, `user_id`, `created_at` |
| `task_list_mutes` | Task lists a person muted (Migration 29) | `user_id`, `task_list_id`, `created_at`; removed with the list |
| `task_alarms_sent` | Due alarm per task and recipient (Migration 29) | `task_id`, `user_id` (`*` = sent to everyone before alarms were per person), `sent`, `failures`; trigger `task_alarm_rearm` clears the rows when `thoughts.alarm_sent` goes from 1 to 0 (new due date, reopened) |
| `center_entries` | Notification center (Migration 31) | `user_id`, `kind`, `title`, `text`, `target_type`, `target_id`, `block_id`, `group_key` (`watched:<task>` keeps the latest change, `due:<task>:<date>` once), `created_at`, `read`; removed after 14 days |
| `block_mentions` | @-mentions last seen per bullet (Migration 30) | `document_id`, `block_id`, `user_id`, `count`; only a higher count notifies |
| `push_subscriptions` | Registered Web Push devices (Migration 9) | `user_id`, `endpoint` (unique), `p256dh`, `auth`, `device`, `created_at` |
| `push_keys` | VAPID key pair when not configured via environment (Migration 9) | Single row: `public_key`, `private_key` |
| `journal_days` | Daily journal mapping: which note belongs to which day (Migration 8) | `user_id`, `day` (`YYYY-MM-DD`), `doc_id`; primary key `(user_id, day)` |
| `sessions` | Logged-in devices (Migration 4, replaces `revoked_tokens`) | `id` (= `jti` of token), `user_id`, `created_at`, `last_used_at` (updated at most every 5 minutes), `user_agent`, `ip`, `revoked_at` (empty = active), `via` (Migration 39: how the session started, `password`, `passkey` or `oidc`; empty in older rows = password; the second factor the administration requires applies to password sessions only) |
| `user_totp` | Authenticator app of an account (Migration 37) | `user_id` (primary key), `secret_sealed` (TOTP secret encrypted with `SECRETS_KEY`, additional data `totp:<user id>`), `created_at`, `confirmed_at` (empty while the setup waits for the first code; only a confirmed app is asked at sign-in), `last_step` (30-second step of the last accepted code; earlier ones are refused) |
| `user_recovery_codes` | Recovery codes of the two-factor sign-in (Migration 37) | `user_id`, `code_hash` (SHA-256 of user id and normalized code), `created_at`, `used_at` (empty = unused); primary key `(user_id, code_hash)` |
| `trusted_devices` | Devices that sign in without a code (Migration 37) | `id` (`tdv_…`, first part of the token), `user_id`, `token_hash` (SHA-256 of the token's secret), `token_version` (must equal `users.token_version`), `user_agent`, `created_at`, `expires_at` (30 days), `last_used_at` |
| `user_passkeys` | Passkeys (WebAuthn) of an account (Migration 38) | `id` (`psk_…`), `user_id` (index), `credential_id` (base64url, unique; the passkey's id at the authenticator), `public_key` (COSE key), `attestation_type`, `aaguid` (authenticator model), `transports` (comma list), `attachment`, `sign_count` (signature counter; one that is not 0 must go up), `backup_eligible`, `backup_state` (shown as "synced"), `name` (up to 60 characters), `created_at`, `last_used_at` (empty = never). Nothing secret: the private key stays on the authenticator. Removing the last passkey of an account without app also removes its recovery codes and trusted devices |
| `oidc_identities` | Accounts tied to the identity at the OpenID Connect provider (Migration 39) | `issuer`, `subject` (the provider's `sub`; together the primary key), `user_id` (unique per issuer), `email` (the address at the time of linking, informational only: the link follows `sub`), `created_at`, `last_login_at`. Deleting the account removes its rows. Accounts created through the provider have no password of their own: `users.password_hash` starts with `none:` (`auth.NoPasswordHash`, a hash of a random value that never matches) |
| `user_themes` | User custom CSS themes | `user_id` (FK, `ON DELETE CASCADE`), `name`, `css_content` |
| `api_keys` | Webhook/API keys and OAuth connections | `name`, `key_prefix`, `key_hash` (SHA-256), `scopes` (`webhook:triage`, `webhook:task`, `webhook:list`, `tasks:read`, `tasks:write`, `lists:read`, `lists:write`), `last_used_at`, `kind` (`key`/`oauth`, Migration 17), `oauth_client_id` |
| `oauth_clients` | Self-registered OAuth clients (Migration 17); purged after 24 hours without connection | `id` (`client_id`), `name`, `redirect_uris` (JSON), `created_at` |
| `oauth_codes` | One-time authorization codes, valid 10 minutes (Migration 17) | `code_hash` (SHA-256), `client_id`, `key_id` → `api_keys`, `redirect_uri`, `code_challenge`, `expires_at` |
| `oauth_tokens` | Access and refresh tokens (Migration 17) | `token_hash` (SHA-256), `kind` (`access`/`refresh`), `key_id` → `api_keys` (cascades on delete), `expires_at`, `replaced_at` (timestamp when rotated) |
| `system_settings` | Key/value pairs for instance settings; `GetSystemSettings` keeps them in memory after the first read (one process; `UpdateSystemSettings`, the demo reset and closing the store forget the copy, callers get copies of their own). Write only through `UpdateSystemSettings` | `sharing_mode`, `allow_registration`, `instance_name`, `smtp_*`, `time_zone` (IANA name of the server's time zone, `''` = not set: `TZ`, else UTC) |

### Thoughts and Tasks
| Table | Purpose | Key Columns |
|---|---|---|
| `password_reset_tokens` | Password reset links | `token_hash` (SHA-256), `user_id`, `created_at`, `expires_at` (1 h), `used_at` |
| `thoughts` | Thoughts **and** tasks in a single table | `status` (`inbox`/`kept`/`converted`/`discarded`), `converted_type` (`task`/`document`/`list_item`/`document_block`), `converted_ref_id`, `priority`, `is_completed`, `due_date` (`YYYY-MM-DD` all-day or `YYYY-MM-DDTHH:MM`, server timezone), `task_list_id`, `kanban_status`, `notes`, `subtasks` (JSON), `tags` (JSON), `alarm_sent`, `alarm_failures` (failed alarm attempts, given up after 3), `recurrence` (`daily`/`weekly`/`monthly`/`yearly`/empty), `recurrence_spawned`, `sort_order`, `source` (`manual`, `voice`, `webhook` …), `completed_at` (set by trigger on completion, cleared on reopening), provenance (`created_via`, `created_key_id`, `changed_via`, `changed_key_id`, `changed_at`) |
| `trashed_tasks` | Trash bin for tasks | `id` (of task), `user_id`, `task_list_id`, `owner_id` (whose retention period applies), `content`, `is_completed`, `data` (entire `thoughts` row as JSON), `assignees` (JSON), `trashed_at`, `trashed_by` |
| `task_assignees` | Task assignments | `task_id` (FK `thoughts`, `ON DELETE CASCADE`), `user_id`, `created_at`; only persons with access to the list, pruned via `PruneTaskAssignees` |
| `task_lists` | Task lists | `user_id` (owner), `title`, `icon`, `color`, `columns` (JSON, Kanban columns) |
| `task_list_shares` | Task list shares | `target_type` (`team`/`user`), `target_id`, **`permission`** (`editor`/`viewer`, default `editor`) |

A task is a `thought` with `status='kept'` or `status='converted' AND converted_type='task'`. Tasks originating from a note block have `converted_type='document_block'` and `converted_ref_id='<docId>:<blockId>'`.

### Workspace
| Table | Purpose |
|---|---|
| `documents` | Notes: `title`, `icon`, `folder_path`, `tags` (JSON), `is_archived` (1 = in trash), `archived_at`, `archived_by` (user who deleted it), `markdown_cache`, `shared_folder_id`, `sub_folder_path`, `head_seq` (latest log position), `title_version`, `log_floor` (log compacted up to this point), legacy columns `content`, `blocks_json` |
| `blocks` | Outliner blocks as a tree: `document_id`, `parent_id` (`''` = top level), `order_key` (fractional order key among siblings), `type`, `content`, `checked`, `collapsed`, `lang`, `version` (text version), `conflict_of`/`conflict_author` (conflict copies), `updated_by`, `deleted` (tombstone), and `deleted_at` (deletion timestamp, used for pruning). `level`/`position` are legacy columns and no longer maintained; depth and order are calculated by the server when reading the tree. |
| `doc_ops` | Operation change log per note: `seq` (sequential per note), `op_id`, `user_id`, `client_id`, `kind`, `block_id`, `payload` (mutation effect as JSON), `created_at`. Replaying all entries from a snapshot yields the current state. Periodically compacted (see below). |
| `doc_op_results` | Results per client operation (`op_id` unique) for idempotent retries; purged after 90 days |
| `block_tags` | `#hashtags` per block (`tag`, `document_id`, `block_id`) |
| `block_refs` | What a bullet points to (Migration 41), so these lookups use an index instead of searching the text of every block: `block_id`, `document_id`, `kind` (`media`: a file, `ref_id` = `media.id`, from `media:med_…`; `secret`: a hidden value, `ref_id` = `note_secrets.id`, from `{{secret:…}}`), `ref_id`. Written with the block in `persistDocState` (only when its references change), removed with it by the trigger `trg_blocks_refs_ad`; tombstones keep their rows (queries for live bullets join `blocks` on `deleted = 0`). The migration fills it from the existing blocks. Used by the media cleanup, read rights of a file, public pages, export and the secret sweep (queries in [block_refs.go](../internal/storage/block_refs.go)) |
| `tag_pages` | Freeform note per user and tag |
| `doc_pins` | Pinned notes / favorites per user |
| `doc_shares`, `doc_team_shares` | Note shares to users or teams (`permission`: `read` = viewer, `write` = editor) |
| `workspace_folders` | Explicitly created folder paths |
| `workspace_shared_folders` | Shared folders (entities with an owner) |
| `workspace_folder_shares` | Shared folder permissions |
| `workspace_folder_mounts` | Personal mount path per recipient and shared folder |
| `doc_user_folders` | Personal filing location for shared individual notes per recipient |
| `note_secrets` | Hidden values in notes (`/secret`): `document_id` (note it belongs to), `created_by`, `ciphertext` (AES-256-GCM with `SECRETS_KEY`, the id bound as additional data), `orphaned_at` (no bullet holds the reference any more; deleted 30 days later by the hourly cleanup, together with the note when it is purged) |

Block types: `h1`, `h2`, `h3`, `paragraph`, `text`, `todo`, `bullet`, `code`, `callout`, `warning`, `error`, `divider`, `table`, `progress`.

`lang` is the language of a code block; for a `table` it holds the line mode (`''` inner lines fading out, `grid` all lines with a frame, `header` the line below the header and the column lines). A table's `content` is a Markdown table in GitHub's style (header, separator row, rows; `|` in a cell written `\|`); the separator row holds each column's alignment (`---` left, `:---:` centered, `---:` right; `:---` is read as left too).

### Lists
| Table | Purpose |
|---|---|
| `lists` | Shared lists: `title`, `icon`, `list_type` (`shopping`/`checklist`/`vacation`) |
| `list_shares` | Shares: `target_type`, `target_id`, `role` (`editor`/`viewer`) |
| `list_items` | Entries: `content`, `category`, `quantity`, `is_completed`, `completed_by(_name)`, `created_by` (empty for older items), `sort_order` |

### Teams
| Table | Purpose |
|---|---|
| `teams` | User groups/teams: `name`, `description`, `org_id` (creator's organization) |
| `team_members` | `team_id`, `user_id`, `role` (`admin`/`member`) |
| `organizations` | Created by server admins and user managers: `name`. Members in `organization_members` (a person can be in several) |

## Relationships

```
users 1─n thoughts            thoughts n─1 task_lists (task_list_id, loose)
users 1─n task_lists          task_lists 1─n task_list_shares ─(team|user)→ teams/users
users 1─n documents 1─n blocks 1─n block_tags
documents n─n users           via doc_shares / doc_team_shares (read-only)
workspace_shared_folders 1─n workspace_folder_shares / workspace_folder_mounts
users 1─n lists 1─n list_items;  lists 1─n list_shares
teams 1─n team_members n─1 users
```

`thoughts.task_list_id` is not a foreign key constraint; when a list is deleted, the code updates references to `''`.

## Database Errors

A database error is never an answer ([dberr.go](../internal/storage/dberr.go)):

- Functions that return an `error` pass it on.
- Functions that answer with a plain value (a bool, a count, a list) log it with the place it happened (`logDBErr`; message `Database query failed`, field `at`). Where they decide something they ask `dbFailed` and answer on the safe side: an account that cannot be checked counts as waiting for approval or confirmation, an address as taken, an administrator as the last one, a note as shared, the MCP switch as off.
- `sql.ErrNoRows` is an answer ("no such row"; `rowErr` turns it into `nil`). `context.Canceled` is a failure that is not logged: the request went away, nothing is wrong with the database.
- In list reads a row that cannot be scanned is logged and skipped; a read that breaks off (`rows.Err()`) is returned, or logged where there is no error to return.
- Statements nothing else depends on (`last_used_at`, cleaning up) run through `execLogged`. In the API, `logFailed` ([server.go](../internal/api/server.go)) does the same for steps the answer does not depend on (a mail on the side, removing a queue entry).

Dropped on purpose (`_ =`) are only best-effort seeding of sample data, `rows.Close()`, and decoding stored JSON columns.

## Migrations and Startup Cleanup

- Columns/tables/indexes are updated incrementally (`ALTER TABLE … ADD COLUMN`, errors ignored).
- Legacy tables are dropped: `spaces`, `space_members`, `space_team_shares`, `document_crdt_state`, `document_crdt_updates`, `document_blocks`, `doc_block_tags`, `revoked_tokens`.
- `users.username` is backfilled from the email prefix (baseline); migration 20 then sets it from the display name for every account (spaces and other characters become dots, a number is appended for duplicates).
- Note synchronization (`migrateDocSync`): adds new columns to `blocks` (including `deleted_at`; existing tombstones are initialized with the migration timestamp) and `documents` (`head_seq`, `title_version`, `log_floor`), creates tables `doc_ops` and `doc_op_results`. Blocks in legacy flat format (using only `level`/`position`) are converted once into tree hierarchy.
- Default settings in `system_settings` (`INSERT OR IGNORE`): `sharing_mode=organizations`, `allow_registration=false`, `instance_name=MindSift`, SMTP empty.
- **Migrations:** [migrations.go](../internal/storage/migrations.go) executes numbered steps (3 "Baseline schema v0.4.1", 4 "Sessions", 5 "Media", 6 "Link previews", 7 "Notifications", 8 "Journal", 9 "Web Push", 10 "Registration and invite links", 11 "Email verification", 12 "AI agent entry flags", 13 "Provenance of entries (API keys)", 14 "Clean up completed tasks", 15 "Voice input per user", 16 "Retention and task trash bin", 17 "OAuth for MCP access", 18 "Folders in the trash", 19 "Language per person", 20 "Usernames from display names") exactly once and records them in `schema_migrations` (`id`, `name`, `applied_at`); `PRAGMA user_version` reflects the highest applied migration number. Step 3 (`migrateBaseline`) sets up the baseline schema and migrates older databases to this level; columns are only created if missing. If a step fails, startup aborts with the error message instead of proceeding with a partially migrated schema. New schema changes are added as a new step at the end; old steps are never modified. Data is never deleted during startup; only demo mode resets the database.
- **Backup before migrations:** when steps are pending and the database already has tables (not a new or just reset one), `migrate` first writes a consistent copy (`VACUUM INTO`, gzipped, like the daily snapshot) to `$DATA_DIR/backups/system/pre-migration-<highest applied id>-YYYY-MM-DD-HHMMSS.db.gz` and logs its path. Without the copy (full disk: the uncompressed copy needs about the size of `mindsift.db` while it is written) nothing is migrated and the start stops with the reason. The newest three copies are kept, each for at most 90 days, the newest included (they hold accounts deleted since; the hourly cleanup in `api/done_cleanup.go` removes older ones by the time in the name, `Store.ExpirePreMigrationBackups`); they do not follow the daily backups' retention in days and are not listed in the administration (other name). Steps are not one transaction, so a failing step can leave the database half migrated: the file `backups/system/pre-migration-pending` names the copy from before the attempt until all steps went through, and while it is there that copy is kept beside the two newest, so a restart loop does not rotate it away. Databases without a file (`:memory:`) get no copy.
- **Newer database:** if `schema_migrations` holds an id above the highest step this binary knows, an older MindSift was started on a database a newer one has migrated. `migrate` then changes nothing and returns `storage.NewerDatabaseError` (both ids, the backup folder); the server logs it and does not start. Way back: run the newer image again, or stop, restore a pre-migration copy (unpack it over `mindsift.db`, remove `mindsift.db-wal`/`-shm`) and start the older image. Images up to v0.95.0 do not have this check and start silently on a newer database; accounts that signed in on the newer version cannot sign in there (password hashes with `sha256-bcrypt:`), so going back to them always means restoring the pre-migration copy ([operations.md](operations.md#rolling-back)).
- **Only SQLite:** MindSift supports no other database; a `DATABASE_URL` starting with `postgres` is ignored with a warning (`config.Load`), so backup and check always apply to the SQLite file.

## Backup

The entire instance consists of the file `mindsift.db` (plus `-wal`/`-shm` during operation). Back up consistently using `sqlite3 mindsift.db ".backup 'backup.db'"` or by stopping the container and copying the `data/` directory. To restore a file, stop the server first and delete `mindsift.db-wal`/`-shm` before putting it in place ([operations.md](operations.md#restoring-a-whole-server)). Before schema migrations MindSift writes a copy of its own (see above); the daily snapshots are described in [architecture.md](architecture.md#background-job-backups). User export: `GET /api/v1/export` (JSON containing thoughts, notes, lists, task lists).

## Note Log Compaction <a id="verdichtung-des-notiz-logs"></a>

`Store.CompactDocs` runs on startup and every 6 hours thereafter (`startCompaction` in `internal/api/docsync.go`):

| Target | Retention | Effect |
|---|---|---|
| `doc_ops` of shared notes | 30 days | Older entries deleted; `documents.log_floor` tracks the compaction boundary |
| `doc_ops` of private notes | 7 days | Same as above |
| Tombstones in `blocks` | 30 days after `deleted_at` | Permanently purged; this is itself a `purge` log entry, applied by open editors without reloading. A tombstone is retained as long as a newer deleted child block references it. |
| `doc_op_results` | 90 days | Deleted |

A client whose `lastSeq` falls below `log_floor` (e.g. a device offline for weeks) receives `resync: true` from `/sync` and reloads the full snapshot; its pending unsent changes remain in the queue and are applied afterward. Text edits for a block that has since been permanently purged are appended as a new block at the end of the note; a new block whose parent was permanently purged is placed at the root level.
