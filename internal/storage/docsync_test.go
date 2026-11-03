package storage

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func newSyncTestStore(t *testing.T) (*Store, *domain.User) {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "sync.db"))
	openSharing(t, store)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	u, err := store.CreateUser("owner@example.com", "hash", "Owner", "member")
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	return store, u
}

func flatBlocks(spec ...[3]interface{}) []domain.DocumentBlock { // {id, level, content}
	out := make([]domain.DocumentBlock, len(spec))
	for i, s := range spec {
		out[i] = domain.DocumentBlock{ID: s[0].(string), Level: s[1].(int), Content: s[2].(string), Type: "bullet"}
	}
	return out
}

func outline(blocks []domain.DocumentBlock) [][2]interface{} {
	out := make([][2]interface{}, len(blocks))
	for i, b := range blocks {
		out[i] = [2]interface{}{b.ID, b.Level}
	}
	return out
}

func sameOutline(t *testing.T, got []domain.DocumentBlock, want []domain.DocumentBlock) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", outline(got), outline(want))
	}
	for i := range got {
		if got[i].ID != want[i].ID || got[i].Level != want[i].Level || got[i].Content != want[i].Content {
			t.Fatalf("block %d: got %v, want %v", i, outline(got), outline(want))
		}
	}
}

func headSeq(t *testing.T, s *Store, docID string) int64 {
	t.Helper()
	_, head, err := s.GetDocOpsSince(docID, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	return head
}

func TestLegacySaveRoundTripsThroughTheLog(t *testing.T) {
	s, u := newSyncTestStore(t)
	initial := flatBlocks(
		[3]interface{}{"a", 0, "Projekt"},
		[3]interface{}{"b", 1, "Aufgabe 1"},
		[3]interface{}{"c", 2, "Detail"},
		[3]interface{}{"d", 1, "Aufgabe 2"},
		[3]interface{}{"e", 0, "Anderes"},
	)
	doc, err := s.CreateDocument(u.ID, "", "Notiz", "🗒️", "", initial, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetDocumentByID(u.ID, doc.ID)
	sameOutline(t, got.Blocks, initial)

	// Saving the same content again must not produce any log entries
	head := headSeq(t, s, doc.ID)
	s.replaceDocBlocksInDB(doc.ID, u.ID, initial, "")
	if h := headSeq(t, s, doc.ID); h != head {
		t.Fatalf("unchanged save wrote %d log entries", h-head)
	}

	// Reorder, outdent, edit and delete in one save
	changed := flatBlocks(
		[3]interface{}{"e", 0, "Anderes"},
		[3]interface{}{"a", 0, "Projekt (neu)"},
		[3]interface{}{"d", 1, "Aufgabe 2"},
		[3]interface{}{"c", 1, "Detail"},
		[3]interface{}{"n", 2, "Neu"},
	)
	s.replaceDocBlocksInDB(doc.ID, u.ID, changed, "")
	got, _ = s.GetDocumentByID(u.ID, doc.ID)
	sameOutline(t, got.Blocks, changed)

	// The log alone must rebuild exactly this state
	entries, _, err := s.GetDocOpsSince(doc.ID, 0, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	replay := collab.NewDoc()
	for _, e := range entries {
		replay.ApplyEffect(e.Effect)
	}
	sameOutline(t, flatDocumentBlocks(doc.ID, replay), changed)
}

func TestApplyDocOpsIsIdempotent(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Notiz", "🗒️", "", flatBlocks([3]interface{}{"a", 0, "Start"}), nil, false)
	a := collab.Actor{UserID: u.ID, ClientID: "tab1", Name: "Owner"}
	text := "Geändert"
	op := collab.Op{OpID: "op-1", Kind: collab.OpSetContent, BlockID: "a", BaseVersion: 1, Content: &text}

	first, head1, err := s.ApplyDocOps(doc.ID, a, []collab.Op{op}, nil)
	if err != nil || first[0].Status != collab.StatusApplied {
		t.Fatalf("first: %+v %v", first, err)
	}
	// Resend after a lost response: same result, nothing applied twice
	again, head2, err := s.ApplyDocOps(doc.ID, a, []collab.Op{op}, nil)
	if err != nil || again[0] != first[0] || head2 != head1 {
		t.Fatalf("retry changed something: %+v head %d -> %d", again, head1, head2)
	}
}

func TestInsertCannotReuseBlockIDOfAnotherNote(t *testing.T) {
	s, u := newSyncTestStore(t)
	other, _ := s.CreateDocument(u.ID, "", "Andere", "🗒️", "", flatBlocks([3]interface{}{"shared_id", 0, "Fremd"}), nil, false)
	doc, _ := s.CreateDocument(u.ID, "", "Notiz", "🗒️", "", nil, nil, false)
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	content, root := "Übernahme", ""
	res, _, err := s.ApplyDocOps(doc.ID, a, []collab.Op{{OpID: "x", Kind: collab.OpInsert, BlockID: "shared_id", ParentID: &root, OrderKey: "a0", Content: &content}}, nil)
	if err != nil || res[0].Reason != "exists" {
		t.Fatalf("got %+v %v", res, err)
	}
	got, _ := s.GetDocumentByID(u.ID, other.ID)
	if got.Blocks[0].Content != "Fremd" {
		t.Fatal("block of another note was modified")
	}
}

func TestDocRole(t *testing.T) {
	s, owner := newSyncTestStore(t)
	reader, _ := s.CreateUser("reader@example.com", "hash", "Reader", "member")
	writer, _ := s.CreateUser("writer@example.com", "hash", "Writer", "member")
	stranger, _ := s.CreateUser("stranger@example.com", "hash", "Stranger", "member")
	doc, _ := s.CreateDocument(owner.ID, "", "Notiz", "🗒️", "", nil, nil, false)

	now := domain.NowISO()
	if _, err := s.db.Exec(`INSERT INTO doc_shares (id, doc_id, user_id, permission, created_at, created_by) VALUES ('s1', ?, ?, 'read', ?, ?), ('s2', ?, ?, 'write', ?, ?)`,
		doc.ID, reader.ID, now, owner.ID, doc.ID, writer.ID, now, owner.ID); err != nil {
		t.Fatal(err)
	}
	for user, want := range map[string]string{owner.ID: DocRoleOwner, writer.ID: DocRoleEditor, reader.ID: DocRoleViewer, stranger.ID: ""} {
		if got := s.DocRole(user, doc.ID); got != want {
			t.Errorf("role of %s: got %q, want %q", user, got, want)
		}
	}
	if !s.IsDocShared(doc.ID) {
		t.Error("note with shares must count as shared")
	}
}

func TestBackfillConvertsFlatBlocksToTree(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Alt", "🗒️", "", nil, nil, false)
	if _, err := s.db.Exec(`DELETE FROM blocks WHERE document_id = ?`, doc.ID); err != nil {
		t.Fatal(err)
	}
	// Rows as written by the old schema: only level and position
	for i, row := range [][2]interface{}{{"x", 0}, {"y", 1}, {"z", 1}, {"w", 0}} {
		if _, err := s.db.Exec(`INSERT INTO blocks (id, document_id, content, level, position, type) VALUES (?, ?, ?, ?, ?, 'bullet')`,
			row[0], doc.ID, row[0], row[1], (i+1)*1000); err != nil {
			t.Fatal(err)
		}
	}
	s.backfillBlockTree()
	got, _ := s.GetDocumentByID(u.ID, doc.ID)
	want := flatBlocks([3]interface{}{"x", 0, "x"}, [3]interface{}{"y", 1, "y"}, [3]interface{}{"z", 1, "z"}, [3]interface{}{"w", 0, "w"})
	sameOutline(t, got.Blocks, want)
}

func TestTaskLinksFollowTheirBlock(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Notiz", "🗒️", "", []domain.DocumentBlock{{ID: "todo1", Type: "todo", Content: "Anrufen"}}, nil, false)
	task, err := s.CreateTaskFromDocBlock(u.ID, doc.ID, "todo1", "Anrufen", false)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetDocumentByID(u.ID, doc.ID)
	if got.Blocks[0].TaskID != task.ID {
		t.Fatalf("block must carry its task ID after loading, got %q", got.Blocks[0].TaskID)
	}

	a := collab.Actor{UserID: u.ID, ClientID: "tab"}
	yes := true
	if _, _, err := s.ApplyDocOps(doc.ID, a, []collab.Op{{OpID: "chk", Kind: collab.OpSetProps, BlockID: "todo1", Patch: &collab.PropsPatch{Checked: &yes}}}, nil); err != nil {
		t.Fatal(err)
	}
	if changed := s.ReconcileDocTaskLinks(doc.ID); len(changed) != 1 {
		t.Fatalf("ticking the block must complete the task, changed=%v", changed)
	}
	if th, _ := s.GetThoughtByID(u.ID, task.ID); !th.IsCompleted {
		t.Fatal("task not completed")
	}

	if _, _, err := s.ApplyDocOps(doc.ID, a, []collab.Op{{OpID: "del", Kind: collab.OpDelete, BlockID: "todo1"}}, nil); err != nil {
		t.Fatal(err)
	}
	s.ReconcileDocTaskLinks(doc.ID)
	th, err := s.GetThoughtByID(u.ID, task.ID)
	if err != nil {
		t.Fatal("deleting the block must not delete the task")
	}
	if th.ConvertedType == "document_block" {
		t.Fatal("deleting the block must unlink the task")
	}
}

func TestFixedBlockIDsWorkInSeveralNotes(t *testing.T) {
	s, u := newSyncTestStore(t)
	other, _ := s.CreateUser("second@example.com", "hash", "Second", "member")
	blocks := flatBlocks([3]interface{}{"blk_1", 0, "Willkommen"}, [3]interface{}{"blk_2", 1, "Unterpunkt"})
	first, _ := s.CreateDocument(u.ID, "", "Start", "🗒️", "", blocks, nil, false)
	second, _ := s.CreateDocument(other.ID, "", "Start", "🗒️", "", blocks, nil, false)

	a, _ := s.GetDocumentByID(u.ID, first.ID)
	b, _ := s.GetDocumentByID(other.ID, second.ID)
	if len(a.Blocks) != 2 || len(b.Blocks) != 2 || b.Blocks[0].Content != "Willkommen" || b.Blocks[1].Level != 1 {
		t.Fatalf("second note must get its own copies of the blocks: %+v", b.Blocks)
	}
	if a.Blocks[0].ID == b.Blocks[0].ID {
		t.Fatal("block IDs must differ between notes")
	}
}

func backdate(t *testing.T, s *Store, docID string, age time.Duration) {
	t.Helper()
	old := time.Now().Add(-age).UTC().Format(time.RFC3339)
	for _, q := range []string{
		`UPDATE doc_ops SET created_at = ? WHERE doc_id = ?`,
		`UPDATE doc_op_results SET created_at = ? WHERE doc_id = ?`,
		`UPDATE blocks SET deleted_at = ? WHERE document_id = ? AND deleted = 1`,
	} {
		if _, err := s.db.Exec(q, old, docID); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCompactionKeepsStateAndForcesResync(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Notiz", "🗒️", "", flatBlocks(
		[3]interface{}{"a", 0, "Bleibt"},
		[3]interface{}{"b", 0, "Gelöscht"},
		[3]interface{}{"c", 1, "Kind von b"},
	), nil, false)
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	if res, _, _ := s.ApplyDocOps(doc.ID, a, []collab.Op{{OpID: "del-b", Kind: collab.OpDelete, BlockID: "b"}}, nil); res[0].Status != collab.StatusApplied {
		t.Fatalf("delete: %+v", res)
	}
	backdate(t, s, doc.ID, 40*24*time.Hour)
	// Idempotency results stay longer (90 days): only the very old one goes
	s.db.Exec(`UPDATE doc_op_results SET created_at = ? WHERE op_id = 'del-b'`, time.Now().Add(-100*24*time.Hour).UTC().Format(time.RFC3339))

	// A client that is up to date before compaction must only need the remaining log afterwards
	snap, _ := s.GetDocSnapshot(doc.ID)
	client := collab.NewDoc()
	for i := range snap.Blocks {
		b := snap.Blocks[i]
		client.Blocks[b.ID] = &b
	}
	text := "Frisch"
	if _, _, err := s.ApplyDocOps(doc.ID, a, []collab.Op{{OpID: "fresh", Kind: collab.OpSetContent, BlockID: "a", BaseVersion: 1, Content: &text}}, nil); err != nil {
		t.Fatal(err)
	}

	st, err := s.CompactDocs(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if st.Tombstones != 2 || st.LogEntries == 0 || st.OpResults != 1 || st.Purged[doc.ID] == 0 {
		t.Fatalf("unexpected stats: %+v", st)
	}
	var rows int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE document_id = ? AND id IN ('b', 'c')`, doc.ID).Scan(&rows)
	if rows != 0 {
		t.Fatalf("tombstones must be removed from the table, %d left", rows)
	}

	// Behind the floor: reload needed
	if _, _, err := s.GetDocOpsSince(doc.ID, 0, 100); !errors.Is(err, ErrLogCompacted) {
		t.Fatalf("client behind the floor must be told to resync, got %v", err)
	}
	entries, head, err := s.GetDocOpsSince(doc.ID, snap.HeadSeq, 100)
	if err != nil || len(entries) != 2 || entries[1].Effect.Kind != collab.OpPurge {
		t.Fatalf("fresh edit and purge must remain: %+v %v", entries, err)
	}
	for _, e := range entries {
		client.ApplyEffect(e.Effect)
	}
	final, _ := s.GetDocSnapshot(doc.ID)
	if final.HeadSeq != head || len(final.Blocks) != len(client.Blocks) {
		t.Fatalf("client after log (%d blocks) differs from snapshot (%d blocks)", len(client.Blocks), len(final.Blocks))
	}
	for _, b := range final.Blocks {
		if cb := client.Blocks[b.ID]; cb == nil || *cb != b {
			t.Fatalf("block %s differs: client %+v, server %+v", b.ID, cb, b)
		}
	}
	got, _ := s.GetDocumentByID(u.ID, doc.ID)
	sameOutline(t, got.Blocks, flatBlocks([3]interface{}{"a", 0, "Frisch"}))

	// A second run has nothing left to do
	if st, _ := s.CompactDocs(time.Now()); st.Docs != 0 || st.OpResults != 0 {
		t.Fatalf("second run changed something: %+v", st)
	}
}

func TestCompactionRetentionDependsOnSharing(t *testing.T) {
	s, u := newSyncTestStore(t)
	other, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	private, _ := s.CreateDocument(u.ID, "", "Privat", "🗒️", "", flatBlocks([3]interface{}{"p", 0, "x"}), nil, false)
	shared, _ := s.CreateDocument(u.ID, "", "Geteilt", "🗒️", "", flatBlocks([3]interface{}{"s", 0, "x"}), nil, false)
	if _, err := s.CreateDocShare(u.ID, shared.ID, other.Email, "write"); err != nil {
		t.Fatal(err)
	}
	backdate(t, s, private.ID, 10*24*time.Hour)
	backdate(t, s, shared.ID, 10*24*time.Hour)
	if _, err := s.CompactDocs(time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.GetDocOpsSince(private.ID, 0, 10); !errors.Is(err, ErrLogCompacted) {
		t.Fatalf("private note: 10 days old log must be compacted, got %v", err)
	}
	if entries, _, err := s.GetDocOpsSince(shared.ID, 0, 10); err != nil || len(entries) == 0 {
		t.Fatalf("shared note: log must be kept for 30 days: %d entries, %v", len(entries), err)
	}
}

func TestDeletedAtFollowsDeleteAndRestore(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Notiz", "🗒️", "", flatBlocks([3]interface{}{"a", 0, "x"}, [3]interface{}{"b", 0, "y"}), nil, false)
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	deletedAt := func() string {
		var v string
		_ = s.db.QueryRow(`SELECT deleted_at FROM blocks WHERE id = 'b'`).Scan(&v)
		return v
	}
	s.ApplyDocOps(doc.ID, a, []collab.Op{{OpID: "1", Kind: collab.OpDelete, BlockID: "b"}}, nil)
	first := deletedAt()
	if first == "" {
		t.Fatal("deleting must set deleted_at")
	}
	// Other changes to the tombstone (none possible here) must not restart the clock; a restore clears it
	text := "zurück"
	s.ApplyDocOps(doc.ID, a, []collab.Op{{OpID: "2", Kind: collab.OpSetContent, BlockID: "b", BaseVersion: 1, Content: &text}}, nil)
	if deletedAt() != "" {
		t.Fatal("restoring must clear deleted_at")
	}
}

func TestDemoAccountsGetSampleDataAndShares(t *testing.T) {
	s, _ := newSyncTestStore(t)
	if err := s.EnsureDemoAccounts(); err != nil {
		t.Fatal(err)
	}
	admin, _ := s.GetUserByLogin("admin")
	member, _ := s.GetUserByLogin("user")
	var docID string
	if err := s.db.QueryRow(`SELECT id FROM documents WHERE user_id = ? AND title LIKE 'Homelab 2.0%'`, admin.ID).Scan(&docID); err != nil {
		t.Fatalf("sample note missing: %v", err)
	}
	doc, err := s.GetDocumentByID(admin.ID, docID)
	// The demo speaks English
	if err != nil || len(doc.Blocks) < 20 || doc.FolderPath != "Projects" || s.Language(admin.ID) != "en" || s.Language(member.ID) != "en" {
		t.Fatalf("sample note too small or misplaced: %d blocks, folder %q, %v", len(doc.Blocks), doc.FolderPath, err)
	}
	maxLevel := 0
	for _, b := range doc.Blocks {
		if b.Level > maxLevel {
			maxLevel = b.Level
		}
	}
	if maxLevel < 2 {
		t.Fatalf("sample note must have nested bullets, max level %d", maxLevel)
	}
	if role := s.DocRole(member.ID, docID); role != DocRoleEditor {
		t.Fatalf("demo user must be editor of the sample note, got %q", role)
	}
	var tasks, inbox int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE user_id = ? AND converted_type = 'task'`, admin.ID).Scan(&tasks)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE user_id = ? AND status = 'inbox'`, admin.ID).Scan(&inbox)
	if tasks < 8 || inbox < 5 {
		t.Fatalf("expected tasks and inbox thoughts, got %d tasks, %d inbox", tasks, inbox)
	}
	// Running it again (container restart) must not seed twice
	var before, docs int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ?`, admin.ID).Scan(&before)
	if err := s.EnsureDemoAccounts(); err != nil {
		t.Fatal(err)
	}
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ?`, admin.ID).Scan(&docs)
	if docs != before || docs < 10 {
		t.Fatalf("restart seeded again or sample notes missing: %d notes before, %d after", before, docs)
	}
	// The linked example: a task tied to a note checkbox, with the checkboxes below as subtasks
	var subtasks string
	if err := s.db.QueryRow(`SELECT subtasks FROM thoughts WHERE user_id = ? AND converted_type = 'document_block' AND content LIKE 'Put the backup plan%'`, admin.ID).Scan(&subtasks); err != nil {
		t.Fatalf("linked sample task missing: %v", err)
	}
	if !strings.Contains(subtasks, "systemd timer") || !strings.Contains(subtasks, "blockId") {
		t.Fatalf("checkboxes below should be linked subtasks: %s", subtasks)
	}
}

func TestAnchorTagMigrationKeepsRealTags(t *testing.T) {
	s, u := newSyncTestStore(t)
	th, err := s.CreateThought(u.ID, "Lesen: example.com/blog#ueberschrift #lesen", "normal", "manual", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(th.Tags) != 1 || th.Tags[0] != "lesen" {
		t.Fatalf("new thoughts must not get anchor tags: %v", th.Tags)
	}
	// State before the rule change: anchor stored as tag, plus a tag added by hand
	s.db.Exec(`UPDATE thoughts SET tags = '["ueberschrift","lesen","manuell"]' WHERE id = ?`, th.ID)
	s.db.Exec(`DELETE FROM system_settings WHERE key = ?`, tagsAnchorMigrationKey)
	s.migrateAnchorTags()
	got, _ := s.GetThoughtByID(u.ID, th.ID)
	if len(got.Tags) != 2 || got.Tags[0] != "lesen" || got.Tags[1] != "manuell" {
		t.Fatalf("only the anchor tag must go: %v", got.Tags)
	}
}

// German accounts get the sample data in German, every other language in English.
func TestStarterContentLanguage(t *testing.T) {
	s, _ := newSyncTestStore(t)
	de, _ := s.CreateUser("de@example.com", "hash", "De", "member")
	it, _ := s.CreateUser("it@example.com", "hash", "It", "member")
	_ = s.SetLanguage(it.ID, "it")
	_ = s.SeedStarterContent(de)
	_ = s.SeedStarterContent(it)
	for _, c := range []struct{ user, help, list string }{{de.ID, "MindSift-Hilfe", "Wocheneinkauf"}, {it.ID, "MindSift help", "Weekly groceries"}} {
		var notes, lists int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ? AND folder_path = ?`, c.user, c.help).Scan(&notes)
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM lists WHERE user_id = ? AND title = ?`, c.user, c.list).Scan(&lists)
		if notes < 9 || lists != 1 {
			t.Errorf("%s: %d help notes in %q, %d lists %q", c.user, notes, c.help, lists, c.list)
		}
	}
	// Same structure in both languages, the linked checkbox task included
	count := func(uid string) (n int) {
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE user_id = ? AND converted_type = 'document_block'`, uid).Scan(&n)
		return n
	}
	if count(it.ID) == 0 || count(it.ID) != count(de.ID) {
		t.Errorf("linked sample tasks: English %d, German %d", count(it.ID), count(de.ID))
	}
}
