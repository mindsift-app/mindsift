package storage

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func (s *Store) GetFolders(userID string) ([]string, error) {
	folderSet := make(map[string]bool)

	// 1. Collect from resolved documents for this user
	docs, err := s.GetDocuments(userID)
	if err == nil {
		for _, doc := range docs {
			if doc.FolderPath != "" {
				addFolderSegments(doc.FolderPath, folderSet)
			}
		}
	}

	// 2. Add mounted shared folders (so even empty shared folders appear in the tree)
	mounts, _, err := s.getUserFolderMounts(userID)
	if err == nil {
		for sfID, mPath := range mounts {
			if mPath != "" {
				addFolderSegments(mPath, folderSet)

				// 2b. Add all subfolders created in this shared folder
				sRows, err := s.db.Query(`SELECT sub_path FROM workspace_folders WHERE shared_folder_id = ?`, sfID)
				if err == nil {
					for sRows.Next() {
						var sp string
						if err := sRows.Scan(&sp); err == nil && sp != "" {
							fullP := mPath + "/" + sp
							addFolderSegments(fullP, folderSet)
						}
					}
					_ = sRows.Close()
				}
			}
		}
	}

	// 3. Add personal empty folders created by this user
	pRows, err := s.db.Query(`SELECT path FROM workspace_folders WHERE user_id = ? AND (shared_folder_id = '' OR shared_folder_id IS NULL)`, userID)
	if err == nil {
		for pRows.Next() {
			var p string
			if err := pRows.Scan(&p); err == nil && p != "" {
				addFolderSegments(p, folderSet)
			}
		}
		_ = pRows.Close()
	}

	result := make([]string, 0, len(folderSet))
	for f := range folderSet {
		result = append(result, f)
	}
	sort.Strings(result)
	return result, nil
}

func addFolderSegments(fp string, set map[string]bool) {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(fp)))
	if clean == "." || clean == "" {
		return
	}
	parts := strings.Split(clean, "/")
	var cur string
	for _, p := range parts {
		if p != "" && p != "." {
			if cur == "" {
				cur = p
			} else {
				cur = cur + "/" + p
			}
			set[cur] = true
		}
	}
}

func (s *Store) CreateFolder(userID, folderPath string) (string, error) {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(folderPath)))
	if clean == "" || clean == "." || strings.HasPrefix(clean, "/") || strings.Contains(clean, "..") {
		return "", fmt.Errorf("ungültiger Ordnerpfad")
	}

	mounts, _, err := s.getUserFolderMounts(userID)
	var sfID, subPath string
	if err == nil {
		sfID, subPath, _ = matchMountPath(clean, mounts)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	id := domain.NewID("wfld")

	if sfID != "" {
		var existsID string
		err := s.db.QueryRow(`SELECT id FROM workspace_folders WHERE shared_folder_id = ? AND sub_path = ?`, sfID, subPath).Scan(&existsID)
		if err == sql.ErrNoRows {
			if _, err := s.db.Exec(`INSERT INTO workspace_folders (id, user_id, shared_folder_id, path, sub_path, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
				id, userID, sfID, clean, subPath, now); err != nil {
				return "", err
			}
		}
	} else {
		var existsID string
		err := s.db.QueryRow(`SELECT id FROM workspace_folders WHERE user_id = ? AND path = ? AND (shared_folder_id = '' OR shared_folder_id IS NULL)`, userID, clean).Scan(&existsID)
		if err == sql.ErrNoRows {
			if _, err := s.db.Exec(`INSERT INTO workspace_folders (id, user_id, shared_folder_id, path, sub_path, created_at) VALUES (?, ?, '', ?, '', ?)`,
				id, userID, clean, now); err != nil {
				return "", err
			}
		}
	}

	return clean, nil
}

func (s *Store) DeleteFolder(userID, folderPath string) ([]string, error) {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(folderPath)))
	if clean == "" || clean == "." || strings.HasPrefix(clean, "/") || strings.Contains(clean, "..") {
		return nil, fmt.Errorf("ungültiger Ordnerpfad")
	}

	var deletedDocIDs []string
	var writes []sqlStmt
	seenDocID := make(map[string]bool)
	inSharedFolder := false

	mounts, _, err := s.getUserFolderMounts(userID)
	if err == nil {
		sfID, subPath, isMatch := matchMountPath(clean, mounts)
		if isMatch && sfID != "" {
			inSharedFolder = true
			if subPath == "" {
				// Root of a shared folder
				shFolder, sfErr := s.GetSharedFolderByID(userID, sfID)
				if sfErr == nil && !shFolder.IsOwner {
					// Collaborator removing mount/share
					return []string{}, s.DeleteSharedFolder(userID, sfID)
				}
				rows, qErr := s.db.Query(`SELECT id FROM documents WHERE shared_folder_id = ?`, sfID)
				if qErr == nil {
					for rows.Next() {
						var id string
						if err := rows.Scan(&id); err == nil && !seenDocID[id] {
							seenDocID[id] = true
							deletedDocIDs = append(deletedDocIDs, id)
						}
					}
					_ = rows.Close()
				}
				writes = append(writes, stmt(`DELETE FROM workspace_folders WHERE shared_folder_id = ?`, sfID))
			} else {
				// Subfolder inside a shared folder
				rows, qErr := s.db.Query(
					`SELECT id FROM documents WHERE shared_folder_id = ? AND (sub_folder_path = ? OR sub_folder_path LIKE ?)`,
					sfID, subPath, subPath+"/%",
				)
				if qErr == nil {
					for rows.Next() {
						var id string
						if err := rows.Scan(&id); err == nil && !seenDocID[id] {
							seenDocID[id] = true
							deletedDocIDs = append(deletedDocIDs, id)
						}
					}
					_ = rows.Close()
				}
				writes = append(writes, stmt(`DELETE FROM workspace_folders WHERE shared_folder_id = ? AND (sub_path = ? OR sub_path LIKE ?)`,
					sfID, subPath, subPath+"/%"))
			}
		}
	}

	// Find all personal documents owned by this user in this folder and subfolders
	rows, err := s.db.Query(
		`SELECT id FROM documents 
		 WHERE user_id = ? AND (shared_folder_id = '' OR shared_folder_id IS NULL) AND (folder_path = ? OR folder_path LIKE ?)`,
		userID, clean, clean+"/%",
	)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil && !seenDocID[id] {
			seenDocID[id] = true
			deletedDocIDs = append(deletedDocIDs, id)
		}
	}
	_ = rows.Close()

	// The notes of the folder go to the trash; restoring one creates its folder again
	for _, id := range deletedDocIDs {
		writes = append(writes, trashStmts(userID, id)...)
	}
	// A personal folder goes to the trash as a whole (with its subfolders), so it can come back as it was
	if !inSharedFolder {
		subfolders := []string{}
		if frows, err := s.db.Query(`SELECT path FROM workspace_folders WHERE user_id = ? AND (shared_folder_id = '' OR shared_folder_id IS NULL)
			AND path LIKE ?`, userID, clean+"/%"); err == nil {
			for frows.Next() {
				var p string
				if frows.Scan(&p) == nil {
					subfolders = append(subfolders, p)
				}
			}
			_ = frows.Close()
		}
		_, folderWrites := trashFolderStmts(userID, clean, subfolders, deletedDocIDs)
		writes = append(writes, folderWrites...)
	}

	// Also clear any personal folder placements for shared notes in this folder
	writes = append(writes,
		stmt(`UPDATE doc_user_folders SET folder_path = '' WHERE user_id = ? AND (folder_path = ? OR folder_path LIKE ?)`, userID, clean, clean+"/%"),
		stmt(`DELETE FROM workspace_folders WHERE user_id = ? AND (path = ? OR path LIKE ?)`, userID, clean, clean+"/%"))

	// All of it or nothing: no folder disappears while its notes stay behind, or the other way round
	if err := s.execInTx(writes...); err != nil {
		return nil, err
	}
	return deletedDocIDs, nil
}

func (s *Store) MoveDocument(userID, docID, targetFolderPath string) (*domain.Document, error) {
	doc, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		return nil, err
	}
	if doc.IsArchived {
		return nil, ErrDocInTrash
	}

	cleanTarget := filepath.ToSlash(filepath.Clean(strings.TrimSpace(targetFolderPath)))
	if cleanTarget == "." {
		cleanTarget = ""
	}

	mounts, _, err := s.getUserFolderMounts(userID)
	if err != nil {
		return nil, err
	}

	now := domain.NowISO()

	// Check if target folder falls within any mounted shared folder
	targetFolderID, subPath, isTargetShared := matchMountPath(cleanTarget, mounts)

	if isTargetShared {
		// Moving into / within a shared folder
		shFolder, err := s.GetSharedFolderByID(userID, targetFolderID)
		if err != nil {
			return nil, err
		}
		if !shFolder.IsOwner {
			return nil, fmt.Errorf("nur der Eigentümer dieses geteilten Ordners kann Dateien dorthin verschieben")
		}

		// Update document to belong to targetSharedFolderID
		_, err = s.db.Exec(`UPDATE documents SET shared_folder_id = ?, sub_folder_path = ?, updated_at = ? WHERE id = ?`,
			targetFolderID, subPath, now, docID)
		if err != nil {
			return nil, err
		}

		// Remove personal override if any
		if _, err := s.db.Exec(`DELETE FROM doc_user_folders WHERE user_id = ? AND doc_id = ?`, userID, docID); err != nil {
			return nil, err
		}

		doc.SharedFolderID = targetFolderID
		doc.SubFolderPath = subPath
		doc.IsSharedFolder = true
		doc.FolderPath = cleanTarget
		return doc, nil
	}

	// Target is NOT inside a shared folder (personal / standalone)
	if doc.SharedFolderID != "" {
		// Moving OUT of a shared folder into a personal folder
		if !doc.IsOwner {
			return nil, fmt.Errorf("keine Berechtigung, die Notiz aus dem geteilten Ordner zu verschieben")
		}
		_, err = s.db.Exec(`UPDATE documents SET shared_folder_id = '', sub_folder_path = '', folder_path = ?, updated_at = ? WHERE id = ?`,
			cleanTarget, now, docID)
		if err != nil {
			return nil, err
		}
		doc.SharedFolderID = ""
		doc.SubFolderPath = ""
		doc.IsSharedFolder = false
		doc.FolderPath = cleanTarget
		return doc, nil
	}

	// Standalone note
	if doc.IsOwner {
		// Owner moves their own document -> updates documents.folder_path
		_, err = s.db.Exec(`UPDATE documents SET folder_path = ?, updated_at = ? WHERE id = ?`, cleanTarget, now, docID)
		if err != nil {
			return nil, err
		}
		doc.FolderPath = cleanTarget
		return doc, nil
	}

	// Recipient moves an individually shared note -> updates doc_user_folders ONLY!
	_, err = s.db.Exec(`
		INSERT INTO doc_user_folders (user_id, doc_id, folder_path, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id, doc_id) DO UPDATE SET folder_path = excluded.folder_path, updated_at = excluded.updated_at
	`, userID, docID, cleanTarget, now, now)
	if err != nil {
		return nil, err
	}

	doc.FolderPath = cleanTarget
	return doc, nil
}

// MoveFolder moves a folder (and all its documents/subfolders) to a new target parent path.
func (s *Store) MoveFolder(userID, sourcePath, targetParentPath string) (string, []string, error) {
	cleanSource := filepath.ToSlash(filepath.Clean(strings.TrimSpace(sourcePath)))
	if cleanSource == "" || cleanSource == "." || strings.HasPrefix(cleanSource, "/") || strings.Contains(cleanSource, "..") {
		return "", nil, fmt.Errorf("ungültiger Quell-Ordnerpfad")
	}
	cleanTarget := filepath.ToSlash(filepath.Clean(strings.TrimSpace(targetParentPath)))
	if cleanTarget == "." {
		cleanTarget = ""
	}
	if cleanTarget != "" && (cleanTarget == cleanSource || strings.HasPrefix(cleanTarget, cleanSource+"/")) {
		return "", nil, fmt.Errorf("ein Ordner kann nicht in sich selbst verschoben werden")
	}

	folderName := filepath.Base(cleanSource)
	var newFolderPath string
	if cleanTarget == "" {
		newFolderPath = folderName
	} else {
		newFolderPath = cleanTarget + "/" + folderName
	}

	if newFolderPath == cleanSource {
		return cleanSource, []string{}, nil
	}

	// 1. Check if sourcePath is the root mount of a shared folder
	mounts, _, err := s.getUserFolderMounts(userID)
	if err == nil {
		for sfID, mPath := range mounts {
			if mPath == cleanSource {
				err := s.UpdateFolderMount(userID, sfID, newFolderPath)
				if err != nil {
					return "", nil, err
				}
				return newFolderPath, []string{}, nil
			}
		}
	}

	// 2. Move all affected documents
	docs, err := s.GetDocuments(userID)
	if err != nil {
		return "", nil, err
	}

	var movedDocIDs []string
	for _, doc := range docs {
		if doc.FolderPath == cleanSource || strings.HasPrefix(doc.FolderPath, cleanSource+"/") {
			var nextDocFolder string
			if doc.FolderPath == cleanSource {
				nextDocFolder = newFolderPath
			} else {
				suffix := strings.TrimPrefix(doc.FolderPath, cleanSource)
				nextDocFolder = newFolderPath + suffix
			}
			if _, moveErr := s.MoveDocument(userID, doc.ID, nextDocFolder); moveErr != nil {
				return "", movedDocIDs, fmt.Errorf("Notiz %q verschieben: %w", doc.Title, moveErr)
			}
			movedDocIDs = append(movedDocIDs, doc.ID)
		}
	}

	// 3. Re-map workspace_folders entries
	targetSFID, targetSub, isTargetSF := matchMountPath(newFolderPath, mounts)
	sourceSFID, sourceSub, isSourceSF := matchMountPath(cleanSource, mounts)

	var remap []sqlStmt
	wfRows, qErr := s.db.Query(`SELECT id, user_id, shared_folder_id, path, sub_path FROM workspace_folders`)
	if qErr != nil {
		return "", movedDocIDs, qErr
	}
	{
		type wfRecord struct {
			id, uid, sfID, path, subPath string
		}
		var records []wfRecord
		for wfRows.Next() {
			var r wfRecord
			if err := wfRows.Scan(&r.id, &r.uid, &r.sfID, &r.path, &r.subPath); err == nil {
				records = append(records, r)
			}
		}
		_ = wfRows.Close()

		for _, r := range records {
			if isSourceSF && r.sfID == sourceSFID {
				matches := false
				var suffix string
				if sourceSub == "" {
					matches = true
					suffix = "/" + r.subPath
				} else if r.subPath == sourceSub {
					matches = true
					suffix = ""
				} else if strings.HasPrefix(r.subPath, sourceSub+"/") {
					matches = true
					suffix = strings.TrimPrefix(r.subPath, sourceSub)
				}
				if matches {
					var newSub string
					if targetSub == "" {
						newSub = strings.TrimPrefix(folderName+suffix, "/")
					} else {
						newSub = targetSub + "/" + folderName + suffix
					}
					if isTargetSF {
						remap = append(remap, stmt(`UPDATE workspace_folders SET shared_folder_id = ?, sub_path = ? WHERE id = ?`, targetSFID, newSub, r.id))
					} else {
						newP := newFolderPath + suffix
						remap = append(remap, stmt(`UPDATE workspace_folders SET shared_folder_id = '', sub_path = '', path = ? WHERE id = ?`, newP, r.id))
					}
				}
			} else if r.path == cleanSource || strings.HasPrefix(r.path, cleanSource+"/") {
				suffix := strings.TrimPrefix(r.path, cleanSource)
				newP := newFolderPath + suffix
				if isTargetSF {
					var newSub string
					if targetSub == "" {
						newSub = strings.TrimPrefix(folderName+suffix, "/")
					} else {
						newSub = targetSub + "/" + folderName + suffix
					}
					remap = append(remap, stmt(`UPDATE workspace_folders SET shared_folder_id = ?, sub_path = ?, path = ? WHERE id = ?`, targetSFID, newSub, newP, r.id))
				} else {
					remap = append(remap, stmt(`UPDATE workspace_folders SET path = ? WHERE id = ?`, newP, r.id))
				}
			}
		}
	}

	if err := s.execInTx(remap...); err != nil {
		return "", movedDocIDs, err
	}
	if _, err := s.CreateFolder(userID, newFolderPath); err != nil {
		return "", movedDocIDs, err
	}
	return newFolderPath, movedDocIDs, nil
}

// syncSharedFolderContents ensures all documents and subfolders under cleanMount owned by ownerID are linked to folderID.
func (s *Store) syncSharedFolderContents(ownerID, folderID, cleanMount string) error {
	if ownerID == "" || folderID == "" || cleanMount == "" {
		return nil
	}
	var links []sqlStmt

	// 1. Link all documents owned by ownerID in cleanMount to this shared folder
	rows, err := s.db.Query(`SELECT id, folder_path FROM documents WHERE user_id = ? AND is_archived = 0 AND (folder_path = ? OR folder_path LIKE ?)`,
		ownerID, cleanMount, cleanMount+"/%")
	if err == nil {
		type docEntry struct{ id, fp string }
		var entries []docEntry
		for rows.Next() {
			var de docEntry
			if err := rows.Scan(&de.id, &de.fp); err == nil {
				entries = append(entries, de)
			}
		}
		_ = rows.Close()

		for _, de := range entries {
			var subPath string
			if de.fp == cleanMount {
				subPath = ""
			} else if strings.HasPrefix(de.fp, cleanMount+"/") {
				subPath = strings.TrimPrefix(de.fp, cleanMount+"/")
			}
			links = append(links, stmt(`UPDATE documents SET shared_folder_id = ?, sub_folder_path = ? WHERE id = ?`,
				folderID, subPath, de.id))
		}
	}

	// 2. Link any workspace_folders created by ownerID in cleanMount
	fRows, err := s.db.Query(`SELECT id, path FROM workspace_folders WHERE user_id = ? AND (path = ? OR path LIKE ?)`,
		ownerID, cleanMount, cleanMount+"/%")
	if err == nil {
		type wfEntry struct{ id, path string }
		var wfEntries []wfEntry
		for fRows.Next() {
			var wfe wfEntry
			if err := fRows.Scan(&wfe.id, &wfe.path); err == nil {
				wfEntries = append(wfEntries, wfe)
			}
		}
		_ = fRows.Close()

		for _, wfe := range wfEntries {
			subP := ""
			if strings.HasPrefix(wfe.path, cleanMount+"/") {
				subP = strings.TrimPrefix(wfe.path, cleanMount+"/")
			}
			links = append(links, stmt(`UPDATE workspace_folders SET shared_folder_id = ?, sub_path = ? WHERE id = ?`,
				folderID, subP, wfe.id))
		}
	}
	return s.execInTx(links...)
}

func (s *Store) CreateSharedFolder(userID, folderName, initialMountPath string) (*domain.SharedFolder, error) {
	cleanName := strings.TrimSpace(folderName)
	if cleanName == "" {
		return nil, fmt.Errorf("ordnername darf nicht leer sein")
	}
	cleanMount := filepath.ToSlash(filepath.Clean(strings.TrimSpace(initialMountPath)))
	if cleanMount == "." || cleanMount == "" {
		cleanMount = cleanName
	}

	// Check if already shared by this user at this mount path
	var existingID string
	err := s.db.QueryRow(`
		SELECT f.id FROM workspace_shared_folders f
		JOIN workspace_folder_mounts m ON m.folder_id = f.id AND m.user_id = ?
		WHERE f.owner_id = ? AND (m.mount_path = ? OR f.name = ?)
	`, userID, userID, cleanMount, cleanName).Scan(&existingID)
	if err == nil && existingID != "" {
		if err := s.syncSharedFolderContents(userID, existingID, cleanMount); err != nil {
			return nil, err
		}
		return s.GetSharedFolderByID(userID, existingID)
	}

	now := domain.NowISO()
	folderID := domain.NewID("fld")

	_, err = s.db.Exec(`
		INSERT INTO workspace_shared_folders (id, owner_id, name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`, folderID, userID, cleanName, now, now)
	if err != nil {
		return nil, err
	}

	_, err = s.db.Exec(`
		INSERT INTO workspace_folder_mounts (user_id, folder_id, mount_path, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`, userID, folderID, cleanMount, now, now)
	if err != nil {
		return nil, err
	}

	if err := s.syncSharedFolderContents(userID, folderID, cleanMount); err != nil {
		return nil, err
	}

	var ownerName string
	_ = s.db.QueryRow(`SELECT display_name FROM users WHERE id = ?`, userID).Scan(&ownerName)

	return &domain.SharedFolder{
		ID:         folderID,
		OwnerID:    userID,
		OwnerName:  ownerName,
		Name:       cleanName,
		MountPath:  cleanMount,
		IsOwner:    true,
		Permission: "owner",
		Shares:     []domain.FolderShare{},
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}

func (s *Store) GetSharedFolders(userID string) ([]domain.SharedFolder, error) {
	rows, err := s.db.Query(`
		SELECT f.id, f.owner_id, u.display_name, f.name,
		       COALESCE(m.mount_path, f.name) as mount_path,
		       CASE
		           WHEN f.owner_id = ? THEN 1
		           ELSE 0
		       END as is_owner,
		       CASE
		           WHEN f.owner_id = ? THEN 'owner'
		           WHEN MAX(CASE WHEN s.permission = 'write' THEN 1 ELSE 0 END) = 1 THEN 'write'
		           ELSE 'read'
		       END as permission,
		       f.created_at, f.updated_at
		FROM workspace_shared_folders f
		JOIN users u ON f.owner_id = u.id
		LEFT JOIN workspace_folder_mounts m ON m.folder_id = f.id AND m.user_id = ?
		LEFT JOIN workspace_folder_shares s ON s.folder_id = f.id AND (
			(s.target_type = 'user' AND s.target_id = ?) OR
			(s.target_type = 'team' AND s.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		)
		WHERE f.owner_id = ? OR s.id IS NOT NULL
		GROUP BY f.id
		ORDER BY f.created_at ASC
	`, userID, userID, userID, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	folders := make([]domain.SharedFolder, 0)
	for rows.Next() {
		var f domain.SharedFolder
		var isOwner int
		if err := rows.Scan(&f.ID, &f.OwnerID, &f.OwnerName, &f.Name, &f.MountPath, &isOwner, &f.Permission, &f.CreatedAt, &f.UpdatedAt); err == nil {
			f.IsOwner = isOwner != 0
			if f.IsOwner {
				if shares, err := s.GetFolderShares(f.ID); err == nil {
					f.Shares = shares
				}
			}
			folders = append(folders, f)
		}
	}
	return folders, nil
}

func (s *Store) GetSharedFolderByID(userID, folderID string) (*domain.SharedFolder, error) {
	row := s.db.QueryRow(`
		SELECT f.id, f.owner_id, u.display_name, f.name,
		       COALESCE(m.mount_path, f.name) as mount_path,
		       CASE
		           WHEN f.owner_id = ? THEN 1
		           ELSE 0
		       END as is_owner,
		       CASE
		           WHEN f.owner_id = ? THEN 'owner'
		           WHEN MAX(CASE WHEN s.permission = 'write' THEN 1 ELSE 0 END) = 1 THEN 'write'
		           ELSE 'read'
		       END as permission,
		       f.created_at, f.updated_at
		FROM workspace_shared_folders f
		JOIN users u ON f.owner_id = u.id
		LEFT JOIN workspace_folder_mounts m ON m.folder_id = f.id AND m.user_id = ?
		LEFT JOIN workspace_folder_shares s ON s.folder_id = f.id AND (
			(s.target_type = 'user' AND s.target_id = ?) OR
			(s.target_type = 'team' AND s.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		)
		WHERE f.id = ? AND (f.owner_id = ? OR s.id IS NOT NULL)
		GROUP BY f.id
	`, userID, userID, userID, userID, userID, folderID, userID)

	var f domain.SharedFolder
	var isOwner int
	if err := row.Scan(&f.ID, &f.OwnerID, &f.OwnerName, &f.Name, &f.MountPath, &isOwner, &f.Permission, &f.CreatedAt, &f.UpdatedAt); err != nil {
		return nil, fmt.Errorf("geteilter Ordner nicht gefunden")
	}
	f.IsOwner = isOwner != 0
	if f.IsOwner {
		if shares, err := s.GetFolderShares(f.ID); err == nil {
			f.Shares = shares
		}
	}
	return &f, nil
}

func (s *Store) UpdateFolderMount(userID, folderID, mountPath string) error {
	cleanMount := filepath.ToSlash(filepath.Clean(strings.TrimSpace(mountPath)))
	if cleanMount == "." || cleanMount == "" {
		return fmt.Errorf("ungültiger Mount-Pfad")
	}
	now := domain.NowISO()
	_, err := s.db.Exec(`
		INSERT INTO workspace_folder_mounts (user_id, folder_id, mount_path, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id, folder_id) DO UPDATE SET mount_path = excluded.mount_path, updated_at = excluded.updated_at
	`, userID, folderID, cleanMount, now, now)
	return err
}

func (s *Store) GetFolderShares(folderID string) ([]domain.FolderShare, error) {
	shares := make([]domain.FolderShare, 0)
	rows, err := s.db.Query(`
		SELECT s.id, s.folder_id, s.target_type, s.target_id,
		       CASE
		           WHEN s.target_type = 'user' THEN u.display_name
		           WHEN s.target_type = 'team' THEN t.name
		           ELSE ''
		       END as target_name,
		       COALESCE(u.email, '') as email,
		       COALESCE(u.avatar_url, '') as avatar_url,
		       s.permission, s.created_by, s.created_at
		FROM workspace_folder_shares s
		LEFT JOIN users u ON s.target_type = 'user' AND s.target_id = u.id
		LEFT JOIN teams t ON s.target_type = 'team' AND s.target_id = t.id
		WHERE s.folder_id = ?
		ORDER BY s.created_at ASC
	`, folderID)
	if err != nil {
		return shares, err
	}
	defer rows.Close()

	for rows.Next() {
		var sh domain.FolderShare
		if err := rows.Scan(&sh.ID, &sh.FolderID, &sh.TargetType, &sh.TargetID, &sh.TargetName, &sh.Email, &sh.AvatarURL, &sh.Permission, &sh.CreatedBy, &sh.CreatedAt); err == nil {
			shares = append(shares, sh)
		}
	}
	return shares, nil
}

func (s *Store) CreateFolderShare(currentUserID, folderID, targetType, targetIdentifier, permission string) (*domain.FolderShare, error) {
	f, err := s.GetSharedFolderByID(currentUserID, folderID)
	if err != nil {
		return nil, err
	}
	if !f.IsOwner {
		return nil, fmt.Errorf("nur der Eigentümer kann Ordner-Freigaben verwalten")
	}

	cleanType := strings.TrimSpace(targetType)
	cleanTarget := strings.TrimSpace(targetIdentifier)
	if cleanType == "" {
		if strings.HasPrefix(cleanTarget, "team_") {
			cleanType = "team"
		} else {
			cleanType = "user"
		}
	}

	permission = normalizeSharePermission(permission)

	var targetID, targetName, email, avatarURL string
	if cleanType == "team" {
		err = s.db.QueryRow(`SELECT id, name FROM teams WHERE id = ?`, cleanTarget).Scan(&targetID, &targetName)
		if err != nil {
			return nil, ErrTargetNotFound
		}
	} else {
		var u *domain.User
		if strings.HasPrefix(cleanTarget, "usr_") {
			u, _ = s.GetUserByID(cleanTarget)
		}
		if u == nil {
			u, _ = s.GetUserByLogin(cleanTarget)
		}
		if u == nil {
			u, err = s.GetUserByID(cleanTarget)
		}
		if err != nil || u == nil {
			if s.db.QueryRow(`SELECT id, name FROM teams WHERE id = ?`, cleanTarget).Scan(&targetID, &targetName) == nil {
				cleanType = "team"
			} else {
				return nil, ErrTargetNotFound
			}
		} else {
			if u.ID == f.OwnerID {
				return nil, fmt.Errorf("ordner gehört bereits diesem Benutzer")
			}
			targetID = u.ID
			targetName = u.DisplayName
			email = u.Email
			avatarURL = u.AvatarURL
		}
	}

	if !s.CanShareWith(currentUserID, cleanType, targetID) {
		return nil, ErrTargetNotFound
	}

	now := domain.NowISO()
	shareID := domain.NewID("fsh")

	_, err = s.db.Exec(`
		INSERT INTO workspace_folder_shares (id, folder_id, target_type, target_id, permission, created_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(folder_id, target_type, target_id) DO UPDATE SET permission = excluded.permission
	`, shareID, folderID, cleanType, targetID, permission, currentUserID, now)
	if err != nil {
		return nil, err
	}

	var ownerMount string
	_ = s.db.QueryRow(`SELECT COALESCE(m.mount_path, f.name) FROM workspace_shared_folders f LEFT JOIN workspace_folder_mounts m ON m.folder_id = f.id AND m.user_id = f.owner_id WHERE f.id = ?`, folderID).Scan(&ownerMount)
	if ownerMount == "" {
		ownerMount = f.Name
	}
	if err := s.syncSharedFolderContents(f.OwnerID, folderID, ownerMount); err != nil {
		return nil, err
	}

	var mounts []sqlStmt
	if cleanType == "user" {
		mounts = append(mounts, stmt(`
			INSERT OR IGNORE INTO workspace_folder_mounts (user_id, folder_id, mount_path, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)
		`, targetID, folderID, f.Name, now, now))
	} else if cleanType == "team" {
		mRows, err := s.db.Query(`SELECT user_id FROM team_members WHERE team_id = ?`, targetID)
		if err == nil {
			var memberIDs []string
			for mRows.Next() {
				var uid string
				if err := mRows.Scan(&uid); err == nil && uid != "" {
					memberIDs = append(memberIDs, uid)
				}
			}
			_ = mRows.Close()
			for _, uid := range memberIDs {
				mounts = append(mounts, stmt(`
					INSERT OR IGNORE INTO workspace_folder_mounts (user_id, folder_id, mount_path, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?)
				`, uid, folderID, f.Name, now, now))
			}
		}
	}
	if err := s.execInTx(mounts...); err != nil {
		return nil, err
	}

	return &domain.FolderShare{
		ID:         shareID,
		FolderID:   folderID,
		TargetType: cleanType,
		TargetID:   targetID,
		TargetName: targetName,
		Email:      email,
		AvatarURL:  avatarURL,
		Permission: permission,
		CreatedBy:  currentUserID,
		CreatedAt:  now,
	}, nil
}

func (s *Store) DeleteFolderShare(currentUserID, folderID, shareID string) error {
	f, err := s.GetSharedFolderByID(currentUserID, folderID)
	if err != nil {
		return err
	}
	cleanID := strings.TrimSpace(shareID)

	// Only the owner manages shares; everyone else can only leave the folder
	if !f.IsOwner {
		return s.execInTx(
			stmt(`DELETE FROM workspace_folder_shares WHERE folder_id = ? AND target_type = 'user' AND target_id = ? AND (id = ? OR target_id = ?)`,
				folderID, currentUserID, cleanID, cleanID),
			stmt(`DELETE FROM workspace_folder_mounts WHERE folder_id = ? AND user_id = ?`, folderID, currentUserID))
	}

	var targetType, targetID string
	_ = s.db.QueryRow(`SELECT target_type, target_id FROM workspace_folder_shares WHERE folder_id = ? AND (id = ? OR target_id = ?)`,
		folderID, cleanID, cleanID).Scan(&targetType, &targetID)

	writes := []sqlStmt{stmt(`DELETE FROM workspace_folder_shares WHERE folder_id = ? AND (id = ? OR target_id = ?)`, folderID, cleanID, cleanID)}
	if targetType == "user" && targetID != "" {
		writes = append(writes, stmt(`DELETE FROM workspace_folder_mounts WHERE folder_id = ? AND user_id = ?`, folderID, targetID))
	}
	return s.execInTx(writes...)
}

func (s *Store) DeleteSharedFolder(currentUserID, folderID string) error {
	f, err := s.GetSharedFolderByID(currentUserID, folderID)
	if err != nil {
		return err
	}
	if !f.IsOwner {
		return s.DeleteFolderShare(currentUserID, folderID, currentUserID)
	}

	return s.execInTx(
		stmt(`UPDATE documents SET shared_folder_id = '', sub_folder_path = '' WHERE shared_folder_id = ?`, folderID),
		stmt(`DELETE FROM workspace_folder_mounts WHERE folder_id = ?`, folderID),
		stmt(`DELETE FROM workspace_folder_shares WHERE folder_id = ?`, folderID),
		stmt(`DELETE FROM workspace_folders WHERE shared_folder_id = ?`, folderID),
		stmt(`DELETE FROM workspace_shared_folders WHERE id = ?`, folderID))
}

// GetSharedFolderDocIDs returns all non-archived document IDs belonging to a shared folder.
func (s *Store) GetSharedFolderDocIDs(folderID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT id FROM documents WHERE shared_folder_id = ? AND is_archived = 0`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil && id != "" {
			docIDs = append(docIDs, id)
		}
	}
	return docIDs, nil
}
