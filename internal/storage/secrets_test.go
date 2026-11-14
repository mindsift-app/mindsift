package storage

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestSecretSweepOrphansMovesAndDeletes(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "secrets.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")

	kept, gone, moved := NewSecretID(), NewSecretID(), NewSecretID()
	home, _ := store.CreateDocument(anna.ID, "", "Server", "", "", []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "IP " + secretRef(kept)},
	}, nil, false)
	other, _ := store.CreateDocument(anna.ID, "", "Anderswo", "", "", []domain.DocumentBlock{
		{ID: "b2", Type: "bullet", Content: "Token " + secretRef(moved)},
	}, nil, false)
	for _, id := range []string{kept, gone, moved} {
		if err := store.CreateSecret(id, home.ID, anna.ID, "v1:x"); err != nil {
			t.Fatalf("CreateSecret: %v", err)
		}
	}

	now := time.Date(2026, 11, 6, 3, 0, 0, 0, time.UTC)
	res, err := store.SweepSecrets(now)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if res.Orphaned != 1 || res.Moved != 1 {
		t.Fatalf("first sweep: %+v", res)
	}
	if sec, _ := store.GetSecret(moved); sec.DocumentID != other.ID {
		t.Errorf("a secret referenced only in another note of its creator moves there, still in %s", sec.DocumentID)
	}
	// Still within the grace period
	if _, err := store.SweepSecrets(now.AddDate(0, 0, SecretOrphanDays-1)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetSecret(gone); err != nil {
		t.Fatalf("orphaned secret deleted too early: %v", err)
	}
	if _, err := store.SweepSecrets(now.AddDate(0, 0, SecretOrphanDays+1)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetSecret(gone); err != ErrSecretNotFound {
		t.Errorf("orphaned secret must be gone after %d days, got %v", SecretOrphanDays, err)
	}
	if _, err := store.GetSecret(kept); err != nil {
		t.Errorf("referenced secret must stay: %v", err)
	}

	// Deleting the note for good takes its secrets along
	if err := store.DeleteDocument(anna.ID, home.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetSecret(kept); err != nil {
		t.Errorf("a trashed note keeps its secrets: %v", err)
	}
	if err := store.PurgeDocument(anna.ID, home.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetSecret(kept); err != ErrSecretNotFound {
		t.Errorf("purging the note must delete its secrets, got %v", err)
	}
}

func TestMaskSecretRefs(t *testing.T) {
	if got := MaskSecretRefs("ssh root@{{secret:sec_ab12}} -p 22"); got != "ssh root@•••• -p 22" {
		t.Errorf("got %q", got)
	}
}

// A bullet with maxBlockRefs files has no block_refs row for a secret after them. The secret still
// counts as held there: purging its first note does not delete it, the sweep moves it to the note
// holding it, and that note may reveal it.
func TestSecretBeyondTheRefCapIsKept(t *testing.T) {
	s, anna := newSyncTestStore(t)
	sec := NewSecretID()
	home, _ := s.CreateDocument(anna.ID, "", "Server", "", "", []domain.DocumentBlock{
		{ID: "h1", Type: "bullet", Content: "IP " + secretRef(sec)},
	}, nil, false)
	if err := s.CreateSecret(sec, home.ID, anna.ID, "v1:x"); err != nil {
		t.Fatal(err)
	}
	var sb strings.Builder
	for i := range maxBlockRefs {
		id := fmt.Sprintf("med_%04x", i)
		ownMedia(t, s, anna.ID, id)
		fmt.Fprintf(&sb, "| ![%d](media:%s) |\n", i, id)
	}
	sb.WriteString("| Token " + secretRef(sec) + " |\n")
	other, err := s.CreateDocument(anna.ID, "", "Bildertabelle", "", "", []domain.DocumentBlock{
		{ID: "tbl", Type: "table", Content: sb.String()},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM block_refs WHERE document_id = ? AND kind = 'secret'`, other.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("the test needs the secret beyond the cap, block_refs has %d rows for it", n)
	}
	if !s.DocReferencesSecret(other.ID, sec) {
		t.Error("the note holding the secret beyond the cap does not count as holding it")
	}

	if err := s.DeleteDocument(anna.ID, home.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeDocument(anna.ID, home.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetSecret(sec); err != nil {
		t.Fatalf("purging its first note deleted a secret another note holds: %v", err)
	}
	res, err := s.SweepSecrets(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetSecret(sec); res.Moved != 1 || got == nil || got.DocumentID != other.ID {
		t.Fatalf("the sweep did not move the secret to the note holding it: %+v %+v", res, got)
	}
	if s.DocReferencesSecret(home.ID, sec) {
		t.Error("a purged note holds the secret")
	}
}
