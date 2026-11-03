# Sharing & Permissions

## Roles

| Level | Values | Meaning |
|---|---|---|
| Server | `admin`, `member` | Admins manage users, organizations, invitations, and settings (`/admin/*`). |
| Organization | Member | Determines who can see whom (see below). Assigned only by server admins. |
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

## Visibility: Organizations and Modes (`system_settings.sharing_mode`)

Two concepts, do not confuse:

| Concept | Managed by | Purpose |
|---|---|---|
| **Organization** | Server admin only (`/admin/organizations`) | Determines who is allowed to **see** whom. Each user belongs to at most one (`users.organization_id`). |
| **Group** (code: `teams`) | Users themselves | Shortcut for sharing ("share with my flatmates"). Never expands visibility. |

| Mode | Who sees whom |
|---|---|
| `private` | Nobody. User search, sharing, and groups are disabled (server responds with error, UI hides them). |
| `organizations` (default) | Only members of the same organization. Users not belonging to any organization see no one. |
| `open` | Everyone. |

**One rule for everything:** `Store.CanSee(a, b)` and `Store.CanShareWith(owner, typ, ziel)` in [visibility.go](../internal/storage/visibility.go). These govern the user directory (`/users/directory`, `/collaborators`), every share (note, folder, task list, list), and adding members to groups. Server admins follow the same rule when sharing; they manage all accounts via `/admin/*`.

- Only members of a group are allowed to share with that group. A group belongs to the organization of its creator (`teams.org_id`); members can only come from there.
- Unknown and non-visible persons return the same message ("User or group not found") to prevent user enumeration by email.
- **Sharing can only be done by the owner.** Editors cannot re-share and cannot remove others' shares; however, anyone can remove their own share (leave a shared note or folder).

**Permissions follow visibility.** `Store.PruneSharing` removes everything that would no longer be permitted under the current mode: group memberships outside the group's organization, shares to users whom the owner can no longer see, shares to groups that the owner is no longer a member of; followed by empty groups, and task assignments via `PruneTaskAssignees`. Groups left without an admin are assigned one. It runs after:

- Changing or removing a user's organization, deleting an organization
- Changing the mode by an admin (beforehand, `GET /admin/settings/sharing-impact?mode=…` provides a dry-run preview of what would be pruned)
- Leaving or deleting a group, deleting an account

During setup in `organizations` mode, an organization named after the instance is created and the initial admin is assigned to it. Invitations and "Create User" can specify an organization. In demo mode, `admin` and `user` belong to the "Demo" organization.

## Decoupled Storage for Shared Notes and Folders

- **Shared Folders:** The folder exists once (`workspace_shared_folders`); each recipient has their own mount path (`workspace_folder_mounts.mount_path`). If a recipient moves the folder, only their mount path changes. The subfolder path within the folder (`documents.sub_folder_path`) applies to everyone.
- **Individual Notes:** Each recipient can place a shared note into a personal folder (`doc_user_folders`); the owner's note remains untouched.

## Sessions and Access

- Every login is a session (`sessions`) that can be terminated individually (Logout, Profile → Active Sessions). Role changes, deactivation, and "Terminate all sessions" invalidate all sessions (`token_version`); password changes invalidate all except the current one.
- Registration is by invite code only or open if enabled by an admin. The first account created is always an administrator.
- Known access control flaws: see [flaws.md](flaws.md).
