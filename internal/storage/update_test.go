package storage

import "testing"

// The release check's answer and each admin's dismissed release live in system_settings; deleting an
// account removes its entry, and none of it shows up among the regular settings.
func TestUpdateCheckStorage(t *testing.T) {
	store := newFileStore(t)
	if store.UpdateCheckState() != "" {
		t.Fatal("no state before the first check")
	}
	if err := store.SetUpdateCheckState(`{"latest":"v1.2.0"}`); err != nil {
		t.Fatal(err)
	}
	if err := store.SetUpdateCheckState(`{"latest":"v1.3.0"}`); err != nil {
		t.Fatal(err)
	}
	if got := store.UpdateCheckState(); got != `{"latest":"v1.3.0"}` {
		t.Fatalf("state %q", got)
	}

	admin, err := store.CreateUser("admin@example.com", "hash", "Admin", "admin")
	if err != nil {
		t.Fatal(err)
	}
	other, _ := store.CreateUser("other@example.com", "hash", "Other", "admin")
	if store.UpdateDismissed(admin.ID) != "" {
		t.Fatal("nothing dismissed yet")
	}
	_ = store.SetUpdateDismissed(admin.ID, "v1.2.0")
	_ = store.SetUpdateDismissed(admin.ID, "v1.3.0")
	_ = store.SetUpdateDismissed(other.ID, "v1.2.0")
	if got := store.UpdateDismissed(admin.ID); got != "v1.3.0" {
		t.Fatalf("dismissed %q", got)
	}
	if _, err := store.GetSystemSettings(); err != nil {
		t.Fatalf("the settings still read: %v", err)
	}

	if err := store.DeleteUser(admin.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM system_settings WHERE key = ?`, updateDismissedKey(admin.ID)).Scan(&n)
	if n != 0 {
		t.Fatal("the deleted account's entry stays")
	}
	if store.UpdateDismissed(other.ID) != "v1.2.0" {
		t.Fatal("another admin's entry must stay")
	}
}
