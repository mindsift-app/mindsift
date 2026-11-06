package storage

import (
	"path/filepath"
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
