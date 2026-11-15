package storage

import (
	"errors"
	"path/filepath"
	"testing"
)

// Organization names are unique trimmed and without regard to case; duplicates from before the check stay,
// but neither of them can be renamed to another taken name, and a free name still works
func TestOrganizationNameTaken(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "orgs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	a, err := store.CreateOrganization("Einkauf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateOrganization(" einkauf  "); !errors.Is(err, ErrOrganizationNameTaken) {
		t.Fatalf("duplicate: %v", err)
	}
	// An old duplicate, written before the check existed
	if _, err := store.db.Exec(`INSERT INTO organizations (id, name, created_at) VALUES ('org_alt', 'EINKAUF', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	orgs, _ := store.GetOrganizations()
	if len(orgs) != 2 {
		t.Fatalf("old duplicates stay: %d", len(orgs))
	}
	b, err := store.CreateOrganization("Vertrieb")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RenameOrganization(b.ID, "Einkauf"); !errors.Is(err, ErrOrganizationNameTaken) {
		t.Fatalf("rename to a taken name: %v", err)
	}
	// While the duplicate is there, the other one has the name: even the same name in other case is taken
	if err := store.RenameOrganization(a.ID, "einkauf"); !errors.Is(err, ErrOrganizationNameTaken) {
		t.Fatalf("renaming one duplicate to the name the other has: %v", err)
	}
	if err := store.RenameOrganization("org_alt", "Einkauf Süd"); err != nil {
		t.Fatalf("rename of a duplicate to a free name: %v", err)
	}
	if err := store.RenameOrganization(a.ID, "einkauf"); err != nil {
		t.Fatalf("the own name in other case once the duplicate is gone: %v", err)
	}
	// Joining twice: the second time changes nothing
	u, _ := store.CreateUser("org@example.com", "hash", "Org", "member")
	if added, err := store.JoinOrganization(a.ID, u.ID); err != nil || !added {
		t.Fatalf("first join: %v %v", added, err)
	}
	if added, err := store.JoinOrganization(a.ID, u.ID); err != nil || added {
		t.Fatalf("second join: %v %v", added, err)
	}
}
