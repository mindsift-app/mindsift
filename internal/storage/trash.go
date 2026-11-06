package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"path"
	"sort"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Deleted notes go to a trash first (documents.is_archived = 1). Trashed notes vanish from the tree,
// search, export, stats and for everyone they were shared with; their owner can still read them,
// restore them or delete them for good. archived_by records who trashed the note (the owner, or the
// owner of the shared folder it lived in), so that person sees it in their trash as well.

// ErrNotInTrash is returned when restoring or purging a note that is not in the user's trash.
var ErrNotInTrash = errors.New("Notiz nicht im Papierkorb")

// ErrDocInTrash refuses changes to a trashed note; it has to be restored first.
var ErrDocInTrash = errors.New("Die Notiz liegt im Papierkorb. Stelle sie zuerst wieder her.")

// Deleted personal folders go to the trash as a whole: trashed_folders keeps the folder and its
// subfolders, and its notes are trashed with trash_folder_id pointing there. The trash lists the folder
// as one entry; restoring it brings back the folder tree (empty subfolders too) and all of its notes.
// Folders inside shared folders keep the old way (their notes go to the trash one by one).

// TrashedDocument is one entry of the trash list: a note, or a deleted folder (Kind "folder", ID of the
// trashed folder, Title its name, FolderPath the folder it was in, NoteCount the notes it holds).
type TrashedDocument struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Icon       string `json:"icon"`
	FolderPath string `json:"folderPath"`
	DeletedAt  string `json:"deletedAt"`
	IsOwner    bool   `json:"isOwner"`
	NoteCount  int    `json:"noteCount,omitempty"`
}

func (s *Store) migrateFolderTrash() error {
	if err := s.addColumnIfMissing("documents", "trash_folder_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS trashed_folders (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			path TEXT NOT NULL,
			folders TEXT NOT NULL DEFAULT '[]',
			trashed_at TEXT NOT NULL
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_trashed_folders_user ON trashed_folders(user_id)`),
	)
}

const trashScope = `is_archived = 1 AND (user_id = ? OR archived_by = ?)`

func trashStmts(userID, docID string) []sqlStmt {
	return []sqlStmt{
		// Pins stay: the lists hide trashed notes anyway, and a restored note comes back pinned (deleting it
		// for good removes them)
		stmt(`UPDATE documents SET is_archived = 1, archived_at = ?, archived_by = ? WHERE id = ?`, domain.NowISO(), userID, docID),
	}
}

func (s *Store) trashDocument(userID, docID string) error {
	return s.execInTx(trashStmts(userID, docID)...)
}

// GetTrash lists the notes and folders in the user's trash, newest deletion first. Notes of a trashed
// folder are part of the folder's entry.
func (s *Store) GetTrash(userID string) ([]TrashedDocument, error) {
	rows, err := s.db.Query(`SELECT d.id, d.title, d.icon, d.folder_path, d.shared_folder_id, d.sub_folder_path, d.archived_at, d.user_id,
		       COALESCE(wsf.name, '')
		FROM documents d LEFT JOIN workspace_shared_folders wsf ON wsf.id = d.shared_folder_id
		WHERE d.`+trashScope+`
		  AND NOT EXISTS (SELECT 1 FROM trashed_folders tf WHERE tf.id = d.trash_folder_id)
		ORDER BY d.archived_at DESC`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrashedDocument{}
	for rows.Next() {
		var t TrashedDocument
		var sharedFolderID, subPath, ownerID, folderName string
		if err := rows.Scan(&t.ID, &t.Title, &t.Icon, &t.FolderPath, &sharedFolderID, &subPath, &t.DeletedAt, &ownerID, &folderName); err != nil {
			continue
		}
		if sharedFolderID != "" {
			t.FolderPath = folderName
			if subPath != "" {
				t.FolderPath += "/" + subPath
			}
		}
		t.Kind = "note"
		t.IsOwner = ownerID == userID
		out = append(out, t)
	}
	_ = rows.Close()

	frows, err := s.db.Query(`SELECT tf.id, tf.path, tf.trashed_at,
		       (SELECT COUNT(*) FROM documents d WHERE d.trash_folder_id = tf.id AND d.is_archived = 1)
		FROM trashed_folders tf WHERE tf.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer frows.Close()
	for frows.Next() {
		var t TrashedDocument
		var p string
		if frows.Scan(&t.ID, &p, &t.DeletedAt, &t.NoteCount) != nil {
			continue
		}
		t.Kind = "folder"
		t.Title = path.Base(p)
		if parent := path.Dir(p); parent != "." {
			t.FolderPath = parent
		}
		t.IsOwner = true
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].DeletedAt > out[j].DeletedAt })
	return out, nil
}

// trashFolderStmts records a deleted personal folder (with its subfolders) in the trash and ties its
// notes to it; the notes themselves are trashed by the caller.
func trashFolderStmts(userID, folderPath string, subfolders, docIDs []string) (string, []sqlStmt) {
	id := domain.NewID("tfld")
	paths, _ := json.Marshal(subfolders)
	out := []sqlStmt{stmt(`INSERT INTO trashed_folders (id, user_id, path, folders, trashed_at) VALUES (?, ?, ?, ?, ?)`,
		id, userID, folderPath, string(paths), domain.NowISO())}
	for _, docID := range docIDs {
		out = append(out, stmt(`UPDATE documents SET trash_folder_id = ? WHERE id = ?`, id, docID))
	}
	return id, out
}

type trashedFolder struct {
	path    string
	folders []string
}

func (s *Store) trashedFolder(userID, id string) (*trashedFolder, error) {
	var f trashedFolder
	var raw string
	err := s.db.QueryRow(`SELECT path, folders FROM trashed_folders WHERE id = ? AND user_id = ?`, id, userID).Scan(&f.path, &raw)
	if err == sql.ErrNoRows {
		return nil, ErrNotInTrash
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(raw), &f.folders)
	return &f, nil
}

func (s *Store) trashedFolderDocs(id string) ([]string, error) {
	rows, err := s.db.Query(`SELECT id FROM documents WHERE trash_folder_id = ? AND is_archived = 1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var docID string
		if rows.Scan(&docID) == nil {
			ids = append(ids, docID)
		}
	}
	return ids, nil
}

// RestoreFolder brings a trashed folder back: the folder and all of its subfolders (empty ones too),
// then its notes. Returns the restored note IDs.
func (s *Store) RestoreFolder(userID, id string) ([]string, error) {
	f, err := s.trashedFolder(userID, id)
	if err != nil {
		return nil, err
	}
	for _, p := range append([]string{f.path}, f.folders...) {
		if _, err := s.CreateFolder(userID, p); err != nil {
			return nil, err
		}
	}
	docIDs, err := s.trashedFolderDocs(id)
	if err != nil {
		return nil, err
	}
	for _, docID := range docIDs {
		if err := s.RestoreDocument(userID, docID); err != nil {
			return nil, err
		}
	}
	_, err = s.db.Exec(`DELETE FROM trashed_folders WHERE id = ?`, id)
	return docIDs, err
}

// PurgeFolder deletes a trashed folder and its notes for good. Returns the deleted note IDs.
func (s *Store) PurgeFolder(userID, id string) ([]string, error) {
	if _, err := s.trashedFolder(userID, id); err != nil {
		return nil, err
	}
	docIDs, err := s.trashedFolderDocs(id)
	if err != nil {
		return nil, err
	}
	for _, docID := range docIDs {
		if err := s.hardDeleteDocument(docID); err != nil {
			return nil, err
		}
	}
	_, err = s.db.Exec(`DELETE FROM trashed_folders WHERE id = ?`, id)
	return docIDs, err
}

func (s *Store) trashedDocOwner(userID, docID string) (string, error) {
	var owner string
	err := s.db.QueryRow(`SELECT user_id FROM documents WHERE id = ? AND `+trashScope, docID, userID, userID).Scan(&owner)
	if err == sql.ErrNoRows {
		return "", ErrNotInTrash
	}
	return owner, err
}

// RestoreDocument takes a note out of the trash. Its folder is created again if it was deleted in the
// meantime; a shared folder that no longer exists puts the note back into the owner's top level.
func (s *Store) RestoreDocument(userID, docID string) error {
	owner, err := s.trashedDocOwner(userID, docID)
	if err != nil {
		return err
	}
	var folderPath, sharedFolderID string
	_ = s.db.QueryRow(`SELECT folder_path, shared_folder_id FROM documents WHERE id = ?`, docID).Scan(&folderPath, &sharedFolderID)
	if sharedFolderID != "" {
		var exists int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM workspace_shared_folders WHERE id = ?`, sharedFolderID).Scan(&exists)
		if exists == 0 {
			if _, err := s.db.Exec(`UPDATE documents SET shared_folder_id = '', sub_folder_path = '', folder_path = '' WHERE id = ?`, docID); err != nil {
				return err
			}
		}
	} else if folderPath != "" {
		if _, err := s.CreateFolder(owner, folderPath); err != nil {
			return err
		}
	}
	_, err = s.db.Exec(`UPDATE documents SET is_archived = 0, archived_at = '', archived_by = '', trash_folder_id = '' WHERE id = ?`, docID)
	return err
}

// PurgeDocument deletes a trashed note for good.
func (s *Store) PurgeDocument(userID, docID string) error {
	if _, err := s.trashedDocOwner(userID, docID); err != nil {
		return err
	}
	return s.hardDeleteDocument(docID)
}

// EmptyTrash deletes every note and folder in the user's trash for good and returns the note IDs.
func (s *Store) EmptyTrash(userID string) ([]string, error) {
	items, err := s.GetTrash(userID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(items))
	for _, t := range items {
		if t.Kind == "folder" {
			docIDs, err := s.PurgeFolder(userID, t.ID)
			ids = append(ids, docIDs...)
			if err != nil {
				return ids, err
			}
			continue
		}
		if err := s.hardDeleteDocument(t.ID); err != nil {
			return ids, err
		}
		ids = append(ids, t.ID)
	}
	return ids, nil
}

func (s *Store) hardDeleteDocument(docID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		// Tasks created from blocks of this note keep existing without the link
		`UPDATE thoughts SET converted_type = '', converted_ref_id = '' WHERE converted_type = 'document_block'
		  AND substr(converted_ref_id, 1, instr(converted_ref_id, ':') - 1) = ?`,
		// Its hidden values go along, unless a bullet of another note still holds them (moved there)
		`DELETE FROM note_secrets WHERE document_id = ? AND NOT EXISTS (SELECT 1 FROM blocks b
		  WHERE b.document_id != note_secrets.document_id AND b.deleted = 0 AND instr(b.content, '{{secret:' || note_secrets.id || '}}') > 0)`,
		`DELETE FROM blocks WHERE document_id = ?`,
		`DELETE FROM block_tags WHERE document_id = ?`,
		`DELETE FROM doc_pins WHERE doc_id = ?`,
		`DELETE FROM doc_shares WHERE doc_id = ?`,
		`DELETE FROM doc_team_shares WHERE doc_id = ?`,
		`DELETE FROM doc_user_folders WHERE doc_id = ?`,
		`DELETE FROM documents WHERE id = ?`,
	} {
		if _, err := tx.Exec(q, docID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
