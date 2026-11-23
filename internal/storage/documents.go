package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// docPlainText is the text of a note, one bullet per line (a drawing with the words written in it); the
// "content" of a note in the API. It is built from the bullets (documents has no copy since migration 51).
func docPlainText(blocks []domain.DocumentBlock) string {
	var b strings.Builder
	for _, bl := range blocks {
		text := bl.Content
		if bl.Type == drawing.BlockType {
			text = strings.Join(drawing.Texts(bl.Content), "\n")
		}
		if text != "" {
			b.WriteString(text)
			b.WriteString("\n")
		}
	}
	return b.String()
}

func (s *Store) loadDocBlocks(docID string, fallbackJSON string) []domain.DocumentBlock {
	if d, _, err := loadCollabDoc(s.db, docID); err == nil && len(d.Blocks) > 0 {
		blocks := flatDocumentBlocks(docID, d)
		if links, subLinks := s.DocTaskLinks(docID); len(links) > 0 {
			for i := range blocks {
				blocks[i].TaskID = links[blocks[i].ID]
				blocks[i].SubtaskOf = subLinks[blocks[i].ID]
			}
		}
		return blocks
	}

	// Very old notes only stored blocks_json; convert them once
	blocks := make([]domain.DocumentBlock, 0)
	if fallbackJSON != "" && fallbackJSON != "[]" {
		_ = json.Unmarshal([]byte(fallbackJSON), &blocks)
		if len(blocks) > 0 {
			s.replaceDocBlocksInDB(docID, "", blocks, domain.NowISO())
			if d, _, err := loadCollabDoc(s.db, docID); err == nil {
				return flatDocumentBlocks(docID, d)
			}
		}
	}
	return blocks
}

// GetAuthorizedDocUsers returns all user IDs who have read/write/owner access to docID.
func (s *Store) GetAuthorizedDocUsers(docID string) ([]string, error) {
	userSet := make(map[string]bool)

	var ownerID, sharedFolderID string
	err := s.db.QueryRow(`SELECT user_id, shared_folder_id FROM documents WHERE id = ?`, docID).Scan(&ownerID, &sharedFolderID)
	if err != nil {
		return nil, err
	}
	if ownerID != "" {
		userSet[ownerID] = true
	}

	// Direct user shares
	uRows, err := s.db.Query(`SELECT user_id FROM doc_shares WHERE doc_id = ?`, docID)
	if err == nil {
		for uRows.Next() {
			var uid string
			if err := uRows.Scan(&uid); !dbFailed(err) && uid != "" {
				userSet[uid] = true
			}
		}
		logDBErr(uRows.Err())
		_ = uRows.Close()
	}

	// Team shares
	tRows, err := s.db.Query(`
		SELECT tm.user_id
		FROM doc_team_shares dts
		JOIN team_members tm ON tm.team_id = dts.team_id
		WHERE dts.doc_id = ?
	`, docID)
	if err == nil {
		for tRows.Next() {
			var uid string
			if err := tRows.Scan(&uid); !dbFailed(err) && uid != "" {
				userSet[uid] = true
			}
		}
		logDBErr(tRows.Err())
		_ = tRows.Close()
	}

	// Shared folder access
	if sharedFolderID != "" {
		sfUsers, err := s.GetAuthorizedSharedFolderUsers(sharedFolderID)
		if err == nil {
			for _, uid := range sfUsers {
				userSet[uid] = true
			}
		}
	}

	users := make([]string, 0, len(userSet))
	for uid := range userSet {
		users = append(users, uid)
	}
	return users, nil
}

// GetAuthorizedSharedFolderUsers returns all user IDs who have access to a shared folder.
func (s *Store) GetAuthorizedSharedFolderUsers(folderID string) ([]string, error) {
	userSet := make(map[string]bool)

	var ownerID string
	if err := s.db.QueryRow(`SELECT owner_id FROM workspace_shared_folders WHERE id = ?`, folderID).Scan(&ownerID); err == nil && ownerID != "" {
		userSet[ownerID] = true
	}

	rows, err := s.db.Query(`
		SELECT target_type, target_id FROM workspace_folder_shares WHERE folder_id = ?
	`, folderID)
	if err == nil {
		type shareTarget struct{ tType, tID string }
		var targets []shareTarget
		for rows.Next() {
			var st shareTarget
			if err := rows.Scan(&st.tType, &st.tID); !dbFailed(err) {
				targets = append(targets, st)
			}
		}
		logDBErr(rows.Err())
		_ = rows.Close()

		for _, st := range targets {
			if st.tType == "user" && st.tID != "" {
				userSet[st.tID] = true
			} else if st.tType == "team" && st.tID != "" {
				mRows, err := s.db.Query(`SELECT user_id FROM team_members WHERE team_id = ?`, st.tID)
				if err == nil {
					for mRows.Next() {
						var uid string
						if err := mRows.Scan(&uid); !dbFailed(err) && uid != "" {
							userSet[uid] = true
						}
					}
					logDBErr(mRows.Err())
					_ = mRows.Close()
				}
			}
		}
	}

	users := make([]string, 0, len(userSet))
	for uid := range userSet {
		users = append(users, uid)
	}
	return users, nil
}

// ErrNoteTitleTooLong: a title given through the API is longer than a note title may be (collab.MaxTitleRunes)
var ErrNoteTitleTooLong = i18n.NewError("Ein Notiztitel darf höchstens {max} Zeichen haben", "max", strconv.Itoa(collab.MaxTitleRunes))

// CheckNoteTitle checks a title given through the API (REST, MCP) for a note whose title is current ("" for
// a new note): at most collab.MaxTitleRunes characters, or not longer than a longer title it replaces.
// Titles from imports, backups and the app itself are not checked: an import keeps its titles.
func CheckNoteTitle(title, current string) error {
	if !collab.TitleAllowed(strings.TrimSpace(title), current) {
		return ErrNoteTitleTooLong
	}
	return nil
}

// ShortTitle: a title made from other text (a bullet, an inbox entry) cut to the limit, with "…"
func ShortTitle(t string) string {
	r := []rune(strings.TrimSpace(t))
	if len(r) <= collab.MaxTitleRunes {
		return string(r)
	}
	return strings.TrimSpace(string(r[:collab.MaxTitleRunes-1])) + "…"
}

// FirstLineTitle: a title from multi-line text (an inbox entry): its first non-empty line, cut like ShortTitle
func FirstLineTitle(t string) string {
	for _, line := range strings.Split(t, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return ShortTitle(line)
		}
	}
	return ""
}

// CreateDocument creates a note of userID with the given bullets. References to files userID may not
// read are dropped from them (mediaGate); references to hidden values of other notes become copies in
// the new note or a placeholder (secretGate).
func (s *Store) CreateDocument(userID, spaceID, title, icon, folderPath string, blocks []domain.DocumentBlock, tags []string, isPinned bool) (*domain.Document, error) {
	return s.createDocument(userID, spaceID, title, icon, folderPath, blocks, tags, isPinned, nil)
}

// createDocument is CreateDocument; keepMedia are file ids kept without a check (an import's own files,
// stored once the note exists).
func (s *Store) createDocument(userID, spaceID, title, icon, folderPath string, blocks []domain.DocumentBlock, tags []string, isPinned bool, keepMedia map[string]bool) (*domain.Document, error) {
	blocks, _ = s.newMediaGate(userID, keepMedia).cleanBlocks(blocks)
	docID := domain.NewID("doc")
	secrets := s.newSecretGate(userID, docID)
	blocks = secrets.cleanBlocks(blocks)
	if strings.TrimSpace(title) == "" {
		title = i18n.T(s.MessageLanguage(userID), "Unbenannte Notiz")
	}
	if icon == "" {
		icon = "🗒️"
	}
	if blocks == nil {
		blocks = []domain.DocumentBlock{
			{ID: domain.NewID("blk"), Type: "paragraph", Content: ""},
		}
	}
	// The same limit as for bullets added later (collab.MaxNoteBlocks): a note created whole, by the API,
	// an import or an agent, would otherwise skip it
	if len(blocks) > collab.MaxNoteBlocks {
		secrets.discard()
		return nil, collab.ErrNoteTooLarge
	}
	tags = stripFolderTags(tags)
	tagsJSON, _ := json.Marshal(tags)
	now := domain.NowISO()
	pinnedInt := 0
	if isPinned {
		pinnedInt = 1
	}

	cleanFolder := cleanFolderPath(folderPath)
	if cleanFolder == "." {
		cleanFolder = ""
	}

	mounts, _, _ := s.getUserFolderMounts(userID)
	var sharedFolderID, subFolderPath string
	if fID, sub, ok := matchMountPath(cleanFolder, mounts); ok {
		sharedFolderID = fID
		subFolderPath = sub
	}

	doc := &domain.Document{
		ID:             docID,
		UserID:         userID,
		SpaceID:        spaceID,
		Title:          strings.TrimSpace(title),
		Icon:           icon,
		Content:        docPlainText(blocks),
		Blocks:         blocks,
		Tags:           tags,
		FolderPath:     cleanFolder,
		IsPinned:       isPinned,
		SharedFolderID: sharedFolderID,
		SubFolderPath:  subFolderPath,
		IsSharedFolder: sharedFolderID != "",
		Permission:     "owner",
		IsOwner:        true,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	// The text goes into blocks only (blocks_json stays empty, see note_storage.go)
	_, err := s.db.Exec(
		`INSERT INTO documents (id, user_id, space_id, title, icon, blocks_json, tags, folder_path, is_pinned, is_archived, created_at, updated_at, shared_folder_id, sub_folder_path)
		 VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, 0, ?, ?, ?, ?)`,
		doc.ID, doc.UserID, doc.SpaceID, doc.Title, doc.Icon, string(tagsJSON), doc.FolderPath, pinnedInt, doc.CreatedAt, doc.UpdatedAt, doc.SharedFolderID, doc.SubFolderPath,
	)
	if err != nil {
		secrets.discard()
		return nil, err
	}
	if err := s.saveDocBlocks(doc.ID, userID, doc.Blocks); err != nil {
		// Without its bullets the note would be empty: it is not created
		s.execLogged(`DELETE FROM documents WHERE id = ?`, doc.ID)
		secrets.discard()
		return nil, err
	}
	if isPinned {
		s.execLogged(`INSERT OR IGNORE INTO doc_pins (user_id, doc_id, created_at) VALUES (?, ?, ?)`, userID, doc.ID, doc.CreatedAt)
	}
	// The bullets as stored: saveDocBlocks gives bullets whose id belongs to another note (copied
	// bullets, starter content) or is missing or repeated a new one and fills in a missing type, so the
	// answer names the ids the note has, as GET /documents/{id} does. block_tags was written with them.
	if stored := s.loadDocBlocks(doc.ID, ""); len(stored) > 0 {
		doc.Blocks = stored
		doc.Content = docPlainText(stored)
	}
	s.keepFolder(userID, cleanFolder)
	return doc, nil
}

// getUserFolderMounts returns map[folder_id]mount_path and map[folder_id]folder_name for all shared folders accessible to userID
func (s *Store) getUserFolderMounts(userID string) (map[string]string, map[string]string, error) {
	return userFolderMounts(s.db, userID)
}

// userFolderMounts is getUserFolderMounts with the query on q.
func userFolderMounts(q docQueryer, userID string) (map[string]string, map[string]string, error) {
	mounts := make(map[string]string)
	names := make(map[string]string)

	rows, err := q.Query(`
		SELECT f.id, f.name, COALESCE(m.mount_path, f.name) as mount_path
		FROM workspace_shared_folders f
		LEFT JOIN workspace_folder_mounts m ON m.folder_id = f.id AND m.user_id = ?
		LEFT JOIN workspace_folder_shares s ON s.folder_id = f.id AND (
			(s.target_type = 'user' AND s.target_id = ?) OR
			(s.target_type = 'team' AND s.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		)
		WHERE f.owner_id = ? OR s.id IS NOT NULL
		GROUP BY f.id
	`, userID, userID, userID, userID)
	if err != nil {
		return mounts, names, err
	}
	defer rows.Close()

	for rows.Next() {
		var fID, fName, mPath string
		if err := rows.Scan(&fID, &fName, &mPath); !dbFailed(err) {
			names[fID] = fName
			if mPath == "" {
				mPath = fName
			}
			mounts[fID] = mPath
		}
	}
	if err := rows.Err(); err != nil {
		return mounts, names, err
	}
	return mounts, names, nil
}

// matchMountPath checks if folderPath falls within any mounted shared folder.
// Returns (sharedFolderID, relativeSubPath, isMatch).
// CheckCreateInFolder: new notes may go into own folders and into shared folders with write access.
func (s *Store) CheckCreateInFolder(userID, folderPath string) error {
	mounts, _, err := s.getUserFolderMounts(userID)
	if err != nil {
		return err
	}
	fID, _, ok := matchMountPath(folderPath, mounts)
	if !ok {
		return nil
	}
	sf, err := s.GetSharedFolderByID(userID, fID)
	if err != nil {
		return err
	}
	if sf.Permission != "owner" && sf.Permission != "write" && !sf.IsOwner {
		return i18n.NewError("Im geteilten Ordner „{folder}“ darfst du nur lesen", "folder", sf.Name)
	}
	return nil
}

func matchMountPath(folderPath string, mounts map[string]string) (string, string, bool) {
	clean := cleanFolderPath(folderPath)
	if clean == "." {
		clean = ""
	}
	if clean == "" {
		return "", "", false
	}

	var bestFolderID string
	var bestSubPath string
	longestMountLen := -1

	for fID, mPath := range mounts {
		cleanMount := cleanFolderPath(mPath)
		if cleanMount == "." {
			cleanMount = ""
		}
		if cleanMount == "" {
			continue
		}

		if clean == cleanMount {
			if len(cleanMount) > longestMountLen {
				longestMountLen = len(cleanMount)
				bestFolderID = fID
				bestSubPath = ""
			}
		} else if strings.HasPrefix(clean, cleanMount+"/") {
			sub := strings.TrimPrefix(clean, cleanMount+"/")
			if len(cleanMount) > longestMountLen {
				longestMountLen = len(cleanMount)
				bestFolderID = fID
				bestSubPath = sub
			}
		}
	}

	if longestMountLen >= 0 {
		return bestFolderID, bestSubPath, true
	}
	return "", "", false
}

func resolveDocumentPath(userID string, doc *domain.Document, mounts map[string]string, names map[string]string, userFolders map[string]string) {
	if doc.SharedFolderID != "" {
		mountPath, ok := mounts[doc.SharedFolderID]
		if !ok || mountPath == "" {
			mountPath = names[doc.SharedFolderID]
			if mountPath == "" {
				mountPath = "Geteilter Ordner"
			}
		}
		doc.IsSharedFolder = true
		if doc.SubFolderPath != "" {
			doc.FolderPath = mountPath + "/" + doc.SubFolderPath
		} else {
			doc.FolderPath = mountPath
		}
	} else {
		if uf, ok := userFolders[doc.ID]; ok {
			doc.FolderPath = uf
		} else if !doc.IsOwner {
			doc.FolderPath = ""
		}
	}
}

// GetDocuments returns every note the user can see, each with all its bullets and plain text. For code
// on the server that works with the bullets (export, backlinks, links, folders); the app's note list
// uses GetDocumentList.
func (s *Store) GetDocuments(userID string) ([]domain.Document, error) {
	return s.getDocuments(context.Background(), userID, true)
}

// GetDocumentList returns the notes the user can see without their bullets (Blocks empty, Content ""),
// with the counts the folder tree, the hashtag list and the to-do overview need (OpenTodos, TagCounts,
// TagOpenTodos). Every client loads it at start: with bullets it grew by about 43 KB per note, and many
// of them at once took gigabytes of memory under load. Its reads run on one connection and see one state
// of the database (readConsistent) instead of taking a connection from the pool for each. When ctx ends
// (the client gave up) its queries are cancelled and it returns ctx's error.
func (s *Store) GetDocumentList(ctx context.Context, userID string) ([]domain.Document, error) {
	var docs []domain.Document
	err := s.readConsistent(ctx, func(q docQueryer) error {
		var err error
		if docs, _, err = listDocuments(q, userID, false); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return attachListStats(q, docs)
	})
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if err != nil {
		return nil, err
	}
	return docs, nil
}

// getDocuments: the notes the user can see, with their bullets and plain text when withBlocks. The
// queries run with ctx; an ended ctx returns its error, not a partial list.
func (s *Store) getDocuments(ctx context.Context, userID string, withBlocks bool) ([]domain.Document, error) {
	docs, blocksJSON, err := listDocuments(connOrDB(ctx, s.db), userID, withBlocks)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if withBlocks {
		// After the queries above: loading the bullets takes connections of its own
		for i := range docs {
			docs[i].Blocks, docs[i].Content = s.listBlocks(docs[i].ID, blocksJSON[i], true)
		}
	}
	return docs, nil
}

// docColumns: the columns of documents (d, with the pin p) that scanDocRow reads, in its order; whether
// ?1 uses the note as a template is looked up in doc_templates (personal, like the pin).
// blocks_json is only read when the bullets are wanted (withBlockJSON): it holds something only for a
// very old note whose block list could not be converted (loadDocBlocks); the note list has no bullets.
func docColumns(withBlockJSON bool) string {
	blocksJSON := `''`
	if withBlockJSON {
		blocksJSON = `d.blocks_json`
	}
	return `d.id, d.user_id, d.space_id, d.title, d.icon, ` + blocksJSON + `, d.tags, d.folder_path,
		CASE WHEN p.doc_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned,
		EXISTS(SELECT 1 FROM doc_templates t WHERE t.user_id = ?1 AND t.doc_id = d.id) AS is_template,
		d.is_archived, d.created_at, d.updated_at,
		d.shared_folder_id, d.sub_folder_path`
}

// scanDocRow reads the columns of docColumns, followed by extra, into a note without bullets and returns
// its blocks_json.
func scanDocRow(row interface{ Scan(dest ...any) error }, d *domain.Document, extra ...any) (string, error) {
	var blocksStr, tagsStr string
	var isPinned, isTemplate, isArchived int
	dest := append([]any{
		&d.ID, &d.UserID, &d.SpaceID, &d.Title, &d.Icon,
		&blocksStr, &tagsStr, &d.FolderPath, &isPinned, &isTemplate, &isArchived, &d.CreatedAt, &d.UpdatedAt,
		&d.SharedFolderID, &d.SubFolderPath,
	}, extra...)
	if err := row.Scan(dest...); err != nil {
		return "", err
	}
	d.IsPinned = isPinned != 0
	d.IsTemplate = isTemplate != 0
	d.IsArchived = isArchived != 0
	d.Tags = []string{}
	_ = json.Unmarshal([]byte(tagsStr), &d.Tags)
	d.Tags = stripFolderTags(d.Tags)
	d.Blocks = []domain.DocumentBlock{}
	return blocksStr, nil
}

// sqlSharedDocPermission: the permission of ?1 on a note shared with them (d), from the joins of
// sqlSharedDocJoins.
const sqlSharedDocPermission = `CASE
		WHEN wsf.owner_id = ?1 THEN 'owner'
		WHEN COALESCE(s.permission, '') = 'write' OR COALESCE(dts.permission, '') = 'write' OR COALESCE(wfs.permission, '') = 'write' THEN 'write'
		ELSE 'read'
	END`

// sqlSharedDocJoins joins the ways a note (d) can be shared with ?1: directly (s), through a team (dts),
// as the owner of its shared folder (wsf) or through a share of that folder (wfs); and ?1's pin (p) and
// the note's owner (u).
const sqlSharedDocJoins = `
	JOIN users u ON d.user_id = u.id
	LEFT JOIN doc_shares s ON d.id = s.doc_id AND s.user_id = ?1
	LEFT JOIN (
		SELECT dts2.doc_id, dts2.permission
		FROM doc_team_shares dts2
		JOIN team_members tm ON tm.team_id = dts2.team_id
		WHERE tm.user_id = ?1
	) dts ON d.id = dts.doc_id
	LEFT JOIN workspace_shared_folders wsf ON d.shared_folder_id = wsf.id
	LEFT JOIN (
		SELECT wfs2.folder_id, wfs2.permission
		FROM workspace_folder_shares wfs2
		WHERE (wfs2.target_type = 'user' AND wfs2.target_id = ?1)
		   OR (wfs2.target_type = 'team' AND wfs2.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?1))
	) wfs ON d.shared_folder_id = wfs.folder_id
	LEFT JOIN doc_pins p ON p.doc_id = d.id AND p.user_id = ?1`

// sqlSharedDocIDs: the ids of the notes shared with ?1 in one of the ways of sqlSharedDocJoins, found
// through the shares instead of checking every note of the server. Notes of ?1 and notes in the trash
// can be among them; the caller filters them.
const sqlSharedDocIDs = `
	SELECT doc_id FROM doc_shares WHERE user_id = ?1
	UNION
	SELECT dts.doc_id FROM doc_team_shares dts JOIN team_members tm ON tm.team_id = dts.team_id WHERE tm.user_id = ?1
	UNION
	SELECT d.id FROM workspace_shared_folders f JOIN documents d ON d.shared_folder_id = f.id WHERE f.owner_id = ?1
	UNION
	SELECT d.id FROM workspace_folder_shares f JOIN documents d ON d.shared_folder_id = f.folder_id
	WHERE (f.target_type = 'user' AND f.target_id = ?1)
	   OR (f.target_type = 'team' AND f.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?1))`

// sqlVisibleDocIDs: the ids of all notes ?1 can see, their own and those of sqlSharedDocIDs, each once.
// Notes in the trash can be among them; the caller filters them.
const sqlVisibleDocIDs = `
	SELECT id FROM documents WHERE user_id = ?1
	UNION` + sqlSharedDocIDs

// listDocuments: the notes the user can see, without bullets, the owned ones with their shares; per
// note its blocks_json when withBlockJSON (else ""). Only queries on q, one after the other, so it can
// run on a single connection.
func listDocuments(q docQueryer, userID string, withBlockJSON bool) ([]domain.Document, []string, error) {
	mounts, names, _ := userFolderMounts(q, userID)

	userFolders := make(map[string]string)
	ufRows, err := q.Query(`SELECT doc_id, folder_path FROM doc_user_folders WHERE user_id = ?`, userID)
	if err == nil {
		for ufRows.Next() {
			var did, fp string
			if err := ufRows.Scan(&did, &fp); !dbFailed(err) {
				userFolders[did] = fp
			}
		}
		logDBErr(ufRows.Err())
		_ = ufRows.Close()
	}

	// 1. The user's own notes (with their own pin from doc_pins); notes changed in the same second keep
	// the order they were made in, for the owner and for everyone they are shared with
	rows, err := q.Query(
		`SELECT `+docColumns(withBlockJSON)+`
		 FROM documents d
		 LEFT JOIN doc_pins p ON p.doc_id = d.id AND p.user_id = ?1
		 WHERE d.user_id = ?1 AND d.is_archived = 0
		 ORDER BY is_pinned DESC, d.updated_at DESC, d.rowid`,
		userID,
	)
	if err != nil {
		return nil, nil, err
	}
	docs := []domain.Document{}
	var blocksJSON []string
	for rows.Next() {
		d := domain.Document{}
		bj, err := scanDocRow(rows, &d)
		if dbFailed(err) {
			continue
		}
		d.Permission = "owner"
		d.IsOwner = true
		resolveDocumentPath(userID, &d, mounts, names, userFolders)
		docs = append(docs, d)
		blocksJSON = append(blocksJSON, bj)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, nil, err
	}
	_ = rows.Close()

	// 2. Notes shared with the user directly, through teams or through shared folders: first the
	// candidates from the shares, then only those notes (the query grew with every note of the server)
	sharedRows, err := q.Query(
		`WITH shared(id) AS (`+sqlSharedDocIDs+`)
		 SELECT `+docColumns(withBlockJSON)+`, `+sqlSharedDocPermission+` AS permission, u.display_name
		 FROM shared CROSS JOIN documents d ON d.id = shared.id`+sqlSharedDocJoins+`
		 WHERE d.is_archived = 0 AND d.user_id != ?1
		 GROUP BY d.id
		 ORDER BY is_pinned DESC, d.updated_at DESC, d.rowid`,
		userID,
	)
	if err == nil {
		for sharedRows.Next() {
			d := domain.Document{}
			var perm, ownerName string
			bj, scanErr := scanDocRow(sharedRows, &d, &perm, &ownerName)
			if dbFailed(scanErr) {
				continue
			}
			d.Permission = perm
			d.IsOwner = (perm == "owner")
			d.OwnerName = ownerName
			resolveDocumentPath(userID, &d, mounts, names, userFolders)
			docs = append(docs, d)
			blocksJSON = append(blocksJSON, bj)
		}
		logDBErr(sharedRows.Err())
		_ = sharedRows.Close()
	}

	// 3. Shares of the owned notes: two queries for all of them, not two per note (a list of a thousand
	// notes made two thousand queries)
	var owned []string
	for i := range docs {
		if docs[i].IsOwner {
			owned = append(owned, docs[i].ID)
		}
	}
	if byDoc, err := docSharesOf(q, owned); err == nil {
		for i := range docs {
			if sh, ok := byDoc[docs[i].ID]; ok {
				docs[i].SharedWith = sh
			}
		}
	}
	if linked, err := publicLinkDocIDs(q, owned, time.Now()); err == nil {
		for i := range docs {
			docs[i].HasPublicLink = linked[docs[i].ID]
		}
	}
	return docs, blocksJSON, nil
}

// publicLinkDocIDs returns which of the notes have a public link that is still valid at now (one query
// for all of them).
func publicLinkDocIDs(q docQueryer, docIDs []string, now time.Time) (map[string]bool, error) {
	out := map[string]bool{}
	if len(docIDs) == 0 {
		return out, nil
	}
	idsJSON, _ := json.Marshal(docIDs)
	rows, err := q.Query(`SELECT doc_id FROM public_links WHERE doc_id IN (SELECT value FROM json_each(?)) AND expires_at > ?`,
		string(idsJSON), now.UTC().Format(time.RFC3339))
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); !dbFailed(err) {
			out[id] = true
		}
	}
	return out, rows.Err()
}

// docSharesOf returns the shares of several notes at once, per note in the order GetDocShares gives
// them (people first, then teams, each by creation time).
func docSharesOf(q docQueryer, docIDs []string) (map[string][]domain.DocShare, error) {
	out := map[string][]domain.DocShare{}
	if len(docIDs) == 0 {
		return out, nil
	}
	idsJSON, _ := json.Marshal(docIDs)
	uRows, err := q.Query(
		`SELECT s.id, s.doc_id, s.user_id, u.email, u.display_name, s.permission, s.created_by, s.created_at
		 FROM doc_shares s
		 JOIN users u ON s.user_id = u.id
		 WHERE s.doc_id IN (SELECT value FROM json_each(?))
		 ORDER BY s.doc_id, s.created_at ASC`,
		string(idsJSON),
	)
	if err != nil {
		return nil, err
	}
	for uRows.Next() {
		var sh domain.DocShare
		if err := uRows.Scan(&sh.ID, &sh.DocID, &sh.UserID, &sh.UserEmail, &sh.DisplayName, &sh.Permission, &sh.CreatedBy, &sh.CreatedAt); !dbFailed(err) {
			sh.TargetType = "user"
			sh.TargetID = sh.UserID
			sh.TargetName = sh.DisplayName
			out[sh.DocID] = append(out[sh.DocID], sh)
		}
	}
	logDBErr(uRows.Err())
	_ = uRows.Close()

	tRows, err := q.Query(
		`SELECT s.id, s.doc_id, s.team_id, t.name, s.permission, s.created_by, s.created_at
		 FROM doc_team_shares s
		 JOIN teams t ON s.team_id = t.id
		 WHERE s.doc_id IN (SELECT value FROM json_each(?))
		 ORDER BY s.doc_id, s.created_at ASC`,
		string(idsJSON),
	)
	if err != nil {
		return nil, err
	}
	for tRows.Next() {
		var sh domain.DocShare
		var teamID, teamName string
		if err := tRows.Scan(&sh.ID, &sh.DocID, &teamID, &teamName, &sh.Permission, &sh.CreatedBy, &sh.CreatedAt); !dbFailed(err) {
			sh.TargetType = "team"
			sh.TargetID = teamID
			sh.TargetName = teamName
			sh.DisplayName = teamName
			out[sh.DocID] = append(out[sh.DocID], sh)
		}
	}
	logDBErr(tRows.Err())
	_ = tRows.Close()
	return out, nil
}

// GetDocumentByID returns a note the user can see (or one of theirs in the trash) with all its bullets.
func (s *Store) GetDocumentByID(userID, docID string) (*domain.Document, error) {
	return s.getDocumentByID(userID, docID, true)
}

// getDocumentByID is GetDocumentByID; without withBlocks the note has no bullets, plain text or
// markdown, and none of them is loaded.
func (s *Store) getDocumentByID(userID, docID string, withBlocks bool) (*domain.Document, error) {
	mounts, names, _ := s.getUserFolderMounts(userID)
	userFolders := make(map[string]string)
	var personalFp string
	if err := s.db.QueryRow(`SELECT folder_path FROM doc_user_folders WHERE user_id = ? AND doc_id = ?`, userID, docID).Scan(&personalFp); err == nil {
		userFolders[docID] = personalFp
	}

	// Owned note first (with the user's pin)
	doc := &domain.Document{}
	blocksStr, err := scanDocRow(s.db.QueryRow(
		`SELECT `+docColumns(withBlocks)+`
		 FROM documents d
		 LEFT JOIN doc_pins p ON p.doc_id = d.id AND p.user_id = ?1
		 WHERE d.id = ?2 AND (d.user_id = ?1 OR (d.is_archived = 1 AND d.archived_by = ?1))`,
		userID, docID,
	), doc)
	if err == nil {
		if withBlocks {
			doc.Blocks = s.loadDocBlocks(doc.ID, blocksStr)
			doc.Content = docPlainText(doc.Blocks)
			doc.MarkdownCache = domain.CompileBlocksToMarkdown(doc.Blocks)
		}
		doc.FolderID = doc.FolderPath
		doc.Permission = "owner"
		doc.IsOwner = doc.UserID == userID
		if doc.IsArchived {
			doc.Permission = "read" // read-only while in the trash
		}
		resolveDocumentPath(userID, doc, mounts, names, userFolders)
		if shares, err := s.GetDocShares(doc.ID); err == nil {
			doc.SharedWith = shares
		}
		if doc.IsOwner {
			if linked, err := publicLinkDocIDs(s.db, []string{doc.ID}, time.Now()); err == nil {
				doc.HasPublicLink = linked[doc.ID]
			}
		}
		return doc, nil
	}

	// Shared note (directly, through a team or through a shared folder)
	d := &domain.Document{}
	var perm, ownerName string
	blocksStr, err = scanDocRow(s.db.QueryRow(
		`SELECT `+docColumns(withBlocks)+`, `+sqlSharedDocPermission+` AS permission, u.display_name
		 FROM documents d`+sqlSharedDocJoins+`
		 WHERE d.id = ?2 AND d.is_archived = 0 AND (s.user_id = ?1 OR dts.doc_id IS NOT NULL OR wsf.owner_id = ?1 OR wfs.folder_id IS NOT NULL)
		 LIMIT 1`,
		userID, docID,
	), d, &perm, &ownerName)
	if err != nil {
		return nil, err
	}
	if withBlocks {
		d.Blocks = s.loadDocBlocks(d.ID, blocksStr)
		d.Content = docPlainText(d.Blocks)
	}
	d.Permission = perm
	d.IsOwner = (perm == "owner")
	d.OwnerName = ownerName
	resolveDocumentPath(userID, d, mounts, names, userFolders)
	if shares, err := s.GetDocShares(d.ID); err == nil {
		d.SharedWith = shares
	}
	if d.IsOwner {
		if linked, err := publicLinkDocIDs(s.db, []string{d.ID}, time.Now()); err == nil {
			d.HasPublicLink = linked[d.ID]
		}
	}
	return d, nil
}

func (s *Store) UpdateDocument(userID, docID string, title, icon, folderPath *string, isPinned *bool) (*domain.Document, error) {
	doc, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		return nil, err
	}
	if doc.IsArchived {
		return nil, ErrDocInTrash
	}

	// Pins and folder placement are personal; title and icon need edit rights. The content (blocks) is
	// only changed through the operation log (POST /docs/{id}/sync).
	changesContent := title != nil || icon != nil
	if changesContent && !CanEditDoc(s.DocRole(userID, docID)) {
		return nil, fmt.Errorf("keine Schreibberechtigung für dieses Dokument (nur Lesezugriff)")
	}

	if isPinned != nil {
		doc.IsPinned = *isPinned
		pin := []sqlStmt{stmt(`DELETE FROM doc_pins WHERE user_id = ? AND doc_id = ?`, userID, docID)}
		if *isPinned {
			pin = []sqlStmt{stmt(`INSERT OR IGNORE INTO doc_pins (user_id, doc_id, created_at) VALUES (?, ?, ?)`, userID, docID, domain.NowISO())}
		}
		if doc.IsOwner {
			pin = append(pin, stmt(`UPDATE documents SET is_pinned = ? WHERE id = ?`, boolInt(*isPinned), docID))
		}
		if err := s.execInTx(pin...); err != nil {
			return nil, err
		}
	}

	if folderPath != nil {
		movedDoc, moveErr := s.MoveDocument(userID, docID, *folderPath)
		if moveErr != nil {
			return nil, moveErr
		}
		doc.FolderPath = movedDoc.FolderPath
		doc.SharedFolderID = movedDoc.SharedFolderID
		doc.SubFolderPath = movedDoc.SubFolderPath
		doc.IsSharedFolder = movedDoc.IsSharedFolder
	}

	if !changesContent {
		return doc, nil
	}
	if title != nil {
		if err := CheckNoteTitle(*title, doc.Title); err != nil {
			return nil, err
		}
		doc.Title = strings.TrimSpace(*title)
		s.applyLegacyTitle(docID, userID, doc.Title)
	}
	if icon != nil {
		doc.Icon = *icon
	}
	doc.UpdatedAt = domain.NowISO()
	if _, err := s.db.Exec(`UPDATE documents SET icon = ?, updated_at = ? WHERE id = ?`, doc.Icon, doc.UpdatedAt, docID); err != nil {
		return nil, err
	}
	return s.GetDocumentByID(userID, docID)
}

func (s *Store) DeleteDocument(userID, docID string) error {
	doc, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		return err
	}
	if !doc.IsOwner {
		// Collaborator removing their shared access
		if _, err := s.db.Exec(`DELETE FROM doc_user_folders WHERE user_id = ? AND doc_id = ?`, userID, docID); err != nil {
			return err
		}
		return s.DeleteDocShare(userID, docID, userID)
	}
	if doc.IsArchived {
		return s.hardDeleteDocument(docID)
	}
	return s.trashDocument(userID, docID)
}

func (s *Store) reindexAllDocBlockTags() error {
	rows, err := s.db.Query(`SELECT id, user_id, blocks_json FROM documents WHERE is_archived = 0`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type docInfo struct {
		id, userID, blocksJSON string
	}
	var docs []docInfo
	for rows.Next() {
		var d docInfo
		if err := rows.Scan(&d.id, &d.userID, &d.blocksJSON); !dbFailed(err) {
			docs = append(docs, d)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()

	for _, d := range docs {
		blocks := s.loadDocBlocks(d.id, d.blocksJSON)
		if len(blocks) > 0 {
			if err := s.indexDocBlockTags(d.id, d.userID, blocks); err != nil {
				return err
			}
		}
	}
	return nil
}

// indexDocBlockTags rewrites the hashtags of a note's bullets in block_tags. Only bullets stored live in
// this note get rows (not those of a very old note whose block list could not be converted): the note
// list counts block_tags without checking the bullets (sqlListTagCounts).
func (s *Store) indexDocBlockTags(docID, _ string, blocks []domain.DocumentBlock) error {
	if _, err := s.db.Exec(`DELETE FROM block_tags WHERE document_id = ?`, docID); err != nil {
		return err
	}
	if len(blocks) == 0 {
		return nil
	}

	stmt, err := s.db.Prepare(`INSERT OR IGNORE INTO block_tags (tag, document_id, block_id)
		SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM blocks WHERE id = ?3 AND document_id = ?2 AND deleted = 0)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, b := range blocks {
		if b.Content == "" {
			continue
		}
		tags := domain.ExtractTags(b.Content)
		for _, tag := range tags {
			if _, err := stmt.Exec(tag, docID, b.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) GetDocShares(docID string) ([]domain.DocShare, error) {
	shares := make([]domain.DocShare, 0)

	// 1. Direct user shares
	uRows, err := s.db.Query(
		`SELECT s.id, s.doc_id, s.user_id, u.email, u.display_name, s.permission, s.created_by, s.created_at
		 FROM doc_shares s
		 JOIN users u ON s.user_id = u.id
		 WHERE s.doc_id = ?
		 ORDER BY s.created_at ASC`,
		docID,
	)
	if err == nil {
		for uRows.Next() {
			var sh domain.DocShare
			if err := uRows.Scan(&sh.ID, &sh.DocID, &sh.UserID, &sh.UserEmail, &sh.DisplayName, &sh.Permission, &sh.CreatedBy, &sh.CreatedAt); !dbFailed(err) {
				sh.TargetType = "user"
				sh.TargetID = sh.UserID
				sh.TargetName = sh.DisplayName
				shares = append(shares, sh)
			}
		}
		logDBErr(uRows.Err())
		_ = uRows.Close()
	}

	// 2. Team shares
	tRows, err := s.db.Query(
		`SELECT s.id, s.doc_id, s.team_id, t.name, s.permission, s.created_by, s.created_at
		 FROM doc_team_shares s
		 JOIN teams t ON s.team_id = t.id
		 WHERE s.doc_id = ?
		 ORDER BY s.created_at ASC`,
		docID,
	)
	if err == nil {
		for tRows.Next() {
			var sh domain.DocShare
			var teamID, teamName string
			if err := tRows.Scan(&sh.ID, &sh.DocID, &teamID, &teamName, &sh.Permission, &sh.CreatedBy, &sh.CreatedAt); !dbFailed(err) {
				sh.TargetType = "team"
				sh.TargetID = teamID
				sh.TargetName = teamName
				sh.DisplayName = teamName
				shares = append(shares, sh)
			}
		}
		logDBErr(tRows.Err())
		_ = tRows.Close()
	}

	return shares, nil
}

func (s *Store) CreateDocTeamShare(currentUserID, docID, teamID, permission string) (*domain.DocShare, error) {
	doc, err := s.GetDocumentByID(currentUserID, docID)
	if err != nil {
		return nil, err
	}
	if !doc.IsOwner {
		return nil, fmt.Errorf("nur der Eigentümer kann Freigaben verwalten")
	}

	cleanTeamID := strings.TrimSpace(teamID)
	var teamName string
	err = s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, cleanTeamID).Scan(&teamName)
	if err != nil || !s.CanShareWith(currentUserID, "team", cleanTeamID) {
		return nil, ErrTargetNotFound
	}

	permission = normalizeSharePermission(permission)

	now := domain.NowISO()
	shareID := domain.NewID("share")
	_, err = s.db.Exec(
		`INSERT INTO doc_team_shares (id, doc_id, team_id, permission, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(doc_id, team_id) DO UPDATE SET permission = excluded.permission`,
		shareID, docID, cleanTeamID, permission, now, currentUserID,
	)
	if err != nil {
		return nil, err
	}

	return &domain.DocShare{
		ID:          shareID,
		DocID:       docID,
		TargetType:  "team",
		TargetID:    cleanTeamID,
		TargetName:  teamName,
		DisplayName: teamName,
		Permission:  permission,
		CreatedBy:   currentUserID,
		CreatedAt:   now,
	}, nil
}

// normalizeSharePermission maps share roles from the API to the stored values: "write" (editor) or "read" (viewer).
func normalizeSharePermission(p string) string {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "write", "editor":
		return "write"
	}
	return "read"
}

func (s *Store) CreateDocShare(currentUserID, docID, targetUserIdentifier, permission string) (*domain.DocShare, error) {
	doc, err := s.GetDocumentByID(currentUserID, docID)
	if err != nil {
		return nil, err
	}
	if doc.IsArchived {
		return nil, ErrDocInTrash
	}
	if !doc.IsOwner {
		return nil, fmt.Errorf("nur der Eigentümer kann Freigaben verwalten")
	}

	cleanTarget := strings.TrimSpace(targetUserIdentifier)

	// If identifier looks like a team or is prefixed with team_, route to CreateDocTeamShare
	if strings.HasPrefix(cleanTarget, "team_") {
		return s.CreateDocTeamShare(currentUserID, docID, cleanTarget, permission)
	}

	permission = normalizeSharePermission(permission)

	// Resolve target user by ID, username, or Email
	var targetUser *domain.User
	if strings.HasPrefix(cleanTarget, "usr_") {
		targetUser, _ = s.GetUserByID(cleanTarget)
	}
	if targetUser == nil {
		targetUser, _ = s.GetUserByLogin(cleanTarget)
	}
	if targetUser == nil {
		targetUser, err = s.GetUserByID(cleanTarget)
	}
	if err != nil || targetUser == nil {
		// Check if it's a team ID that doesn't start with team_
		var tName string
		if s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, cleanTarget).Scan(&tName) == nil {
			return s.CreateDocTeamShare(currentUserID, docID, cleanTarget, permission)
		}
		return nil, ErrTargetNotFound
	}

	if targetUser.ID == doc.UserID {
		return nil, fmt.Errorf("dokument gehört bereits diesem Benutzer")
	}
	if !s.CanShareWith(currentUserID, "user", targetUser.ID) {
		return nil, ErrTargetNotFound
	}

	now := domain.NowISO()
	shareID := domain.NewID("share")
	_, err = s.db.Exec(
		`INSERT INTO doc_shares (id, doc_id, user_id, permission, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(doc_id, user_id) DO UPDATE SET permission = excluded.permission`,
		shareID, docID, targetUser.ID, permission, now, currentUserID,
	)
	if err != nil {
		return nil, err
	}

	return &domain.DocShare{
		ID:          shareID,
		DocID:       docID,
		TargetType:  "user",
		TargetID:    targetUser.ID,
		TargetName:  targetUser.DisplayName,
		UserID:      targetUser.ID,
		UserEmail:   targetUser.Email,
		DisplayName: targetUser.DisplayName,
		Permission:  permission,
		CreatedBy:   currentUserID,
		CreatedAt:   now,
	}, nil
}

func (s *Store) DeleteDocShare(currentUserID, docID, targetID string) error {
	doc, err := s.GetDocumentByID(currentUserID, docID)
	if err != nil {
		return err
	}
	// Only the owner manages shares; everyone else can only remove their own
	if !doc.IsOwner && currentUserID != targetID {
		return fmt.Errorf("keine Berechtigung zum Entfernen der Freigabe")
	}

	cleanTarget := strings.TrimSpace(targetID)
	// Try deleting team share first
	res, err := s.db.Exec(`DELETE FROM doc_team_shares WHERE doc_id = ? AND (id = ? OR team_id = ?)`, docID, cleanTarget, cleanTarget)
	if err == nil {
		if rows, _ := res.RowsAffected(); rows > 0 {
			return nil
		}
	}

	// Fallback to user share
	_, err = s.db.Exec(`DELETE FROM doc_shares WHERE doc_id = ? AND (id = ? OR user_id = ?)`, docID, cleanTarget, cleanTarget)
	return err
}

// GetCollaborators returns the active people the user can share with (everyone visible except the user).
func (s *Store) GetCollaborators(currentUserID string) ([]domain.User, error) {
	visible, err := s.GetDiscoverableUsers(currentUserID)
	if err != nil {
		return nil, err
	}
	users := make([]domain.User, 0, len(visible))
	for _, u := range visible {
		if u.ID != currentUserID && u.IsActive {
			users = append(users, u)
		}
	}
	return users, nil
}

// ClearIcon removes the icon of a note, task list or list (created on purpose without one; the create
// functions put in a default for an empty icon).
func (s *Store) ClearIcon(table, id string) error {
	switch table {
	case "documents", "task_lists", "lists":
	default:
		return fmt.Errorf("unknown table %q", table)
	}
	_, err := s.db.Exec(`UPDATE `+table+` SET icon = '' WHERE id = ?`, id)
	return err
}
