package storage

import (
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

// purgeStmts lists what deleting one section of a user's data takes. Each statement gets the user ID
// as often as it has placeholders.
func purgeStmts(section string) []struct {
	q    string
	args int
} {
	ownDocs := `(SELECT id FROM documents WHERE user_id = ?)`
	ownTaskLists := `(SELECT id FROM task_lists WHERE user_id = ?)`
	ownFolders := `(SELECT id FROM workspace_shared_folders WHERE owner_id = ?)`
	type st = struct {
		q    string
		args int
	}
	switch section {
	case SectionTasks:
		return []st{
			// Task lists: keep the tasks of others, drop shares and the lists
			{`UPDATE thoughts SET task_list_id = '' WHERE task_list_id IN ` + ownTaskLists + ` AND user_id != ?`, 2},
			{`DELETE FROM task_list_shares WHERE task_list_id IN ` + ownTaskLists, 1},
			{`DELETE FROM task_lists WHERE user_id = ?`, 1},
			{`DELETE FROM thoughts WHERE user_id = ? AND (status = 'kept' OR (status = 'converted' AND converted_type IN ('task', 'document_block')))`, 1},
		}
	case SectionInbox:
		return []st{{`DELETE FROM thoughts WHERE user_id = ? AND status IN ('inbox', 'discarded')`, 1}}
	case SectionNotes:
		return []st{
			// Tasks of others linked to blocks of the user's notes lose the link
			{`UPDATE thoughts SET converted_type = '', converted_ref_id = '' WHERE converted_type = 'document_block'
			  AND substr(converted_ref_id, 1, instr(converted_ref_id, ':') - 1) IN ` + ownDocs, 1},
			// Shared folders owned by the user
			{`UPDATE documents SET shared_folder_id = '', sub_folder_path = '' WHERE shared_folder_id IN ` + ownFolders, 1},
			{`DELETE FROM workspace_folder_mounts WHERE folder_id IN ` + ownFolders, 1},
			{`DELETE FROM workspace_folder_shares WHERE folder_id IN ` + ownFolders, 1},
			{`DELETE FROM workspace_folders WHERE shared_folder_id IN ` + ownFolders, 1},
			{`DELETE FROM workspace_shared_folders WHERE owner_id = ?`, 1},
			// Notes (history tables cascade with the document)
			{`DELETE FROM blocks WHERE document_id IN ` + ownDocs, 1},
			{`DELETE FROM block_tags WHERE document_id IN ` + ownDocs, 1},
			{`DELETE FROM doc_user_folders WHERE doc_id IN ` + ownDocs, 1},
			{`DELETE FROM doc_team_shares WHERE doc_id IN ` + ownDocs, 1},
			{`DELETE FROM doc_shares WHERE doc_id IN ` + ownDocs, 1},
			{`DELETE FROM documents WHERE user_id = ?`, 1},
			// The user's own placement of notes, folders, pins and tag pages
			{`DELETE FROM doc_user_folders WHERE user_id = ?`, 1},
			{`DELETE FROM doc_pins WHERE user_id = ?`, 1},
			{`DELETE FROM workspace_folders WHERE user_id = ?`, 1},
			{`DELETE FROM trashed_folders WHERE user_id = ?`, 1},
			{`DELETE FROM tag_pages WHERE user_id = ?`, 1},
		}
	case SectionLists:
		return []st{
			{`DELETE FROM list_shares WHERE list_id IN (SELECT id FROM lists WHERE user_id = ?)`, 1},
			{`DELETE FROM lists WHERE user_id = ?`, 1}, // items cascade
		}
	case SectionThemes:
		return []st{{`DELETE FROM user_themes WHERE user_id = ?`, 1}}
	}
	return nil
}

// PurgeUserSections deletes the chosen sections of the user's own data in one transaction. Content of
// others shared with the user stays; other people's tasks in the user's task lists become their own
// personal tasks, as when a single list is deleted.
func (s *Store) PurgeUserSections(userID string, sections map[string]bool) error {
	var stmts []sqlStmt
	for _, sec := range AllSections {
		if !sections[sec] {
			continue
		}
		for _, st := range purgeStmts(sec) {
			args := make([]any, st.args)
			for i := range args {
				args[i] = userID
			}
			stmts = append(stmts, stmt(st.q, args...))
		}
	}
	if sections[SectionTasks] && sections[SectionInbox] {
		// Everything else of the thought history (turned into notes or list items) goes as well
		stmts = append(stmts, stmt(`DELETE FROM thoughts WHERE user_id = ?`, userID))
	}
	if err := s.execInTx(stmts...); err != nil {
		return fmt.Errorf("Daten löschen: %w", err)
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
