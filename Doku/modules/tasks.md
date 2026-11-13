# Module: Tasks, Kanban & Alarms

Code: [TasksView.tsx](../../frontend/src/features/triage/TasksView.tsx), [TaskDetailModal.tsx](../../frontend/src/features/triage/TaskDetailModal.tsx), [ManageColumnsModal.tsx](../../frontend/src/features/triage/ManageColumnsModal.tsx); Backend: `handleUpdateThought`, `handleReorderTasks`, `*TaskList*` handlers, `startAlarmTicker`.

## Data Model

A task is a `thought` ([database.md](../database.md)) with `kanbanStatus`, `priority` (`low`/`normal`/`high`/`urgent`), `dueDate` (`YYYY-MM-DD` or with time `YYYY-MM-DDTHH:MM`; the API also accepts `YYYY-MM-DD HH:MM`), `notes` (Markdown), `subtasks` (`[{id, title, isCompleted}]`), `tags`, `taskListId`, `sortOrder`, and `assignees` (user IDs). Tasks without a list are personal.

## Views

- **List** with Open, Completed, and Trash tabs; grouping (e.g. by status or due date) and sorting are located to the right on desktop, directly above the list. The hashtag filters above remain on a single line; if they do not all fit, "…" expands them across multiple lines.
- **Kanban:** Columns freely configurable per list (name, color, "Done" column). Colors in "Customize columns" via the dot before the name: Gray, Slate (theme text color), Green, Yellow, Blue, Red, Purple, Accent color (`columns[].color` = `gray`/`slate`/`green`/`yellow`/`blue`/`red`/`purple`/`accent`; legacy values `emerald`/`amber` count as Green/Yellow, columns without a color retain the one from their role). The dot appears in the column header, before the status in the list view, and in the detail modal ([ManageColumnsModal.tsx](../../frontend/src/features/triage/ManageColumnsModal.tsx), `columnDotClass`). Blue and Purple come from `--color-info` / `--color-purple`; themes can set them, otherwise default values from `index.css` apply. Default: *To Do*, *In Progress*, *Waiting for others*, *Done*. Dragging a card into a "Done" column sets `isCompleted`; the determining factor is the column marked as done for the list, regardless of its ID (`isDoneColumn` during reordering). On desktop, the board is as tall as the viewport when all columns fit in a single row; then only the columns scroll.
- **"All Tasks" as Kanban:** The columns of all lists are merged by name (case-insensitive), using the order and color of the first list that defines the column; differently named columns remain separate. When dragging, columns not present in the card's list are grayed out and do not accept drops. Status selection, arrows on the card, and detail modal always use the columns of the task's own list.
- **Trash and retention** ([task_trash.go](../../internal/storage/task_trash.go), [retention.go](../../internal/storage/retention.go)): Deleted tasks, "Move completed to trash" (`POST /tasks/clear-done`), and completed tasks whose retention period has expired move to the task trash (table `trashed_tasks`: the entire row including assignments as a copy). Anyone who can view the list can view its trash; restoring and permanent deletion require edit permissions. A restored task is recovered unchanged (if its list was deleted, it becomes a personal task of its creator). Retention periods are configured by each user under Account Settings → Data Retention (completed tasks default 30 days, trash 30 days); within a list, the owner's retention period applies. The completion timestamp is set by a trigger (`thoughts.completed_at`), regardless of how the task was checked off; the server cleans up hourly (disabled in demo). A checkbox linked to a note remains as a normal checkbox.
- **Undo:** `Ctrl+Z`/`Cmd+Z` reverts recent actions in the tasks view (up to 20): deletion (restoring from trash), moving (columns, order), and checking off. After deletion, a banner at the bottom offers "Undo", including on mobile. Inside text fields, their native undo applies.
- Drag & drop sorts within the list and across columns; a click opens the detail modal (title, status, priority, due date with optional time and quick picker, list, hashtags, subtasks with progress bar, notes).
- "Expand as a note" converts a task into a note (title, followed by due date and priority, then notes and subtasks). The task remains in its list and is linked to the note's first checkbox (`converted_type = document_block`); in contrast, a thought from Triage is converted entirely into a note. Tasks created from note checkboxes (`enhanced-task`) remain linked; "Open in note" jumps directly to the block.
- **Syncing linked tasks** ([task_doc_sync.go](../../internal/storage/task_doc_sync.go)): Checkmarks and titles synchronize bidirectionally (Note → Task in `ReconcileDocTaskLinks` after every note edit, Task → Note in `SyncTaskToDoc` after every task edit). Subtasks are part of the link: Each is connected 1:1 with a checkbox in the same note (`subtasks[].blockId`, "Subtask" badge, `DocumentBlock.subtaskOf`), even if moved or indented differently. New subtasks get a checkbox directly beneath the main checkbox; new checkboxes directly one level below become subtasks (more deeply indented ones remain regular note content). Deletion is not synced: deleting a checkbox only severs the link, while deleting a subtask leaves its checkbox intact. A checkbox moved to another note receives a new ID there and thereby loses the link. The note's sync response includes `taskLinks` and `subtaskLinks` so badges update immediately.

## Task Lists and Sharing

- Each list has an owner, title, icon, color, and its own Kanban columns.
- Sharing with groups or users via the `UnifiedShareModal` dialog (level per share):
  - **Editor:** can create, edit, check off, move, and delete tasks, as well as rename the list and modify columns.
  - **Viewer:** sees everything, cannot modify anything. The server responds with `403`; the UI hides input fields and displays "Read-Only".
  - Group members with multiple access paths receive the highest level. Only the owner creates or removes shares and can delete the list.
- Implementation: `Store.GetTaskListPermission` returns `owner`/`editor`/`viewer`/`""`; `ensureTaskListWritable` guards write paths.
- **Assignment** (only in shared lists, i.e. with at least one person besides the owner): In the detail modal under "Assignees", one or more persons with access to the list can be assigned using the unified person search ([ui-patterns.md](../ui-patterns.md)). Owners and editors are permitted to assign. Rows and Kanban cards display assignees as an avatar stack.
  - Stored in `task_assignees`; `PATCH /thoughts/{id}` with `assignees` replaces the list. The server rejects persons without access (`403`, `storage.ErrAssigneeNoAccess`).
  - **Assignments follow permissions:** `Store.PruneTaskAssignees` removes any assignment where the person can no longer see the list. It runs after removing a share, leaving or being removed from a group, deleting a group, deleting the list, and moving the task to another list or no list; when deleting an account, its assignments are deleted directly. Users who retain access via a second path (e.g. directly and via a group) remain assigned.
- Who can view and assign also depends on visibility: If someone loses visibility (e.g. organization change), sharing and assignments are revoked ([sharing-and-permissions.md](../sharing-and-permissions.md)).
- **Watching tasks (`task_watchers`):** In the detail modal, a task can be subscribed to via "Watch" (`POST /tasks/{id}/watch`, `DELETE /tasks/{id}/watch`). Every change to a watched task is notified to the watcher via their configured notification channels.

## Recurring Tasks

- In the detail modal under due date: *No recurrence*, daily, weekly, monthly, or yearly (`thoughts.recurrence`, `PATCH /thoughts/{id}` with `recurrence`). Rows and Kanban cards then display a 🔁 icon.
- **Checking off creates the next task** ([recurrence.go](../../internal/storage/recurrence.go)): whether in the detail view, list, via dragging into "Done" on Kanban, or via a checkbox in a note. The completed task remains completed (history); the new one inherits title, tags, priority, notes, list, assignments, and the recurrence rule; subtasks are carried over as incomplete; it is placed in the first open column.
- **Due date:** the previous date plus one interval (if without a date, starting today); time of day is preserved. Months and years retain the day of the month or snap to the month end (Jan 31 → Feb 28/29).
- Each task spawns at most one successor (`recurrence_spawned`): Reopening and checking off again does not create a second task.
- The new task is broadcast via `TASK_CREATED` to all participants, appearing without a reload.
- Export/Import: in the Markdown archive as `🔁 every week` (Obsidian Tasks plugin format), in the JSON backup as a field; both are restored on import.

## Alarms

The ticker runs every minute ([architecture.md](../architecture.md)). For open tasks with `alarm_sent = 0`, it sends notifications as soon as the alarm time is reached (due time, all-day 9:00 AM, in each case minus `notifyBeforeMinutes`, in the server's time zone), targeting the channels of the task **owner**:

| Channel | Target | Configuration |
|---|---|---|
| Email | the confirmed login address (`email`) | SMTP from admin settings or environment, see below |
| Discord | Webhook URL | User settings |
| Webhook | Arbitrary URL (JSON: `event`, `title`, `notes`, `dueDate`, `priority`, `timestamp`) | User settings |

Afterwards, `alarm_sent = 1` is set as soon as at least one channel succeeds. In addition to due date alarms (which are dispatched immediately), MindSift supports granular notifications for shares, completed shared tasks, and watched tasks, which are batched via `notification_queue` and sent after `NOTIFY_DIGEST_MINUTES` ([architecture.md](../architecture.md#notifications)).

**Email delivery** ([mail.go](../../internal/api/mail.go)) executes the SMTP conversation step by step:

- Connection (port 465: TLS from the start), `EHLO` with the domain of the sender address (never `localhost`, which strict servers reject), mandatory STARTTLS if `SMTP_TLS`, authentication, `MAIL FROM`, `RCPT TO`, data.
- Authentication: `AUTH PLAIN`; if the server only offers `LOGIN`, directly `AUTH LOGIN`. If it rejects PLAIN and also offers LOGIN, MindSift reconnects and attempts `AUTH LOGIN` (Go closes the connection after a failed AUTH). If both fail with `451`, the error message mentions both attempts and refers to the mail server's SASL backend (e.g. Dovecot auth), since the fault lies there. Never unencrypted to external hosts.
- `SMTP_FROM` may contain a display name (`MindSift <alarm@domain>`): the envelope contains only the email address, while the header contains name and address.
- The message includes `Date` and `Message-ID`, an RFC 2047-encoded subject (umlauts, emoji), and quoted-printable body text.
- `SMTP_SKIP_VERIFY` / "Disable certificate verification" toggle accepts self-signed certificates (connection remains encrypted).
- Errors specify the step where the server rejected the connection/command (e.g. `SMTP step RCPT TO failed: 451 …`), logged as `smtp_step`. Test: `internal/api/mail_test.go` with a fake server (STARTTLS, 451).

Setting a new due date or reopening a task resets `alarm_sent`, so the alarm fires again. If all channels fail, the ticker retries in subsequent minutes and gives up after 3 failed attempts (`alarm_failures`, warning logged in server log); a new due date or reopening resets the counter to 3 attempts. URLs are validated.

The UI displays due dates relatively ("Today, 14:30", "Tomorrow", "Fri, Oct 30"); overdue open tasks (down to the minute when a time is set) are highlighted in red. Grouping and sorting by due date take the time into account, with all-day tasks appearing before timed tasks on the same day.
