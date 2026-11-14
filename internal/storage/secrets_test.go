package storage

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// testSealKey is the SECRETS_KEY of the stores in these tests (the server passes its key the same way).
var testSealKey = []byte("0123456789abcdef0123456789abcdef")

const secretPlaceholder = "(versteckter Wert nicht übernommen)"

// newSecretStore: a store with a key, open sharing and two people.
func newSecretStore(t *testing.T) (*Store, *domain.User, *domain.User) {
	t.Helper()
	return newSecretStoreAt(t, filepath.Join(t.TempDir(), "secrets.db"))
}

func newSecretStoreAt(t *testing.T, path string) (*Store, *domain.User, *domain.User) {
	t.Helper()
	s, err := NewStore(path, WithSecretsKey(testSealKey))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	openSharing(t, s)
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	return s, anna, ben
}

// hideValue stores a value in a note the way POST /documents/{id}/secrets does and returns its id.
func hideValue(t *testing.T, s *Store, docID, userID, value string) string {
	t.Helper()
	id := NewSecretID()
	sealed, err := SealValue(testSealKey, id, value)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSecret(id, docID, userID, sealed); err != nil {
		t.Fatal(err)
	}
	return id
}

// revealIn returns the value a reference shows in a note, "" when that note has no such value (the
// rule of GET /documents/{id}/secrets/{secretId}).
func revealIn(t *testing.T, s *Store, docID, id string) string {
	t.Helper()
	sec, err := s.GetSecret(id)
	if err != nil || sec.DocumentID != docID {
		return ""
	}
	v, err := OpenValue(testSealKey, sec.ID, sec.Ciphertext)
	if err != nil {
		t.Fatalf("value %s does not open: %v", id, err)
	}
	return v
}

// refIDs: the ids of the references in a text, in order.
func refIDs(text string) []string {
	var out []string
	for _, m := range SecretRefRe.FindAllStringSubmatch(text, -1) {
		out = append(out, m[1])
	}
	return out
}

func contentOf(t *testing.T, s *Store, docID, blockID string) string {
	t.Helper()
	b := blocksOf(t, s, docID)[blockID]
	if b == nil {
		t.Fatalf("bullet %s not in %s", blockID, docID)
	}
	return b.Content
}

func countSecrets(t *testing.T, s *Store) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM note_secrets`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// ownCopy checks that the bullet's single reference is a value of its own note with the given text
// and returns its id.
func ownCopy(t *testing.T, s *Store, docID, content, original, want string) string {
	t.Helper()
	ids := refIDs(content)
	if len(ids) != 1 || ids[0] == original {
		t.Fatalf("want one reference to a copy of %s, got %q", original, content)
	}
	if got := revealIn(t, s, docID, ids[0]); got != want {
		t.Fatalf("the copy in its note shows %q, want %q", got, want)
	}
	return ids[0]
}

func insertOp(id, content string) collab.Op {
	root := ""
	return collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: id, ParentID: &root, OrderKey: "a" + id[len(id)-1:], Type: "bullet", Content: &content}
}

// Pasting a bullet with a hidden value into another note (editor sync, MCP): the note gets a value of
// its own with the same text, the bullet points to it, and the value of origin stays untouched. The
// editor sends the old reference again while its field still shows it: that gives the same copy.
func TestSecretCopiedWithABulletIntoAnotherNote(t *testing.T) {
	s, anna, _ := newSecretStore(t)
	origin, _ := s.CreateDocument(anna.ID, "", "Server", "", "", nil, nil, false)
	x := hideValue(t, s, origin.ID, anna.ID, "10.0.0.1")
	_, _ = s.CreateDocument(anna.ID, "", "Platzhalter", "", "", nil, nil, false)
	target, _ := s.CreateDocument(anna.ID, "", "Technik", "", "", nil, nil, false)
	a := collab.Actor{UserID: anna.ID, ClientID: "tab1"}

	applyOps(t, s, target.ID, a, insertOp("blk_p1", "IP "+secretRef(x)+" Port 22"))
	got := contentOf(t, s, target.ID, "blk_p1")
	cp := ownCopy(t, s, target.ID, got, x, "10.0.0.1")
	if got != "IP "+secretRef(cp)+" Port 22" {
		t.Errorf("only the reference changes: %q", got)
	}
	if sec, _ := s.GetSecret(cp); sec.SourceID != x || sec.CreatedBy != anna.ID {
		t.Errorf("copy: source %q created by %q", sec.SourceID, sec.CreatedBy)
	}
	if revealIn(t, s, target.ID, x) != "" {
		t.Error("the note reveals the value of another note")
	}
	if revealIn(t, s, origin.ID, x) != "10.0.0.1" {
		t.Error("the value of origin changed")
	}

	// The field still shows the old reference and sends it with the next keystrokes
	text := "IP " + secretRef(x) + " Port 2222"
	applyOps(t, s, target.ID, a, collab.Op{OpID: "op_again", Kind: collab.OpSetContent, BlockID: "blk_p1",
		BaseVersion: blockVersion(t, s, target.ID, "blk_p1"), Content: &text})
	if got := contentOf(t, s, target.ID, "blk_p1"); got != "IP "+secretRef(cp)+" Port 2222" {
		t.Errorf("the same reference again must give the same copy: %q", got)
	}
	// A second bullet pasted from the same value: the copy this note has already
	applyOps(t, s, target.ID, a, insertOp("blk_p2", secretRef(x)))
	if got := contentOf(t, s, target.ID, "blk_p2"); got != secretRef(cp) {
		t.Errorf("second paste: %q", got)
	}
	if n := countSecrets(t, s); n != 2 {
		t.Errorf("want the value and one copy, got %d values", n)
	}

	// The copy is a value of its own: changing it leaves the value of origin alone
	sealed, _ := SealValue(testSealKey, cp, "10.0.0.2")
	if err := s.UpdateSecret(cp, sealed); err != nil {
		t.Fatal(err)
	}
	if revealIn(t, s, origin.ID, x) != "10.0.0.1" {
		t.Error("changing the copy changed the value of origin")
	}
	// Pasting the original again after the copy changed: a new copy with the original text
	applyOps(t, s, target.ID, a, insertOp("blk_p3", secretRef(x)))
	cp2 := ownCopy(t, s, target.ID, contentOf(t, s, target.ID, "blk_p3"), x, "10.0.0.1")
	if cp2 == cp {
		t.Error("a changed copy must not stand in for the original")
	}
	// The note's own references stay as they are
	own := "Eigen " + secretRef(cp)
	applyOps(t, s, target.ID, a, insertOp("blk_p4", own))
	if got := contentOf(t, s, target.ID, "blk_p4"); got != own {
		t.Errorf("own reference: %q", got)
	}
}

// Without read access to the value's note the reference becomes a placeholder: knowing an id reveals
// nothing. A value that does not exist (deleted, another server) stays a reference that shows nothing.
func TestSecretOfAnUnreadableNoteBecomesAPlaceholder(t *testing.T) {
	s, anna, ben := newSecretStore(t)
	origin, _ := s.CreateDocument(anna.ID, "", "Annas Server", "", "", nil, nil, false)
	x := hideValue(t, s, origin.ID, anna.ID, "geheim")
	benDoc, _ := s.CreateDocument(ben.ID, "", "Bens", "", "", nil, nil, false)
	missing := NewSecretID()

	applyOps(t, s, benDoc.ID, collab.Actor{UserID: ben.ID, ClientID: "c"},
		insertOp("blk_b1", "Zugang "+secretRef(x)+" und "+secretRef(missing)))
	if got := contentOf(t, s, benDoc.ID, "blk_b1"); got != "Zugang "+secretPlaceholder+" und "+secretRef(missing) {
		t.Errorf("got %q", got)
	}
	created, _ := s.CreateDocument(ben.ID, "", "Neu", "", "", []domain.DocumentBlock{{ID: "blk_b2", Type: "bullet", Content: secretRef(x)}}, nil, false)
	if got := contentOf(t, s, created.ID, "blk_b2"); got != secretPlaceholder {
		t.Errorf("new note: %q", got)
	}
	if n := countSecrets(t, s); n != 1 {
		t.Errorf("no copy for someone without access, got %d values", n)
	}

	// Shared for reading: Ben's own note gets a copy of its own
	if _, err := s.CreateDocShare(anna.ID, origin.ID, ben.ID, "read"); err != nil {
		t.Fatal(err)
	}
	applyOps(t, s, benDoc.ID, collab.Actor{UserID: ben.ID, ClientID: "c"}, insertOp("blk_b3", secretRef(x)))
	cp := ownCopy(t, s, benDoc.ID, contentOf(t, s, benDoc.ID, "blk_b3"), x, "geheim")
	if sec, _ := s.GetSecret(cp); sec.CreatedBy != ben.ID {
		t.Errorf("the copy belongs to the one who wrote it, got %q", sec.CreatedBy)
	}
}

// The ways in besides the editor: a new note (API, MCP, imports), moving a branch, merging notes,
// extracting a branch, a task's title carried into its note.
func TestSecretCopiedOnEveryWayIn(t *testing.T) {
	s, anna, _ := newSecretStore(t)
	origin, _ := s.CreateDocument(anna.ID, "", "Server", "", "", []domain.DocumentBlock{
		{ID: "blk_o1", Type: "bullet", Content: "Router"},
		{ID: "blk_o2", Type: "bullet", Content: "Kind", Level: 1},
	}, nil, false)
	x := hideValue(t, s, origin.ID, anna.ID, "192.168.1.1")
	a := collab.Actor{UserID: anna.ID, ClientID: "tab1"}
	text := "Admin " + secretRef(x)
	applyOps(t, s, origin.ID, a, collab.Op{OpID: "op_o2", Kind: collab.OpSetContent, BlockID: "blk_o2",
		BaseVersion: blockVersion(t, s, origin.ID, "blk_o2"), Content: &text})
	if contentOf(t, s, origin.ID, "blk_o2") != text {
		t.Fatal("a reference in its own note must stay")
	}

	t.Run("new note", func(t *testing.T) {
		doc, err := s.CreateDocument(anna.ID, "", "Neu", "", "", []domain.DocumentBlock{{ID: "blk_c1", Type: "bullet", Content: text}}, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		ownCopy(t, s, doc.ID, contentOf(t, s, doc.ID, "blk_c1"), x, "192.168.1.1")
	})

	t.Run("move branch and back", func(t *testing.T) {
		target, _ := s.CreateDocument(anna.ID, "", "Ziel", "", "", nil, nil, false)
		res, err := s.MoveBranch(anna.ID, origin.ID, "blk_o1", target.ID, a, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		var movedID string
		for newID, oldID := range res.Moved {
			if oldID == "blk_o2" {
				movedID = newID
			}
		}
		cp := ownCopy(t, s, target.ID, contentOf(t, s, target.ID, movedID), x, "192.168.1.1")
		// Moving it back finds the value it was copied from
		back, err := s.MoveBranch(anna.ID, target.ID, res.RootID, origin.ID, a, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for newID, oldID := range back.Moved {
			if oldID == movedID {
				found = true
				if got := contentOf(t, s, origin.ID, newID); got != text {
					t.Errorf("moved back: %q, want the original reference", got)
				}
			}
		}
		if !found {
			t.Fatalf("bullet not moved back: %v", back.Moved)
		}
		if revealIn(t, s, target.ID, cp) != "192.168.1.1" {
			t.Error("the target keeps its copy")
		}
	})

	t.Run("merge", func(t *testing.T) {
		source, _ := s.CreateDocument(anna.ID, "", "Quelle", "", "", nil, nil, false)
		y := hideValue(t, s, source.ID, anna.ID, "token-123")
		applyOps(t, s, source.ID, a, insertOp("blk_m1", "Token "+secretRef(y)))
		target, _ := s.CreateDocument(anna.ID, "", "Sammlung", "", "", nil, nil, false)
		if _, err := s.MergeDocuments(anna.ID, source.ID, target.ID, a, nil); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, b := range blocksOf(t, s, target.ID) {
			if strings.HasPrefix(b.Content, "Token ") {
				found = true
				ownCopy(t, s, target.ID, b.Content, y, "token-123")
			}
		}
		if !found {
			t.Fatal("merged bullet missing")
		}
		// The source in the trash keeps its value
		if revealIn(t, s, source.ID, y) != "token-123" {
			t.Error("the merged note lost its value")
		}
	})

	t.Run("extract branch", func(t *testing.T) {
		doc, _, err := s.ExtractBranch(anna.ID, origin.ID, "blk_o2", a, nil)
		if err != nil {
			t.Fatal(err)
		}
		full, _ := s.GetDocumentByID(anna.ID, doc.ID)
		ownCopy(t, s, doc.ID, full.Blocks[0].Content, x, "192.168.1.1")
	})

	t.Run("task title", func(t *testing.T) {
		th, _ := s.CreateThoughtWithDetails(anna.ID, "Aufgabe", "normal", "manual", "", "", "todo", "")
		_, _ = s.UpdateThoughtTriage(anna.ID, th.ID, "keep", "task", "", "", "")
		task, err := s.UpdateThoughtTriage(anna.ID, th.ID, "keep", "document", "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		title := "Login " + secretRef(x)
		_, _ = s.UpdateThoughtDetails(anna.ID, th.ID, &title, nil, nil, nil, nil, nil, nil, nil, nil)
		s.SyncTaskToDoc(anna.ID, th.ID)
		got := contentOf(t, s, task.DocID, task.BlockID)
		cp := ownCopy(t, s, task.DocID, got, x, "192.168.1.1")
		before := countSecrets(t, s)
		// The task keeps the old reference; carrying it in again changes nothing
		s.SyncTaskToDoc(anna.ID, th.ID)
		if again := contentOf(t, s, task.DocID, task.BlockID); again != "Login "+secretRef(cp) || countSecrets(t, s) != before {
			t.Errorf("carried in again: %q, %d values (before %d)", again, countSecrets(t, s), before)
		}
	})

	t.Run("import", func(t *testing.T) {
		exp := domain.FullExport{ExportedAt: "2026-11-14T00:00:00Z", Version: "test", Documents: []domain.Document{{
			Title: "Wiederhergestellt", IsOwner: true, Blocks: []domain.DocumentBlock{{Type: "bullet", Content: text}},
		}}}
		data, _ := json.Marshal(exp)
		plan, err := PlanMindSiftJSONImport(data)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.ApplyImport(anna.ID, plan); err != nil {
			t.Fatal(err)
		}
		docs, _ := s.GetDocuments(anna.ID)
		for _, d := range docs {
			if d.Title == "Wiederhergestellt" {
				full, _ := s.GetDocumentByID(anna.ID, d.ID)
				ownCopy(t, s, d.ID, full.Blocks[0].Content, x, "192.168.1.1")
				return
			}
		}
		t.Fatal("imported note missing")
	})
}

// Moving a branch and carrying a task's title write inside the change's transaction, where the gate must
// not query: a reference to a value the writer may not read still becomes the placeholder there (with a
// single connection, DB_MAX_CONNS=1, a query for its language would wait forever).
func TestSecretPlaceholderInsideTheTransaction(t *testing.T) {
	s, anna, ben := newSecretStore(t)
	annaDoc, _ := s.CreateDocument(anna.ID, "", "Annas", "", "", nil, nil, false)
	x := hideValue(t, s, annaDoc.ID, anna.ID, "privat")
	// An old reference Ben's note holds from before (written past the gate)
	source, _ := s.CreateDocument(ben.ID, "", "Quelle", "", "", nil, nil, false)
	if err := s.saveDocBlocks(source.ID, ben.ID, []domain.DocumentBlock{{ID: "blk_q1", Type: "bullet", Content: "Alt " + secretRef(x)}}); err != nil {
		t.Fatal(err)
	}
	target, _ := s.CreateDocument(ben.ID, "", "Ziel", "", "", nil, nil, false)
	res, err := s.MoveBranch(ben.ID, source.ID, "blk_q1", target.ID, collab.Actor{UserID: ben.ID, ClientID: "c"}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := contentOf(t, s, target.ID, res.RootID); got != "Alt "+secretPlaceholder {
		t.Errorf("moved bullet: %q", got)
	}

	th, _ := s.CreateThoughtWithDetails(ben.ID, "Aufgabe", "normal", "manual", "", "", "todo", "")
	_, _ = s.UpdateThoughtTriage(ben.ID, th.ID, "keep", "task", "", "", "")
	task, err := s.UpdateThoughtTriage(ben.ID, th.ID, "keep", "document", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	title := "Siehe " + secretRef(x)
	_, _ = s.UpdateThoughtDetails(ben.ID, th.ID, &title, nil, nil, nil, nil, nil, nil, nil, nil)
	s.SyncTaskToDoc(ben.ID, th.ID)
	if got := contentOf(t, s, task.DocID, task.BlockID); got != "Siehe "+secretPlaceholder {
		t.Errorf("task title: %q", got)
	}
}

// A gate looks up at most maxSecretLookups different references per request, so a bullet full of made-up
// ids costs a few queries. A reference beyond stays as it is, which reveals nothing outside its note, and the
// hourly sweep copies it.
func TestSecretGateBoundsItsWorkAndTheSweepCatchesUp(t *testing.T) {
	s, anna, _ := newSecretStore(t)
	origin, _ := s.CreateDocument(anna.ID, "", "Server", "", "", nil, nil, false)
	x := hideValue(t, s, origin.ID, anna.ID, "später")
	target, _ := s.CreateDocument(anna.ID, "", "Viele", "", "", nil, nil, false)
	var sb strings.Builder
	for i := range maxSecretLookups {
		fmt.Fprintf(&sb, "{{secret:secfake%d}} ", i)
	}
	sb.WriteString(secretRef(x))
	applyOps(t, s, target.ID, collab.Actor{UserID: anna.ID, ClientID: "a"}, insertOp("blk_v1", sb.String()))
	if contentOf(t, s, target.ID, "blk_v1") != sb.String() {
		t.Fatal("references beyond the bound must stay as they are")
	}
	if revealIn(t, s, target.ID, x) != "" {
		t.Fatal("the note reveals the value of another note")
	}
	res, err := s.SweepSecrets(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if res.Split.Copied != 1 || len(res.Split.Notes) != 1 || res.Split.Notes[0] != target.ID {
		t.Fatalf("the sweep must copy the value into the note: %+v", res.Split)
	}
	ids := refIDs(contentOf(t, s, target.ID, "blk_v1"))
	if last := ids[len(ids)-1]; last == x || revealIn(t, s, target.ID, last) != "später" {
		t.Errorf("after the sweep the bullet points to %s", last)
	}
	if again, _ := s.SweepSecrets(time.Now()); again.Split.Copied != 0 || len(again.Split.Notes) != 0 {
		t.Errorf("a second sweep copies nothing: %+v", again.Split)
	}
}

// The edge cases of the shared values are gone: purging the note of origin leaves the copy alone, and
// a copy in someone else's note stays as long as that note shows it.
func TestSecretCopiesOutliveTheirOrigin(t *testing.T) {
	s, anna, ben := newSecretStore(t)
	origin, _ := s.CreateDocument(anna.ID, "", "Server", "", "", []domain.DocumentBlock{{ID: "blk_h", Type: "bullet", Content: "Text"}}, nil, false)
	x := hideValue(t, s, origin.ID, anna.ID, "wert")
	text := secretRef(x)
	applyOps(t, s, origin.ID, collab.Actor{UserID: anna.ID, ClientID: "a"}, collab.Op{OpID: "op_h", Kind: collab.OpSetContent,
		BlockID: "blk_h", BaseVersion: blockVersion(t, s, origin.ID, "blk_h"), Content: &text})
	if _, err := s.CreateDocShare(anna.ID, origin.ID, ben.ID, "read"); err != nil {
		t.Fatal(err)
	}
	annaCopy, _ := s.CreateDocument(anna.ID, "", "Kopie", "", "", []domain.DocumentBlock{{ID: "blk_ac", Type: "bullet", Content: text}}, nil, false)
	benNote, _ := s.CreateDocument(ben.ID, "", "Bens", "", "", []domain.DocumentBlock{{ID: "blk_bc", Type: "bullet", Content: text}}, nil, false)
	annaCp := ownCopy(t, s, annaCopy.ID, contentOf(t, s, annaCopy.ID, "blk_ac"), x, "wert")
	benCp := ownCopy(t, s, benNote.ID, contentOf(t, s, benNote.ID, "blk_bc"), x, "wert")

	// Anna deletes her bullet and then her note for good
	applyOps(t, s, origin.ID, collab.Actor{UserID: anna.ID, ClientID: "a"}, collab.Op{OpID: "op_del", Kind: collab.OpDelete, BlockID: "blk_h"})
	now := time.Date(2026, 11, 14, 3, 0, 0, 0, time.UTC)
	if _, err := s.SweepSecrets(now); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteDocument(anna.ID, origin.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeDocument(anna.ID, origin.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetSecret(x); err != ErrSecretNotFound {
		t.Errorf("purging the note deletes its value, got %v", err)
	}
	if _, err := s.SweepSecrets(now.AddDate(0, 0, SecretOrphanDays+1)); err != nil {
		t.Fatal(err)
	}
	if revealIn(t, s, annaCopy.ID, annaCp) != "wert" || revealIn(t, s, benNote.ID, benCp) != "wert" {
		t.Error("copies must outlive the note of origin and the orphan period")
	}
}

// The sweep marks values no live bullet of their own note holds, forgets the mark when one holds it
// again (undo) and deletes values marked SecretOrphanDays ago; values a note shows, also one in the
// trash, stay.
func TestSecretSweepOrphansAndDeletes(t *testing.T) {
	s, anna, _ := newSecretStore(t)
	home, _ := s.CreateDocument(anna.ID, "", "Server", "", "", nil, nil, false)
	kept, gone, back := hideValue(t, s, home.ID, anna.ID, "a"), hideValue(t, s, home.ID, anna.ID, "b"), hideValue(t, s, home.ID, anna.ID, "c")
	a := collab.Actor{UserID: anna.ID, ClientID: "a"}
	applyOps(t, s, home.ID, a, insertOp("blk_k1", "IP "+secretRef(kept)), insertOp("blk_k2", "Weg "+secretRef(back)))
	applyOps(t, s, home.ID, a, collab.Op{OpID: "op_del", Kind: collab.OpDelete, BlockID: "blk_k2"})

	now := time.Date(2026, 11, 6, 3, 0, 0, 0, time.UTC)
	res, err := s.SweepSecrets(now)
	if err != nil {
		t.Fatal(err)
	}
	if res.Orphaned != 2 || res.Deleted != 0 {
		t.Fatalf("first sweep: %+v", res)
	}
	// Undo brings the deleted bullet back within the grace period: its value stays
	applyOps(t, s, home.ID, a, collab.Op{OpID: "op_undo", Kind: collab.OpRestore, IDs: []string{"blk_k2"}})
	if res, err = s.SweepSecrets(now.AddDate(0, 0, SecretOrphanDays-1)); err != nil || res.Restored != 1 {
		t.Fatalf("sweep after undo: %+v %v", res, err)
	}
	if _, err := s.SweepSecrets(now.AddDate(0, 0, SecretOrphanDays+1)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetSecret(gone); err != ErrSecretNotFound {
		t.Errorf("orphaned value must be gone after %d days, got %v", SecretOrphanDays, err)
	}
	for _, id := range []string{kept, back} {
		if _, err := s.GetSecret(id); err != nil {
			t.Errorf("value its note shows must stay: %v", err)
		}
	}

	// A note in the trash keeps its values; purging it deletes them
	if err := s.DeleteDocument(anna.ID, home.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SweepSecrets(now.AddDate(0, 0, 2*SecretOrphanDays+2)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetSecret(kept); err != nil {
		t.Errorf("a trashed note keeps its values: %v", err)
	}
	if err := s.PurgeDocument(anna.ID, home.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetSecret(kept); err != ErrSecretNotFound {
		t.Errorf("purging the note must delete its values, got %v", err)
	}
}

func TestMaskSecretRefs(t *testing.T) {
	if got := MaskSecretRefs("ssh root@{{secret:sec_ab12}} -p 22"); got != "ssh root@•••• -p 22" {
		t.Errorf("got %q", got)
	}
}

// A bullet with maxBlockRefs files has no block_refs row for a value after them. The value still counts
// as held by its note: the sweep does not mark it.
func TestSecretBeyondTheRefCapIsKept(t *testing.T) {
	s, anna, _ := newSecretStore(t)
	doc, _ := s.CreateDocument(anna.ID, "", "Bildertabelle", "", "", nil, nil, false)
	sec := hideValue(t, s, doc.ID, anna.ID, "x")
	var sb strings.Builder
	for i := range maxBlockRefs {
		id := fmt.Sprintf("med_%04x", i)
		ownMedia(t, s, anna.ID, id)
		fmt.Fprintf(&sb, "| ![%d](media:%s) |\n", i, id)
	}
	sb.WriteString("| Token " + secretRef(sec) + " |\n")
	root, content := "", sb.String()
	applyOps(t, s, doc.ID, collab.Actor{UserID: anna.ID, ClientID: "a"},
		collab.Op{OpID: "op_tbl", Kind: collab.OpInsert, BlockID: "tbl", ParentID: &root, OrderKey: "a0", Type: "table", Content: &content})
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM block_refs WHERE document_id = ? AND kind = 'secret'`, doc.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("the test needs the value beyond the cap, block_refs has %d rows for it", n)
	}
	if contentOf(t, s, doc.ID, "tbl") != content {
		t.Fatal("the bullet must keep its own value beyond the cap")
	}
	res, err := s.SweepSecrets(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if res.Orphaned != 0 {
		t.Fatalf("the sweep marked a value its note shows beyond the cap: %+v", res)
	}
}

// Migration 46 splits the shared values of older versions: a live bullet holding a value of another
// note gets a copy in its own note when its last writer may read the value's note, a placeholder when
// not; a value that does not open stays as it is. A second run changes nothing.
func TestMigrationSplitsSharedSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "split.db")
	s, anna, ben := newSecretStoreAt(t, path)
	origin, _ := s.CreateDocument(anna.ID, "", "Server", "", "", nil, nil, false)
	x := hideValue(t, s, origin.ID, anna.ID, "10.0.0.1")
	broken := NewSecretID()
	if err := s.CreateSecret(broken, origin.ID, anna.ID, "v1:kaputt"); err != nil {
		t.Fatal(err)
	}
	annaDoc, _ := s.CreateDocument(anna.ID, "", "Kopie", "", "", nil, nil, false)
	benDoc, _ := s.CreateDocument(ben.ID, "", "Bens", "", "", nil, nil, false)
	// The old way: references written as they are, past any gate
	write := func(docID, userID string, blocks ...domain.DocumentBlock) {
		t.Helper()
		if err := s.saveDocBlocks(docID, userID, blocks); err != nil {
			t.Fatal(err)
		}
	}
	write(origin.ID, anna.ID, domain.DocumentBlock{ID: "blk_m0", Type: "bullet", Content: "Original " + secretRef(x)})
	write(annaDoc.ID, anna.ID,
		domain.DocumentBlock{ID: "blk_m1", Type: "bullet", Content: "IP " + secretRef(x)},
		domain.DocumentBlock{ID: "blk_m2", Type: "bullet", Content: "Kaputt " + secretRef(broken)},
		domain.DocumentBlock{ID: "blk_m3", Type: "bullet", Content: "Nochmal " + secretRef(x)})
	write(benDoc.ID, ben.ID, domain.DocumentBlock{ID: "blk_m4", Type: "bullet", Content: "Fremd " + secretRef(x)})
	for _, q := range []string{`ALTER TABLE note_secrets DROP COLUMN source_id`, `DELETE FROM schema_migrations WHERE id = 46`} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	_ = s.Close()

	reopen := func() *Store {
		t.Helper()
		st, err := NewStore(path, WithSecretsKey(testSealKey))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = st.Close() })
		return st
	}
	s = reopen()
	m1 := contentOf(t, s, annaDoc.ID, "blk_m1")
	cp := ownCopy(t, s, annaDoc.ID, m1, x, "10.0.0.1")
	if got := contentOf(t, s, annaDoc.ID, "blk_m3"); got != "Nochmal "+secretRef(cp) {
		t.Errorf("two bullets of a note with the same value share its copy: %q", got)
	}
	if got := contentOf(t, s, benDoc.ID, "blk_m4"); got != "Fremd "+secretPlaceholder {
		t.Errorf("a writer without access to the value's note gets the placeholder: %q", got)
	}
	if got := contentOf(t, s, annaDoc.ID, "blk_m2"); got != "Kaputt "+secretRef(broken) {
		t.Errorf("a value that does not open stays as it is: %q", got)
	}
	if got := contentOf(t, s, origin.ID, "blk_m0"); got != "Original "+secretRef(x) {
		t.Errorf("the note of origin keeps its reference: %q", got)
	}
	values := countSecrets(t, s)
	if values != 3 {
		t.Errorf("want the two values and one copy, got %d", values)
	}
	// The change went through the note's log, so open editors and undo follow it
	entries, _, err := s.GetDocOpsSince(annaDoc.ID, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	logged := false
	for _, e := range entries {
		logged = logged || strings.Contains(e.Effect.Content, cp)
	}
	if !logged {
		t.Error("the split is not in the note's log")
	}

	// Idempotent: running it again changes nothing
	if _, err := s.db.Exec(`DELETE FROM schema_migrations WHERE id = 46`); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	s = reopen()
	if countSecrets(t, s) != values || contentOf(t, s, annaDoc.ID, "blk_m1") != m1 {
		t.Error("a second run of migration 46 changed something")
	}
}
