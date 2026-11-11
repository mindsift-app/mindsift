package storage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
)

// Collaborative note editing: every change to a note's blocks or title runs through collab.Apply under a
// per-document lock, is appended to doc_ops (the log) and recorded in doc_op_results (idempotency).

// ErrDocNotFound is returned when a note does not exist or the user has no access to it.
var ErrDocNotFound = errors.New("Notiz nicht gefunden oder kein Zugriff")

// ErrLogCompacted means the requested log entries were removed by compaction; the client reloads the snapshot.
var ErrLogCompacted = errors.New("Änderungsprotokoll verdichtet")

// Retention of the operation log and of tombstones (see CompactDocs).
const (
	LogRetentionShared  = 30 * 24 * time.Hour
	LogRetentionPrivate = 7 * 24 * time.Hour
	TombstoneRetention  = 30 * 24 * time.Hour
	OpResultRetention   = 90 * 24 * time.Hour
)

// Roles a user can have on a note.
const (
	DocRoleOwner  = "owner"
	DocRoleEditor = "editor"
	DocRoleViewer = "viewer"
)

// DocLogEntry is one effect from the log, as sent to clients.
type DocLogEntry struct {
	Seq      int64         `json:"seq"`
	OpID     string        `json:"opId,omitempty"`
	UserID   string        `json:"userId"`
	ClientID string        `json:"clientId"`
	Effect   collab.Effect `json:"effect"`
}

// DocSnapshot is the complete state of a note including tombstones, needed to replay later effects.
type DocSnapshot struct {
	DocID        string         `json:"docId"`
	Title        string         `json:"title"`
	TitleVersion int            `json:"titleVersion"`
	HeadSeq      int64          `json:"headSeq"`
	Blocks       []collab.Block `json:"blocks"`
}

// One writer per note at a time. A channel instead of a mutex, so a request whose client has gone can
// stop waiting (lockDocCtx) instead of queueing up behind everyone else.
var docLocks sync.Map // docID -> chan struct{} (capacity 1)

func docLock(docID string) chan struct{} {
	if ch, ok := docLocks.Load(docID); ok {
		return ch.(chan struct{})
	}
	ch, _ := docLocks.LoadOrStore(docID, make(chan struct{}, 1))
	return ch.(chan struct{})
}

func lockDoc(docID string) func() {
	ch := docLock(docID)
	ch <- struct{}{}
	return func() { <-ch }
}

// lockDocCtx is lockDoc that gives up with ctx.Err() when ctx ends (e.g. the client closed the request).
func lockDocCtx(ctx context.Context, docID string) (func(), error) {
	ch := docLock(docID)
	select {
	case ch <- struct{}{}:
		return func() { <-ch }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// readConsistent runs fn on one connection inside a deferred transaction. In WAL mode that is one
// consistent view of the database that neither waits for nor blocks writers. s.db.Begin would take the
// write lock right away (_txlock=immediate), so every reader would queue behind every write.
func (s *Store) readConsistent(ctx context.Context, fn func(q docQueryer) error) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN"); err != nil {
		return err
	}
	fnErr := fn(connQueryer{ctx: ctx, c: conn})
	if _, err := conn.ExecContext(context.Background(), "ROLLBACK"); err != nil {
		// Never hand a connection with an open transaction back to the pool
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
	}
	return fnErr
}

// connOrDB runs the docQueryer calls on the pool with a context.
func connOrDB(ctx context.Context, db *sql.DB) docQueryer { return dbCtxQueryer{ctx: ctx, db: db} }

type dbCtxQueryer struct {
	ctx context.Context
	db  *sql.DB
}

func (q dbCtxQueryer) QueryRow(query string, args ...any) *sql.Row {
	return q.db.QueryRowContext(q.ctx, query, args...)
}

func (q dbCtxQueryer) Query(query string, args ...any) (*sql.Rows, error) {
	return q.db.QueryContext(q.ctx, query, args...)
}

// connQueryer runs the docQueryer calls on one connection with a context.
type connQueryer struct {
	ctx context.Context
	c   *sql.Conn
}

func (q connQueryer) QueryRow(query string, args ...any) *sql.Row {
	return q.c.QueryRowContext(q.ctx, query, args...)
}

func (q connQueryer) Query(query string, args ...any) (*sql.Rows, error) {
	return q.c.QueryContext(q.ctx, query, args...)
}

type docQueryer interface {
	QueryRow(query string, args ...any) *sql.Row
	Query(query string, args ...any) (*sql.Rows, error)
}

// migrateDocSync adds the columns and tables of the collaboration model and converts old flat block lists.
func (s *Store) migrateDocSync() error {
	stmts := []string{
		"ALTER TABLE blocks ADD COLUMN parent_id TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE blocks ADD COLUMN order_key TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE blocks ADD COLUMN version INTEGER NOT NULL DEFAULT 1;",
		"ALTER TABLE blocks ADD COLUMN conflict_of TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE blocks ADD COLUMN conflict_author TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE blocks ADD COLUMN updated_by TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE blocks ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;",
		"CREATE INDEX IF NOT EXISTS idx_blocks_doc_parent ON blocks(document_id, parent_id);",
		"ALTER TABLE documents ADD COLUMN head_seq INTEGER NOT NULL DEFAULT 0;",
		"ALTER TABLE documents ADD COLUMN title_version INTEGER NOT NULL DEFAULT 0;",
		`CREATE TABLE IF NOT EXISTS doc_ops (
			doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			seq INTEGER NOT NULL,
			op_id TEXT NOT NULL DEFAULT '',
			user_id TEXT NOT NULL DEFAULT '',
			client_id TEXT NOT NULL DEFAULT '',
			kind TEXT NOT NULL,
			block_id TEXT NOT NULL DEFAULT '',
			payload TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (doc_id, seq)
		);`,
		`CREATE TABLE IF NOT EXISTS doc_op_results (
			op_id TEXT PRIMARY KEY,
			doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL DEFAULT '',
			result TEXT NOT NULL,
			created_at TEXT NOT NULL
		);`,
		"CREATE INDEX IF NOT EXISTS idx_doc_op_results_doc ON doc_op_results(doc_id);",
		"ALTER TABLE blocks ADD COLUMN deleted_at TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE documents ADD COLUMN log_floor INTEGER NOT NULL DEFAULT 0;",
		"CREATE INDEX IF NOT EXISTS idx_doc_ops_created ON doc_ops(created_at);",
		"CREATE INDEX IF NOT EXISTS idx_doc_op_results_created ON doc_op_results(created_at);",
	}
	for _, q := range stmts {
		if err := s.execSchemaStatement(q); err != nil {
			return err
		}
	}
	// Tombstones from before deleted_at existed start their retention now
	if _, err := s.db.Exec(`UPDATE blocks SET deleted_at = ? WHERE deleted = 1 AND deleted_at = ''`, domain.NowISO()); err != nil {
		return err
	}
	s.backfillBlockTree()
	return nil
}

// backfillBlockTree converts blocks stored as a flat list (level + position) into parent_id + order_key.
func (s *Store) backfillBlockTree() {
	rows, err := s.db.Query(`SELECT DISTINCT document_id FROM blocks WHERE order_key = ''`)
	if dbFailed(err) {
		return
	}
	var docIDs []string
	for rows.Next() {
		var id string
		if !dbFailed(rows.Scan(&id)) {
			docIDs = append(docIDs, id)
		}
	}
	logDBErr(rows.Err())
	_ = rows.Close()

	for _, docID := range docIDs {
		bRows, err := s.db.Query(`SELECT id, level FROM blocks WHERE document_id = ? ORDER BY position ASC, rowid ASC`, docID)
		if dbFailed(err) {
			continue
		}
		type flat struct {
			id    string
			level int
		}
		var list []flat
		for bRows.Next() {
			var f flat
			if !dbFailed(bRows.Scan(&f.id, &f.level)) {
				list = append(list, f)
			}
		}
		logDBErr(bRows.Err())
		_ = bRows.Close()

		parents, keys := treeFromLevels(len(list), func(i int) int { return list[i].level })
		tx, err := s.db.Begin()
		if dbFailed(err) {
			continue
		}
		for i, f := range list {
			parent := ""
			if parents[i] >= 0 {
				parent = list[parents[i]].id
			}
			if _, err = tx.Exec(`UPDATE blocks SET parent_id = ?, order_key = ? WHERE id = ?`, parent, keys[i], f.id); err != nil {
				break
			}
		}
		if err == nil {
			err = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
		if err != nil {
			slog.Error("Converting the block structure failed", "doc_id", docID, "error", err)
		}
	}
}

// treeFromLevels turns a flat list with nesting levels into parent indices (-1 = top level) and
// sequential order keys per parent. Levels deeper than possible are clamped.
func treeFromLevels(n int, level func(int) int) ([]int, []string) {
	parents := make([]int, n)
	keys := make([]string, n)
	lastKey := map[int]string{}
	var stack []int // stack[l] = index of the last block at level l
	for i := 0; i < n; i++ {
		lvl := level(i)
		if lvl < 0 {
			lvl = 0
		}
		if lvl > len(stack) {
			lvl = len(stack)
		}
		stack = stack[:lvl]
		parent := -1
		if lvl > 0 {
			parent = stack[lvl-1]
		}
		stack = append(stack, i)
		parents[i] = parent
		k, _ := collab.KeyBetween(lastKey[parent], "")
		lastKey[parent] = k
		keys[i] = k
	}
	return parents, keys
}

func loadCollabDoc(q docQueryer, docID string) (*collab.Doc, int64, error) {
	d := collab.NewDoc()
	var head int64
	err := q.QueryRow(`SELECT title, title_version, head_seq FROM documents WHERE id = ?`, docID).Scan(&d.Title, &d.TitleVersion, &head)
	if err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(
		`SELECT id, parent_id, order_key, type, content, checked, collapsed, lang, conflict_of, conflict_author, version, deleted, updated_by
		 FROM blocks WHERE document_id = ?`, docID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		b := &collab.Block{}
		var chk, col, del int
		if err := rows.Scan(&b.ID, &b.ParentID, &b.OrderKey, &b.Type, &b.Content, &chk, &col, &b.Props.Lang,
			&b.Props.ConflictOf, &b.Props.ConflictAuthor, &b.Version, &del, &b.UpdatedBy); err != nil {
			return nil, 0, err
		}
		b.Props.Checked, b.Props.Collapsed, b.Deleted = chk != 0, col != 0, del != 0
		d.Blocks[b.ID] = b
	}
	return d, head, rows.Err()
}

// flatDocumentBlocks converts the live tree into the flat list (level + position) the existing API returns.
func flatDocumentBlocks(docID string, d *collab.Doc) []domain.DocumentBlock {
	flat := d.Flatten()
	out := make([]domain.DocumentBlock, len(flat))
	for i, f := range flat {
		out[i] = domain.DocumentBlock{
			ID: f.ID, DocumentID: docID, Type: f.Type, Content: f.Content, Checked: f.Props.Checked,
			Lang: f.Props.Lang, Level: f.Level, Position: float64((i + 1) * 1000), Collapsed: f.Props.Collapsed,
		}
	}
	return out
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ApplyDocOps applies client operations to a note. Operations whose opId was already processed return
// the stored result without being applied again, so clients can safely resend after lost responses.
func (s *Store) ApplyDocOps(docID string, a collab.Actor, ops []collab.Op, leases collab.LeaseView) ([]collab.Result, int64, error) {
	return s.ApplyDocOpsCtx(context.Background(), docID, a, ops, leases)
}

// ApplyDocOpsCtx is ApplyDocOps that stops waiting for the note (and the database) when ctx ends; the
// client resends its operations, and their opIds keep them from being applied twice.
func (s *Store) ApplyDocOpsCtx(ctx context.Context, docID string, a collab.Actor, ops []collab.Op, leases collab.LeaseView) ([]collab.Result, int64, error) {
	return s.applyDocChangeCtx(ctx, docID, a, leases, func(*collab.Doc) []collab.Op { return ops })
}

// applyDocChange builds operations from the current state (under the document lock) and applies them.
func (s *Store) applyDocChange(docID string, a collab.Actor, leases collab.LeaseView, build func(*collab.Doc) []collab.Op) ([]collab.Result, int64, error) {
	return s.applyDocChangeCtx(context.Background(), docID, a, leases, build)
}

func (s *Store) applyDocChangeCtx(ctx context.Context, docID string, a collab.Actor, leases collab.LeaseView, build func(*collab.Doc) []collab.Op) ([]collab.Result, int64, error) {
	unlock, err := lockDocCtx(ctx, docID)
	if err != nil {
		return nil, 0, err
	}
	defer unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()

	doc, head, err := loadCollabDoc(tx, docID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, 0, ErrDocNotFound
		}
		return nil, 0, err
	}
	before := doc.Clone()
	startHead := head
	env := collab.Env{
		Leases: leases,
		IDTaken: func(id string) bool {
			var owner string
			err := tx.QueryRow(`SELECT document_id FROM blocks WHERE id = ?`, id).Scan(&owner)
			return dbFailed(err) || (err == nil && owner != docID) // an id that cannot be checked counts as taken
		},
	}
	now := domain.NowISO()
	ops := build(doc)
	results := make([]collab.Result, 0, len(ops))

	for _, op := range ops {
		if op.OpID == "" || len(op.OpID) > 100 {
			results = append(results, collab.Result{OpID: op.OpID, Status: collab.StatusRejected, Reason: "invalid_op_id"})
			continue
		}
		var stored, storedDoc string
		err := tx.QueryRow(`SELECT result, doc_id FROM doc_op_results WHERE op_id = ?`, op.OpID).Scan(&stored, &storedDoc)
		if err == nil {
			var res collab.Result
			if storedDoc != docID || json.Unmarshal([]byte(stored), &res) != nil {
				res = collab.Result{OpID: op.OpID, Status: collab.StatusRejected, Reason: "op_id_reused"}
			}
			results = append(results, res)
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, 0, err
		}

		effects, res := collab.Apply(doc, op, a, env)
		for _, e := range effects {
			head++
			payload, _ := json.Marshal(e)
			if _, err := tx.Exec(
				`INSERT INTO doc_ops (doc_id, seq, op_id, user_id, client_id, kind, block_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				docID, head, op.OpID, a.UserID, a.ClientID, e.Kind, e.BlockID, string(payload), now,
			); err != nil {
				return nil, 0, err
			}
		}
		if len(effects) > 0 {
			res.Seq = head
		}
		resJSON, _ := json.Marshal(res)
		if _, err := tx.Exec(`INSERT INTO doc_op_results (op_id, doc_id, user_id, result, created_at) VALUES (?, ?, ?, ?, ?)`,
			op.OpID, docID, a.UserID, string(resJSON), now); err != nil {
			return nil, 0, err
		}
		results = append(results, res)
	}

	if head != startHead {
		if err := persistDocState(tx, docID, before, doc, head, now); err != nil {
			return nil, 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	return results, head, nil
}

// persistDocState writes changed blocks and refreshes data derived from the note (markdown, search text, tags).
func persistDocState(tx *sql.Tx, docID string, before, after *collab.Doc, head int64, now string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO blocks (id, document_id, parent_id, order_key, type, content, checked, collapsed, lang,
		                    conflict_of, conflict_author, version, deleted, deleted_at, updated_by, level, position)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
		ON CONFLICT(id) DO UPDATE SET
			parent_id = excluded.parent_id, order_key = excluded.order_key, type = excluded.type,
			content = excluded.content, checked = excluded.checked, collapsed = excluded.collapsed,
			lang = excluded.lang, conflict_of = excluded.conflict_of, conflict_author = excluded.conflict_author,
			version = excluded.version, deleted = excluded.deleted, updated_by = excluded.updated_by,
			deleted_at = CASE WHEN excluded.deleted = 0 THEN '' WHEN blocks.deleted = 1 THEN blocks.deleted_at ELSE excluded.deleted_at END
		WHERE blocks.document_id = excluded.document_id`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	tagsChanged := false
	for id, b := range after.Blocks {
		if old, ok := before.Blocks[id]; ok && *old == *b {
			continue
		}
		tagsChanged = true
		deletedAt := ""
		if b.Deleted {
			deletedAt = now
		}
		if _, err := stmt.Exec(b.ID, docID, b.ParentID, b.OrderKey, b.Type, b.Content, boolInt(b.Props.Checked),
			boolInt(b.Props.Collapsed), b.Props.Lang, b.Props.ConflictOf, b.Props.ConflictAuthor, b.Version,
			boolInt(b.Deleted), deletedAt, b.UpdatedBy); err != nil {
			return err
		}
	}
	for id := range before.Blocks {
		if _, ok := after.Blocks[id]; !ok {
			if _, err := tx.Exec(`DELETE FROM blocks WHERE id = ? AND document_id = ?`, id, docID); err != nil {
				return err
			}
		}
	}

	flat := flatDocumentBlocks(docID, after)
	var plain strings.Builder
	for _, b := range flat {
		text := b.Content
		if b.Type == drawing.BlockType {
			text = strings.Join(drawing.Texts(b.Content), "\n")
		}
		if text != "" {
			plain.WriteString(text)
			plain.WriteString("\n")
		}
	}
	blocksJSON, _ := json.Marshal(flat)
	tagSet := map[string]bool{}
	for _, b := range flat {
		for _, tag := range domain.ExtractTags(b.Content) {
			tagSet[tag] = true
		}
	}
	tags := make([]string, 0, len(tagSet))
	for tag := range tagSet {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	tagsJSON, _ := json.Marshal(tags)
	if _, err := tx.Exec(
		`UPDATE documents SET title = ?, title_version = ?, head_seq = ?, markdown_cache = ?, content = ?, blocks_json = ?, tags = ?, updated_at = ? WHERE id = ?`,
		after.Title, after.TitleVersion, head, domain.CompileBlocksToMarkdown(flat), plain.String(), string(blocksJSON), string(tagsJSON), now, docID,
	); err != nil {
		return err
	}

	if tagsChanged {
		if _, err := tx.Exec(`DELETE FROM block_tags WHERE document_id = ?`, docID); err != nil {
			return err
		}
		for _, b := range flat {
			for _, tag := range domain.ExtractTags(b.Content) {
				if _, err := tx.Exec(`INSERT OR IGNORE INTO block_tags (tag, document_id, block_id) VALUES (?, ?, ?)`, tag, docID, b.ID); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// docTaskLinks maps block IDs of a note to the IDs of tasks created from them ("Erweitert").
func (s *Store) docTaskLinks(docID string) map[string]string {
	links := map[string]string{}
	rows, err := s.db.Query(
		`SELECT id, converted_ref_id FROM thoughts WHERE converted_type = 'document_block' AND converted_ref_id LIKE ?`,
		docID+":%")
	if dbFailed(err) {
		return links
	}
	defer rows.Close()
	for rows.Next() {
		var taskID, ref string
		if !dbFailed(rows.Scan(&taskID, &ref)) {
			if _, blockID, ok := strings.Cut(ref, ":"); ok {
				links[blockID] = taskID
			}
		}
	}
	logDBErr(rows.Err())
	return links
}

// GetThoughtByIDUnchecked loads a task without access check, for server-internal notifications.
func (s *Store) GetThoughtByIDUnchecked(thoughtID string) (*domain.Thought, error) {
	return scanThought(s.db.QueryRow(
		`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, reminders, `+originColumns("")+`
		 FROM thoughts WHERE id = ?`, thoughtID))
}

// GetDocOpsSince returns up to limit log entries after seq, plus the current head. If entries after seq
// were already compacted away it returns ErrLogCompacted (with the head): the client must reload the snapshot.
func (s *Store) GetDocOpsSince(docID string, since int64, limit int) ([]DocLogEntry, int64, error) {
	return s.GetDocOpsSinceCtx(context.Background(), docID, since, limit)
}

// GetDocOpsSinceCtx is GetDocOpsSince with a context (the request's: it stops when the client has gone).
// A missing note gives ErrDocNotFound.
func (s *Store) GetDocOpsSinceCtx(ctx context.Context, docID string, since int64, limit int) ([]DocLogEntry, int64, error) {
	var out []DocLogEntry
	var head int64
	// One consistent read, so a compaction running in between cannot leave an unnoticed gap
	err := s.readConsistent(ctx, func(q docQueryer) error {
		var floor int64
		if err := q.QueryRow(`SELECT head_seq, log_floor FROM documents WHERE id = ?`, docID).Scan(&head, &floor); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrDocNotFound
			}
			return err
		}
		if limit > 0 && since < floor {
			return ErrLogCompacted
		}
		rows, err := q.Query(
			`SELECT seq, op_id, user_id, client_id, payload FROM doc_ops WHERE doc_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
			docID, since, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = make([]DocLogEntry, 0)
		for rows.Next() {
			var e DocLogEntry
			var payload string
			if err := rows.Scan(&e.Seq, &e.OpID, &e.UserID, &e.ClientID, &payload); err != nil {
				return err
			}
			if err := json.Unmarshal([]byte(payload), &e.Effect); err != nil {
				return fmt.Errorf("log entry %d unreadable: %w", e.Seq, err)
			}
			out = append(out, e)
		}
		return rows.Err()
	})
	if errors.Is(err, ErrLogCompacted) {
		return nil, head, err
	}
	if err != nil {
		return nil, 0, err
	}
	return out, head, nil
}

// GetDocSnapshot returns the full block tree (including tombstones) and the log position it corresponds to.
func (s *Store) GetDocSnapshot(docID string) (*DocSnapshot, error) {
	return s.GetDocSnapshotCtx(context.Background(), docID)
}

// GetDocSnapshotCtx reads the note in one consistent read, without the note's write lock: opening a note
// no longer waits behind everyone typing in it.
func (s *Store) GetDocSnapshotCtx(ctx context.Context, docID string) (*DocSnapshot, error) {
	var d *collab.Doc
	var head int64
	err := s.readConsistent(ctx, func(q docQueryer) error {
		var err error
		d, head, err = loadCollabDoc(q, docID)
		return err
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrDocNotFound
		}
		return nil, err
	}
	snap := &DocSnapshot{DocID: docID, Title: d.Title, TitleVersion: d.TitleVersion, HeadSeq: head, Blocks: make([]collab.Block, 0, len(d.Blocks))}
	for _, b := range d.Blocks {
		snap.Blocks = append(snap.Blocks, *b)
	}
	sort.Slice(snap.Blocks, func(i, j int) bool { return snap.Blocks[i].ID < snap.Blocks[j].ID })
	return snap, nil
}

// DocRole returns the user's role on a note ("owner", "editor", "viewer") or "" without access.
// Sources: ownership, direct shares, team shares and shares of the shared folder the note lives in.
func (s *Store) DocRole(userID, docID string) string {
	if userID == "" {
		return ""
	}
	var ownerID, sharedFolderID, folderOwner, archivedBy string
	var archived bool
	err := s.db.QueryRow(
		`SELECT d.user_id, d.shared_folder_id, COALESCE(wsf.owner_id, ''), d.is_archived, d.archived_by
		 FROM documents d LEFT JOIN workspace_shared_folders wsf ON wsf.id = d.shared_folder_id
		 WHERE d.id = ?`, docID).Scan(&ownerID, &sharedFolderID, &folderOwner, &archived, &archivedBy)
	if err != nil {
		logDBErr(err)
		return ""
	}
	if archived {
		// In the trash: read-only for the owner and whoever trashed it, hidden from everyone else
		if ownerID == userID || archivedBy == userID {
			return DocRoleViewer
		}
		return ""
	}
	if ownerID == userID {
		return DocRoleOwner
	}
	if folderOwner == userID {
		return DocRoleEditor
	}
	rows, err := s.db.Query(
		`SELECT permission FROM doc_shares WHERE doc_id = ? AND user_id = ?
		 UNION ALL SELECT dts.permission FROM doc_team_shares dts JOIN team_members tm ON tm.team_id = dts.team_id
		           WHERE dts.doc_id = ? AND tm.user_id = ?
		 UNION ALL SELECT wfs.permission FROM workspace_folder_shares wfs
		           WHERE wfs.folder_id = ? AND wfs.folder_id != '' AND (
		                 (wfs.target_type = 'user' AND wfs.target_id = ?)
		              OR (wfs.target_type = 'team' AND wfs.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?)))`,
		docID, userID, docID, userID, sharedFolderID, userID, userID)
	if dbFailed(err) {
		return ""
	}
	defer rows.Close()
	role := ""
	for rows.Next() {
		var p string
		if dbFailed(rows.Scan(&p)) {
			continue
		}
		if p == "write" {
			return DocRoleEditor
		}
		role = DocRoleViewer
	}
	logDBErr(rows.Err())
	return role
}

// CanEditDoc reports whether the role allows changing a note's content.
func CanEditDoc(role string) bool {
	return role == DocRoleOwner || role == DocRoleEditor
}

// IsDocShared reports whether anyone besides the owner can access the note. When the database cannot
// say, the note counts as shared (its log is kept as long as that of a shared one).
func (s *Store) IsDocShared(docID string) bool {
	var n int
	err := s.db.QueryRow(
		`SELECT (SELECT COUNT(*) FROM doc_shares WHERE doc_id = ?)
		      + (SELECT COUNT(*) FROM doc_team_shares WHERE doc_id = ?)
		      + (SELECT COUNT(*) FROM documents d JOIN workspace_folder_shares wfs ON wfs.folder_id = d.shared_folder_id
		         WHERE d.id = ? AND d.shared_folder_id != '')`,
		docID, docID, docID).Scan(&n)
	return dbFailed(err) || n > 0
}

// SetBlockChecked ticks or unticks a block through the log (server-side change, e.g. a linked task was
// completed). Returns true if the block changed.
func (s *Store) SetBlockChecked(userID, docID, blockID string, checked bool) bool {
	a := collab.Actor{UserID: userID, ClientID: "server"}
	results, _, err := s.applyDocChange(docID, a, nil, func(d *collab.Doc) []collab.Op {
		b, ok := d.Blocks[blockID]
		if !ok || b.Deleted || b.Props.Checked == checked {
			return nil
		}
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: blockID, Patch: &collab.PropsPatch{Checked: &checked}}}
	})
	return err == nil && len(results) > 0 && results[0].Seq > 0
}

// --- Writing a complete block list (new notes, imports) ---

const legacyClientID = "legacy"

// replaceDocBlocksInDB stores a complete flat block list (initial blocks of a new note, old blocks_json data)
// by diffing it against the current tree and applying the difference as regular operations.
func (s *Store) replaceDocBlocksInDB(docID, userID string, blocks []domain.DocumentBlock, _ string) {
	blocks = s.renameForeignBlockIDs(docID, blocks)
	a := collab.Actor{UserID: userID, ClientID: legacyClientID}
	if _, _, err := s.applyDocChange(docID, a, nil, func(d *collab.Doc) []collab.Op { return legacyOps(d, blocks) }); err != nil {
		slog.Error("Saving the note failed", "doc_id", docID, "error", err)
	}
}

// renameForeignBlockIDs gives new IDs to blocks whose ID already belongs to another note (e.g. fixed IDs of
// starter content or copied blocks). Block IDs are global, so keeping them would make the insert fail.
func (s *Store) renameForeignBlockIDs(docID string, blocks []domain.DocumentBlock) []domain.DocumentBlock {
	out := blocks
	copied := false
	for i, b := range blocks {
		id := strings.TrimSpace(b.ID)
		if id == "" {
			continue
		}
		var owner string
		err := s.db.QueryRow(`SELECT document_id FROM blocks WHERE id = ?`, id).Scan(&owner)
		if !dbFailed(err) && (err != nil || owner == docID) { // free or this note's own; an id that cannot be checked gets a new one
			continue
		}
		if !copied {
			out = append([]domain.DocumentBlock(nil), blocks...)
			copied = true
		}
		out[i].ID = domain.NewID("blk")
	}
	return out
}

// applyLegacyTitle records a title change made through PUT /documents/{id} in the log.
func (s *Store) applyLegacyTitle(docID, userID, title string) {
	a := collab.Actor{UserID: userID, ClientID: legacyClientID}
	if _, _, err := s.applyDocChange(docID, a, nil, func(d *collab.Doc) []collab.Op {
		if d.Title == title {
			return nil
		}
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpSetTitle, BaseVersion: d.TitleVersion, Title: &title}}
	}); err != nil {
		slog.Error("Saving the note title failed", "doc_id", docID, "error", err)
	}
}

// legacyOps computes the operations that turn the current tree into the given flat list.
// Last writer wins, exactly like the old whole-document save.
func legacyOps(d *collab.Doc, blocks []domain.DocumentBlock) []collab.Op {
	// Normalize IDs (missing or duplicated IDs get new ones)
	seen := make(map[string]bool, len(blocks))
	list := make([]domain.DocumentBlock, len(blocks))
	for i, b := range blocks {
		id := strings.TrimSpace(b.ID)
		if id == "" || seen[id] {
			id = domain.NewID("blk")
		}
		seen[id] = true
		b.ID = id
		if b.Type == "" {
			b.Type = "bullet"
		}
		list[i] = b
	}

	parentIdx, _ := treeFromLevels(len(list), func(i int) int { return list[i].Level })
	parentOf := make([]string, len(list))
	children := map[string][]int{}
	for i := range list {
		if parentIdx[i] >= 0 {
			parentOf[i] = list[parentIdx[i]].ID
		}
		children[parentOf[i]] = append(children[parentOf[i]], i)
	}
	keys := make([]string, len(list))
	for parent, idxs := range children {
		assignKeys(d, parent, idxs, list, keys)
	}

	var ops []collab.Op
	newOp := func(op collab.Op) {
		op.OpID = domain.NewID("op")
		ops = append(ops, op)
	}
	wanted := make(map[string]bool, len(list))
	for i, b := range list {
		wanted[b.ID] = true
		parent := parentOf[i]
		patch := &collab.PropsPatch{Type: &list[i].Type, Checked: &list[i].Checked, Collapsed: &list[i].Collapsed, Lang: &list[i].Lang}
		cur, exists := d.Blocks[b.ID]
		if !exists {
			content := b.Content
			props := collab.Props{Checked: b.Checked, Collapsed: b.Collapsed, Lang: b.Lang}
			newOp(collab.Op{Kind: collab.OpInsert, BlockID: b.ID, ParentID: &parent, OrderKey: keys[i], Type: b.Type, Content: &content, Props: &props})
			continue
		}
		if cur.Deleted {
			newOp(collab.Op{Kind: collab.OpRestore, IDs: []string{b.ID}})
		}
		if cur.ParentID != parent || cur.OrderKey != keys[i] || cur.Deleted {
			newOp(collab.Op{Kind: collab.OpMove, BlockID: b.ID, ParentID: &parent, OrderKey: keys[i]})
		}
		if cur.Content != b.Content {
			content := b.Content
			newOp(collab.Op{Kind: collab.OpSetContent, BlockID: b.ID, BaseVersion: cur.Version, Content: &content})
		}
		if cur.Type != b.Type || cur.Props.Checked != b.Checked || cur.Props.Collapsed != b.Collapsed || cur.Props.Lang != b.Lang {
			newOp(collab.Op{Kind: collab.OpSetProps, BlockID: b.ID, Patch: patch})
		}
	}
	// Deletes last, after moves have rescued wanted children out of deleted branches
	for _, fb := range d.Flatten() {
		if !wanted[fb.ID] {
			newOp(collab.Op{Kind: collab.OpDelete, BlockID: fb.ID})
		}
	}
	return ops
}

// assignKeys picks order keys for the children idxs of parent. Existing keys that are already in the right
// relative order (longest increasing subsequence) are kept, so unchanged blocks do not show up as moves.
func assignKeys(d *collab.Doc, parent string, idxs []int, list []domain.DocumentBlock, keys []string) {
	n := len(idxs)
	existing := make([]string, n)
	for j, i := range idxs {
		if b, ok := d.Blocks[list[i].ID]; ok && !b.Deleted && b.ParentID == parent {
			existing[j] = b.OrderKey
		}
	}
	keep := longestIncreasing(existing)
	for j := 0; j < n; {
		if keep[j] {
			keys[idxs[j]] = existing[j]
			j++
			continue
		}
		start := j
		for j < n && !keep[j] {
			j++
		}
		left, right := "", ""
		if start > 0 {
			left = keys[idxs[start-1]]
		}
		if j < n {
			right = existing[j]
		}
		fresh, err := collab.KeysBetween(left, right, j-start)
		if err != nil {
			fresh, _ = collab.KeysBetween(left, "", j-start)
		}
		for k := start; k < j; k++ {
			keys[idxs[k]] = fresh[k-start]
		}
	}
}

// longestIncreasing marks a longest strictly increasing subsequence of the non-empty keys.
func longestIncreasing(keys []string) []bool {
	n := len(keys)
	keep := make([]bool, n)
	tails := []int{}       // indices of the smallest tail for each length
	prev := make([]int, n) // predecessor in the subsequence
	for i, k := range keys {
		prev[i] = -1
		if k == "" {
			continue
		}
		lo, hi := 0, len(tails)
		for lo < hi {
			mid := (lo + hi) / 2
			if keys[tails[mid]] < k {
				lo = mid + 1
			} else {
				hi = mid
			}
		}
		if lo > 0 {
			prev[i] = tails[lo-1]
		}
		if lo == len(tails) {
			tails = append(tails, i)
		} else {
			tails[lo] = i
		}
	}
	if len(tails) > 0 {
		for i := tails[len(tails)-1]; i >= 0; i = prev[i] {
			keep[i] = true
		}
	}
	return keep
}

// CompactStats counts what one compaction run removed.
type CompactStats struct {
	Docs       int
	LogEntries int64
	Tombstones int
	OpResults  int64
	Purged     map[string]int64 // docID -> new head, for notes whose tombstones were purged
}

// CompactDocs keeps the collaboration tables small:
//   - log entries older than the retention (30 days for shared notes, 7 for private ones) are removed and
//     the note remembers the boundary in log_floor; clients that are further behind reload the snapshot,
//     their unsent changes stay queued and are sent afterwards,
//   - deleted blocks older than 30 days are purged; this is itself a log entry ("purge"), so connected
//     clients drop them without a reload,
//   - idempotency results older than 90 days are removed.
func (s *Store) CompactDocs(now time.Time) (CompactStats, error) {
	st := CompactStats{Purged: map[string]int64{}}
	ts := func(d time.Duration) string { return now.Add(-d).UTC().Format(time.RFC3339) }
	tombCutoff := ts(TombstoneRetention)
	rows, err := s.db.Query(
		`SELECT doc_id FROM doc_ops WHERE created_at < ?
		 UNION SELECT document_id FROM blocks WHERE deleted = 1 AND deleted_at != '' AND deleted_at < ?`,
		ts(LogRetentionPrivate), tombCutoff)
	if err != nil {
		return st, err
	}
	var docIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return st, err
		}
		docIDs = append(docIDs, id)
	}
	if err := rows.Err(); err != nil {
		return st, err
	}
	rows.Close()

	for _, docID := range docIDs {
		cutoff := ts(LogRetentionPrivate)
		if s.IsDocShared(docID) {
			cutoff = ts(LogRetentionShared)
		}
		removed, purged, head, err := s.compactDoc(docID, cutoff, tombCutoff, now.UTC().Format(time.RFC3339))
		if err != nil {
			return st, fmt.Errorf("compact %s: %w", docID, err)
		}
		if purged > 0 {
			st.Purged[docID] = head
		}
		if removed > 0 || purged > 0 {
			st.Docs++
		}
		st.LogEntries += removed
		st.Tombstones += purged
	}

	res, err := s.db.Exec(`DELETE FROM doc_op_results WHERE created_at < ?`, ts(OpResultRetention))
	if err != nil {
		return st, err
	}
	st.OpResults, _ = res.RowsAffected()
	return st, nil
}

func (s *Store) compactDoc(docID, logCutoff, tombCutoff, now string) (removed int64, purged int, head int64, err error) {
	unlock := lockDoc(docID)
	defer unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return 0, 0, 0, err
	}
	defer tx.Rollback()

	doc, head, err := loadCollabDoc(tx, docID)
	if err != nil {
		return 0, 0, 0, err
	}
	var candidates []string
	rows, err := tx.Query(`SELECT id FROM blocks WHERE document_id = ? AND deleted = 1 AND deleted_at != '' AND deleted_at < ?`, docID, tombCutoff)
	if err != nil {
		return 0, 0, 0, err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return 0, 0, 0, err
		}
		candidates = append(candidates, id)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, 0, err
	}
	rows.Close()
	if e := collab.Purge(doc, candidates); e != nil {
		head++
		payload, _ := json.Marshal(e)
		if _, err := tx.Exec(
			`INSERT INTO doc_ops (doc_id, seq, op_id, user_id, client_id, kind, block_id, payload, created_at) VALUES (?, ?, '', '', '', ?, '', ?, ?)`,
			docID, head, e.Kind, string(payload), now); err != nil {
			return 0, 0, 0, err
		}
		for _, id := range e.IDs {
			if _, err := tx.Exec(`DELETE FROM blocks WHERE id = ? AND document_id = ?`, id, docID); err != nil {
				return 0, 0, 0, err
			}
		}
		// Only the position changes; tombstones are not part of the note's text, so nothing derived changes
		if _, err := tx.Exec(`UPDATE documents SET head_seq = ? WHERE id = ?`, head, docID); err != nil {
			return 0, 0, 0, err
		}
		purged = len(e.IDs)
	}

	var floor int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(seq), 0) FROM doc_ops WHERE doc_id = ? AND created_at < ?`, docID, logCutoff).Scan(&floor); err != nil {
		return 0, 0, 0, err
	}
	if floor > 0 {
		res, err := tx.Exec(`DELETE FROM doc_ops WHERE doc_id = ? AND seq <= ?`, docID, floor)
		if err != nil {
			return 0, 0, 0, err
		}
		removed, _ = res.RowsAffected()
		if _, err := tx.Exec(`UPDATE documents SET log_floor = MAX(log_floor, ?) WHERE id = ?`, floor, docID); err != nil {
			return 0, 0, 0, err
		}
	}
	return removed, purged, head, tx.Commit()
}
