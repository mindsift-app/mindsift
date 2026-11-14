package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ErrLastAdmin protects the server from losing its last administrator.
var ErrLastAdmin = errors.New("Der letzte Server-Administrator kann nicht gelöscht werden. Bitte ernenne vorher ein anderes Konto zum Administrator.")

// Sections of a user's data, for restoring only part of a backup.
const (
	SectionNotes  = "notes"  // notes, folders, shared folders, pins, tag pages
	SectionTasks  = "tasks"  // task lists and tasks
	SectionLists  = "lists"  // shopping and other lists
	SectionInbox  = "inbox"  // thoughts in the inbox (and the discarded ones)
	SectionThemes = "themes" // own CSS themes
)

// AllSections in a fixed order.
var AllSections = []string{SectionNotes, SectionTasks, SectionLists, SectionInbox, SectionThemes}

// NormalizeSections keeps known sections; an empty selection means all of them.
func NormalizeSections(sections []string) map[string]bool {
	out := map[string]bool{}
	for _, sec := range sections {
		sec = strings.ToLower(strings.TrimSpace(sec))
		for _, known := range AllSections {
			if sec == known {
				out[sec] = true
			}
		}
	}
	if len(out) == 0 {
		for _, sec := range AllSections {
			out[sec] = true
		}
	}
	return out
}

// sqlUnlinkTasksOfUserNotes: tasks (of anyone) created from bullets of a user's notes lose the link;
// for each note a range over idx_thoughts_doc_block like sqlTasksOfNoteBlocks.
const sqlUnlinkTasksOfUserNotes = `UPDATE thoughts SET converted_type = '', converted_ref_id = ''
	FROM (SELECT id AS doc_id FROM documents WHERE user_id = ?) d
	WHERE thoughts.converted_type = 'document_block'
	  AND thoughts.converted_ref_id >= d.doc_id || ':' AND thoughts.converted_ref_id < d.doc_id || ';'`

// purgeStmts lists what deleting one section of a user's data takes. ?1 (or the single ?) is the user
// ID, ?2 a JSON array of ids that stay: what a restore has just imported (RestoreImport), so the
// previous data is only deleted once the new data is complete.
func purgeStmts(section string) []string {
	keep := `(SELECT value FROM json_each(?2))`
	ownDocs := `(SELECT id FROM documents WHERE user_id = ?1 AND id NOT IN ` + keep + `)`
	ownTaskLists := `(SELECT id FROM task_lists WHERE user_id = ?1 AND id NOT IN ` + keep + `)`
	ownLists := `(SELECT id FROM lists WHERE user_id = ?1 AND id NOT IN ` + keep + `)`
	ownFolders := `(SELECT id FROM workspace_shared_folders WHERE owner_id = ?1)`
	switch section {
	case SectionTasks:
		return []string{
			// Task lists: keep the tasks of others, drop shares and the lists
			`UPDATE thoughts SET task_list_id = '' WHERE task_list_id IN ` + ownTaskLists + ` AND user_id != ?1`,
			`DELETE FROM task_list_shares WHERE task_list_id IN ` + ownTaskLists,
			`DELETE FROM task_lists WHERE id IN ` + ownTaskLists,
			`DELETE FROM thoughts WHERE user_id = ?1 AND (status = 'kept' OR (status = 'converted' AND converted_type IN ('task', 'document_block'))) AND id NOT IN ` + keep,
		}
	case SectionInbox:
		return []string{`DELETE FROM thoughts WHERE user_id = ?1 AND status IN ('inbox', 'discarded') AND id NOT IN ` + keep}
	case SectionNotes:
		return []string{
			// Tasks of others linked to blocks of the user's notes lose the link (an import links none)
			sqlUnlinkTasksOfUserNotes,
			// Shared folders owned by the user (imported notes placed in one become plain notes, as if
			// the folder had been gone before the import)
			`UPDATE documents SET shared_folder_id = '', sub_folder_path = '' WHERE shared_folder_id IN ` + ownFolders,
			`DELETE FROM workspace_folder_mounts WHERE folder_id IN ` + ownFolders,
			`DELETE FROM workspace_folder_shares WHERE folder_id IN ` + ownFolders,
			`DELETE FROM workspace_folders WHERE shared_folder_id IN ` + ownFolders,
			`DELETE FROM workspace_shared_folders WHERE owner_id = ?1`,
			// Notes (history tables cascade with the document)
			`DELETE FROM blocks WHERE document_id IN ` + ownDocs,
			`DELETE FROM block_tags WHERE document_id IN ` + ownDocs,
			`DELETE FROM doc_user_folders WHERE doc_id IN ` + ownDocs,
			`DELETE FROM doc_team_shares WHERE doc_id IN ` + ownDocs,
			`DELETE FROM doc_shares WHERE doc_id IN ` + ownDocs,
			`DELETE FROM documents WHERE id IN ` + ownDocs,
			// The user's own placement of notes, folders, pins and tag pages (a restore creates its
			// folders again afterwards)
			`DELETE FROM doc_user_folders WHERE user_id = ?1 AND doc_id NOT IN ` + keep,
			`DELETE FROM doc_pins WHERE user_id = ?1 AND doc_id NOT IN ` + keep,
			`DELETE FROM workspace_folders WHERE user_id = ?1`,
			`DELETE FROM trashed_folders WHERE user_id = ?1`,
			`DELETE FROM tag_pages WHERE user_id = ?1`,
		}
	case SectionLists:
		return []string{
			`DELETE FROM list_shares WHERE list_id IN ` + ownLists,
			`DELETE FROM lists WHERE id IN ` + ownLists, // items cascade
		}
	case SectionThemes:
		return []string{`DELETE FROM user_themes WHERE user_id = ?1`} // a restore saves its themes afterwards
	}
	return nil
}

// PurgeUserSections deletes the chosen sections of the user's own data in one transaction. Content of
// others shared with the user stays; other people's tasks in the user's task lists become their own
// personal tasks, as when a single list is deleted.
func (s *Store) PurgeUserSections(userID string, sections map[string]bool) error {
	return s.purgeUserSections(userID, sections, nil)
}

// purgeUserSections is PurgeUserSections that leaves the notes, tasks, task lists and lists with the
// ids in keep alone.
func (s *Store) purgeUserSections(userID string, sections map[string]bool, keep []string) error {
	if keep == nil {
		keep = []string{}
	}
	keepJSON, err := json.Marshal(keep)
	if err != nil {
		return err
	}
	var queries []string
	for _, sec := range AllSections {
		if sections[sec] {
			queries = append(queries, purgeStmts(sec)...)
		}
	}
	if sections[SectionTasks] && sections[SectionInbox] {
		// Everything else of the thought history (turned into notes or list items) goes as well
		queries = append(queries, `DELETE FROM thoughts WHERE user_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))`)
	}
	stmts := make([]sqlStmt, len(queries))
	for i, q := range queries {
		if strings.Contains(q, "?2") {
			stmts[i] = stmt(q, userID, string(keepJSON))
		} else {
			stmts[i] = stmt(q, userID)
		}
	}
	if err := s.execInTx(stmts...); err != nil {
		return fmt.Errorf("delete data: %w", err)
	}
	s.PruneTaskAssignees()
	return nil
}

// PurgeUserData deletes everything the user owns – thoughts and tasks, notes (with blocks, history and
// shares), folders, shared folders, task lists and lists. The account, its settings, themes, API keys
// and group memberships stay.
func (s *Store) PurgeUserData(userID string) error {
	return s.PurgeUserSections(userID, map[string]bool{SectionNotes: true, SectionTasks: true, SectionLists: true, SectionInbox: true})
}

// IsLastAdmin reports whether userID is an administrator and no other one exists. When the database
// cannot say, the answer is yes, so nothing removes an administrator on a guess.
func (s *Store) IsLastAdmin(userID string) bool {
	var role string
	if err := s.db.QueryRow(`SELECT role FROM users WHERE id = ?`, userID).Scan(&role); dbFailed(err) {
		return true
	} else if err != nil || role != "admin" {
		return false
	}
	var others int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND id != ?`, userID).Scan(&others)
	return dbFailed(err) || others == 0
}

// DeleteOwnAccount removes the user with all data; refused for the last administrator.
func (s *Store) DeleteOwnAccount(userID string) error {
	if s.IsLastAdmin(userID) {
		return ErrLastAdmin
	}
	return s.DeleteUser(userID)
}
