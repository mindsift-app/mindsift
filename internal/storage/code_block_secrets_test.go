package storage

import (
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func secretRefRows(t *testing.T, s *Store, blockID string) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM block_refs WHERE kind = 'secret' AND block_id = ?`, blockID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func typeOf(t *testing.T, s *Store, docID, blockID string) string {
	t.Helper()
	b := blocksOf(t, s, docID)[blockID]
	if b == nil {
		t.Fatalf("bullet %s not in %s", blockID, docID)
	}
	return b.Type
}

// A code block shows its text as it is and cannot show a hidden value: it keeps no reference to one
// (secrets.go). The editor puts the placeholder in itself, in the same step as the type, so undo brings
// the reference back; the server does it for every other way a reference gets into a code block.
func TestCodeBlockKeepsNoHiddenValue(t *testing.T) {
	s, anna, _ := newSecretStore(t)
	doc, _ := s.CreateDocument(anna.ID, "", "Technik", "", "", []domain.DocumentBlock{{ID: "blk_c1", Type: "bullet", Content: "x"}}, nil, false)
	x := hideValue(t, s, doc.ID, anna.ID, "10.0.0.1")
	a := collab.Actor{UserID: anna.ID, ClientID: "tab"}
	apply := func(ops ...collab.Op) []collab.Result {
		t.Helper()
		res, _, err := s.ApplyDocOps(doc.ID, a, ops, nil)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	version := func(id string) int { return blocksOf(t, s, doc.ID)[id].Version }
	setContent := func(id, text string) collab.Op {
		return collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: id, BaseVersion: version(id), Content: &text}
	}
	setType := func(id, typ string) collab.Op {
		return collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: id, Patch: &collab.PropsPatch{Type: &typ}}
	}
	withRef := "IP " + blockfmt.SecretRef(x)
	apply(setContent("blk_c1", withRef))
	if secretRefRows(t, s, "blk_c1") != 1 {
		t.Fatal("a bullet with a value is in block_refs")
	}

	// A type change on its own (an older editor, MCP): the server writes the placeholder as a change of its own
	apply(setType("blk_c1", "code"))
	if got := contentOf(t, s, doc.ID, "blk_c1"); got != "IP "+secretPlaceholder {
		t.Fatalf("a bullet turned into a code block keeps %q", got)
	}
	if secretRefRows(t, s, "blk_c1") != 0 {
		t.Error("a code block has no secret rows in block_refs")
	}

	// Undo as the editor sends it: the type first, then the text with the reference
	apply(setType("blk_c1", "bullet"), setContent("blk_c1", withRef))
	if got := contentOf(t, s, doc.ID, "blk_c1"); got != withRef || typeOf(t, s, doc.ID, "blk_c1") != "bullet" {
		t.Fatalf("undo brings the bullet back with its reference, got %q", got)
	}
	if revealIn(t, s, doc.ID, x) != "10.0.0.1" || secretRefRows(t, s, "blk_c1") != 1 {
		t.Fatal("the value is the note's again")
	}

	// The editor's way: text with the placeholder, then the type, in one batch
	apply(setContent("blk_c1", "IP "+secretPlaceholder), setType("blk_c1", "code"))
	if got := contentOf(t, s, doc.ID, "blk_c1"); got != "IP "+secretPlaceholder {
		t.Fatalf("got %q", got)
	}

	// Text written into a code block, and a new code block, from another note: placeholder, no copies
	other, _ := s.CreateDocument(anna.ID, "", "Andere", "", "", nil, nil, false)
	y := hideValue(t, s, other.ID, anna.ID, "geheim")
	values := countSecrets(t, s)
	apply(setContent("blk_c1", "token="+blockfmt.SecretRef(y)))
	root := ""
	code := "curl -H " + blockfmt.SecretRef(y)
	apply(collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: "blk_c2", ParentID: &root, OrderKey: "a5", Type: "code", Content: &code})
	if got := contentOf(t, s, doc.ID, "blk_c1"); got != "token="+secretPlaceholder {
		t.Errorf("text written into a code block: %q", got)
	}
	if got := contentOf(t, s, doc.ID, "blk_c2"); got != "curl -H "+secretPlaceholder {
		t.Errorf("a new code block: %q", got)
	}
	if n := countSecrets(t, s); n != values {
		t.Errorf("no copies for code blocks: %d values, want %d", n, values)
	}

	// A reference that only explains the syntax is code, and stays
	syntax := "Schreibweise: {{secret:id}}"
	apply(setContent("blk_c2", syntax))
	if got := contentOf(t, s, doc.ID, "blk_c2"); got != syntax {
		t.Errorf("text that is no value's reference stays: %q", got)
	}
	if secretRefRows(t, s, "blk_c2") != 0 {
		t.Error("a code block has no secret rows in block_refs")
	}

	// A new note with a code block (API, MCP, import)
	created, err := s.CreateDocument(anna.ID, "", "Neu", "", "", []domain.DocumentBlock{
		{ID: "blk_n1", Type: "code", Content: "export KEY=" + blockfmt.SecretRef(y)},
		{ID: "blk_n2", Type: "bullet", Content: "Wert " + blockfmt.SecretRef(y)},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if got := contentOf(t, s, created.ID, "blk_n1"); got != "export KEY="+secretPlaceholder {
		t.Errorf("a code block of a new note: %q", got)
	}
	ownCopy(t, s, created.ID, contentOf(t, s, created.ID, "blk_n2"), y, "geheim")
	if n := countSecrets(t, s); n != values+1 {
		t.Errorf("only the bullet gets a copy: %d values, want %d", n, values+1)
	}
}

// The placeholder is in the writer's message language, the same rule the editor follows.
func TestCodeBlockPlaceholderInTheWritersLanguage(t *testing.T) {
	s, anna, _ := newSecretStore(t)
	if err := s.SetLanguage(anna.ID, "en"); err != nil {
		t.Fatal(err)
	}
	doc, _ := s.CreateDocument(anna.ID, "", "Tech", "", "", []domain.DocumentBlock{{ID: "blk_l1", Type: "bullet", Content: "x"}}, nil, false)
	x := hideValue(t, s, doc.ID, anna.ID, "v")
	text := "key " + blockfmt.SecretRef(x)
	root := ""
	res, _, err := s.ApplyDocOps(doc.ID, collab.Actor{UserID: anna.ID, ClientID: "tab"}, []collab.Op{
		{OpID: "ins-l2", Kind: collab.OpInsert, BlockID: "blk_l2", ParentID: &root, OrderKey: "a5", Type: "code", Content: &text},
	}, nil)
	if err != nil || res[0].Status != collab.StatusApplied {
		t.Fatalf("%+v %v", res, err)
	}
	if got := contentOf(t, s, doc.ID, "blk_l2"); got != "key (hidden value not included)" {
		t.Errorf("got %q", got)
	}
}

// Migration 52: code blocks written before get the placeholder through the note's log, and block_refs
// drops their rows.
func TestMigrationClearsHiddenValuesFromCodeBlocks(t *testing.T) {
	s, anna, _ := newSecretStore(t)
	doc, _ := s.CreateDocument(anna.ID, "", "Alt", "", "", []domain.DocumentBlock{
		{ID: "blk_o1", Type: "code", Content: "a"},
		{ID: "blk_o2", Type: "bullet", Content: "b"},
	}, nil, false)
	x := hideValue(t, s, doc.ID, anna.ID, "10.0.0.1")
	// The old way: the reference stored in the code block, with its block_refs row
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`UPDATE blocks SET content = ? WHERE id = 'blk_o1'`, []any{"ssh " + blockfmt.SecretRef(x)}},
		{`INSERT INTO block_refs (block_id, document_id, kind, ref_id) VALUES ('blk_o1', ?, 'secret', ?)`, []any{doc.ID, x}},
	} {
		if _, err := s.db.Exec(q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	head := headSeq(t, s, doc.ID)
	if err := s.migrateCodeBlockSecrets(); err != nil {
		t.Fatal(err)
	}
	if got := contentOf(t, s, doc.ID, "blk_o1"); got != "ssh "+secretPlaceholder {
		t.Errorf("got %q", got)
	}
	if got := contentOf(t, s, doc.ID, "blk_o2"); got != "b" {
		t.Errorf("other bullets stay: %q", got)
	}
	if secretRefRows(t, s, "blk_o1") != 0 {
		t.Error("block_refs keeps no rows of code blocks")
	}
	if headSeq(t, s, doc.ID) != head+1 {
		t.Error("the change goes through the note's log")
	}
	// Run again: nothing left to do
	if err := s.migrateCodeBlockSecrets(); err != nil || headSeq(t, s, doc.ID) != head+1 {
		t.Errorf("a second run changes nothing (%v)", err)
	}
}

func TestCodeBlockText(t *testing.T) {
	id := blockfmt.NewSecretID()
	old := "sec_0123456789abcdef01234567"
	for _, c := range []struct{ in, want string }{
		{"no reference", "no reference"},
		{"a " + blockfmt.SecretRef(id) + " b " + blockfmt.SecretRef(old), "a (P) b (P)"},
		{"{{secret:id}} and {{secret:sec123}}", "{{secret:id}} and {{secret:sec123}}"},
	} {
		if got := codeBlockText(c.in, "(P)"); got != c.want {
			t.Errorf("codeBlockText(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if got := codeBlockText(blockfmt.SecretRef(id), strings.Repeat("x", 100)); got != "" {
		t.Errorf("a placeholder longer than the reference leaves nothing: %q", got)
	}
}
