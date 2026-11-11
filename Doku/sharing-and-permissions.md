# Sharing & Permissions

## Roles

| Level | Values | Meaning |
|---|---|---|
| Server | `admin`, `manager`, `member` | Admins manage everything under `/admin/*`. User managers (`manager`, "Benutzerverwaltung") manage members, invitations and organizations, but not admins or other managers, roles, e-mail addresses, usernames, passwords, or the server settings (mail, backups, voice, sharing rules); see [api/rest.md](api/rest.md). |
| Organization | Member | Determines who may share with whom (see below). A person can belong to several. Assigned by server admins and user managers only. |
| Group | `admin`, `member` | Group admins modify/delete the group and manage members. Whoever creates a group becomes admin. |
| Resource | see below | Owner, Editor, Viewer. |

## Permissions per Resource

| Resource | Owner | Editor | Viewer | Shareable with |
|---|---|---|---|---|
| **Task list** (`task_list_shares.permission`) | everything, delete, (un)share | create/edit/check off/move/delete tasks, rename list, edit columns | view only | Users, Groups |
| **Shared list** (`list_shares.role`) | everything, delete, (un)share | create/edit/check off/delete items | view only | Users, Groups |
| **Note** (`doc_shares`, `doc_team_shares`) | everything, permissions/shares, delete | content, structure, title | read only | Users, Groups |
| **Shared folder** (`workspace_folder_shares`) | everything | edit notes within | read only | Users, Groups |

- **Notes and Folders:** The effective role is computed by `Store.DocRole` (owner, shared folder owner = editor, direct share, group share, folder share; highest wins). In the share dialog, "Edit" and "Read Only" can be selected for notes and shared folders (stored as `write`/`read`). Editors modify content, structure, and title via the sync engine; viewers see changes live.
- For task lists and lists: If someone has multiple access paths (direct and via groups), the **highest** level applies.
- For groups, sharing applies to all current and future members.
- **Task assignments** depend on access: If a user loses their last access path to a task list, the server removes them from all assignments in that list ([modules/tasks.md](modules/tasks.md)).

## Sharing Task Lists (Details)

1. The owner opens "Share" on the list, selects a group or user and the level **Edit** or **Read Only**.
2. `POST /task-lists/{id}/shares` saves `permission`; re-adding the same target updates the level.
3. `GET /task-lists` returns `permission` (`owner`/`editor`/`viewer`) for each list. The frontend hides all input controls for `viewer` and shows "Read Only".
4. Independently, the server checks every write access (`403`, `storage.ErrTaskListReadOnly`).

Existing shares from before this level was introduced were migrated with `editor`, thereby preserving their behavior.

## Who May Share With Whom: Organizations and Modes (`system_settings.sharing_mode`)

Two concepts, do not confuse:

| Concept | Managed by | Purpose |
|---|---|---|
| **Organization** | Server admins and user managers (`/admin/organizations`) | Determines who may **share** with whom. A person can belong to several (`organization_members`). |
| **Group** (code: `teams`) | Users themselves | Shortcut for sharing ("share with my flatmates"). Belongs to one organization (`teams.org_id`); never expands who one may share with. |

| Mode | Who may share with whom |
|---|---|
| `private` | Nobody. Sharing with people and groups are disabled (server responds with error, UI hides them). Public links have their own switch. |
| `organizations` (default) | People with at least one organization in common. Users not belonging to any organization can share with no one. |
| `open` | Everyone. |

**One rule for everything:** `Store.CanSee(a, b)` and `Store.CanShareWith(owner, typ, ziel)` in [visibility.go](../internal/storage/visibility.go). These govern the user directory (`/users/directory`, `/collaborators`), every share (note, folder, task list, list), and adding members to groups. Server admins follow the same rule when sharing; they manage all accounts via `/admin/*`.

- Only members of a group are allowed to share with that group. A group belongs to one of its creator's organizations (`teams.org_id`; with several the creator picks one); in `organizations` mode its members can only come from there.
- Unknown and non-visible persons return the same message ("User or group not found") to prevent user enumeration by email.
- **Sharing can only be done by the owner.** Editors cannot re-share and cannot remove others' shares; however, anyone can remove their own share (leave a shared note or folder).

**People search** (`system_settings.people_search`, `PEOPLE_SEARCH`) only decides how people are found, not with whom one may share: on, the shared people picker suggests everyone one may share with while typing; off, nobody is suggested and a person is added by exact e-mail address or username (`POST /users/lookup`, same `404` for unknown and not allowed, throttled).

**Names in shared things.** Whoever has access to the same note, shared folder, task list or list, or is in the same group, sees the others' names there (avatars, assignments, live cursors, share list), even without a common organization: the owner brought them together. This gives no right to find them elsewhere or share with them (`CanSee` stays the rule). `/users/directory` lists both kinds and marks those one may share with as `findable` (`Store.GetDirectory`).

**Permissions follow the rule.** `Store.PruneSharing` removes everything that would no longer be permitted under the current mode: group memberships outside the group's organization, shares to users the owner may no longer share with, shares to groups that the owner is no longer a member of; followed by empty groups, and task assignments via `PruneTaskAssignees`. Groups left without an admin are assigned one. Removing someone from an organization takes only what no other common organization still allows; `DELETE /admin/organizations/{id}/members/{userId}?dryRun=true` counts it first. It runs after:

- Taking a person out of an organization, deleting an organization
- Changing the mode by an admin (beforehand, `GET /admin/settings/sharing-impact?mode=…` provides a dry-run preview of what would be pruned)
- Leaving or deleting a group, deleting an account

During setup in `organizations` mode, an organization named after the instance is created and the initial admin is assigned to it. Invitations and "Create User" can name any number of organizations. Invitations always create members (also older codes that still say `admin`); roles are given afterwards. In demo mode, `admin` and `user` belong to the "Demo" organization.

## What Others See of a Person

Others see a person's name, username and profile picture, never the e-mail address: not in the people directory, the person picker, @-mentions, or the member and share lists of notes, folders, lists, task lists and groups. Only the person and the admins (Administration → Users) see it. Whoever shares by typing a full address gets that address back from `/users/lookup`; it was theirs to begin with. Alarm targets (webhooks) are private, admins do not see them either.

## Public Links to Notes

The owner of a note can share it read only with anyone who has the link (`/p/<token>`), without an account. Meant for quick sharing (a guide, a problem description); whoever needs it longer gets an account.

- **Switches:** `PUBLIC_LINKS=false` forbids them outright (the admin switch is locked), otherwise the admin switch in Server & Sharing (default on); off in demo mode. Independent of the sharing mode.
- **Always expiring:** 1 hour, 1 day, 3 days (default), 7 or 14 days; at most `PUBLIC_LINKS_MAX_DAYS` or the admin's limit (1–14 days). There is no link for good. Expired links are removed hourly.
- **One link per note:** a new link replaces the old one (its address stops working); "Revoke" ends it at once. The token (256 bits) is found by its SHA-256 hash; it is stored encrypted with `SECRETS_KEY` only so the owner can copy the link again (`public_links`).
- **Password (optional):** stored as bcrypt hash; the visitor gets a signed key valid 12 hours (at most until the link expires), voided by a new password or link; 10 wrong tries per link and address, then a pause.
- **What visitors see:** the note as it is now, polled every 4 seconds, read only, in a centred reading column, in the default theme following the visitor's system; a picker at the top right switches the theme family and between light and dark (kept in the visitor's browser). Hidden values show as dots without id (`{{secret:hidden}}`), `[[links]]` as plain text, no names, live cursors, conflict copies or deleted text. Images and recordings load through the link, only when a living bullet of this note shows them. Notes in the trash are not shown.
- **Not in search engines:** `X-Robots-Tag: noindex, nofollow, noarchive` on every answer and a `robots` meta tag on the page; `Referrer-Policy: no-referrer` keeps the token out of other sites' logs.
- API keys and MCP cannot create links.

## Decoupled Storage for Shared Notes and Folders

- **Shared Folders:** The folder exists once (`workspace_shared_folders`); each recipient has their own mount path (`workspace_folder_mounts.mount_path`). If a recipient moves the folder, only their mount path changes. The subfolder path within the folder (`documents.sub_folder_path`) applies to everyone.
- **Individual Notes:** Each recipient can place a shared note into a personal folder (`doc_user_folders`); the owner's note remains untouched.

## Sessions and Access

- Every login is a session (`sessions`) that can be terminated individually (Logout, Profile → Active Sessions). Role changes, deactivation, and "Terminate all sessions" invalidate all sessions (`token_version`); password changes invalidate all except the current one.
- Registration is by invite code only or open if enabled by an admin. The first account created is always an administrator.
- Known access control flaws: see [flaws.md](flaws.md).
