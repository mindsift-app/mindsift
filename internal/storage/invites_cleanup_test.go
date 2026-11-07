package storage

import (
	"testing"
	"time"
)

// Used-up and expired invites stay 30 days with their removal date, then the cleanup removes them;
// open invites stay.
func TestPurgeOldInvites(t *testing.T) {
	store, admin, _ := setupTestStore(t)
	now := time.Now().UTC()

	used, _ := store.CreateUserInvite(admin.ID, "", nil, 7, 1)
	if _, err := store.ClaimUserInvite(used.ID); err != nil {
		t.Fatal(err)
	}
	open, _ := store.CreateUserInvite(admin.ID, "", nil, 7, 1)
	link, _ := store.CreateUserInvite(admin.ID, "", nil, 365, 5)
	if _, err := store.ClaimUserInvite(link.ID); err != nil {
		t.Fatal(err)
	}

	removeAt := map[string]string{}
	invites, _ := store.GetUserInvites()
	for _, inv := range invites {
		removeAt[inv.ID] = inv.RemoveAt
	}
	if removeAt[used.ID] == "" || removeAt[open.ID] != "" || removeAt[link.ID] != "" {
		t.Fatalf("only the used-up invite has a removal date: %v", removeAt)
	}
	if at, _ := time.Parse(time.RFC3339, removeAt[used.ID]); at.Sub(now) < 29*24*time.Hour || at.Sub(now) > 31*24*time.Hour {
		t.Fatalf("removal 30 days after use, got %s", removeAt[used.ID])
	}

	remaining := func(at time.Time) map[string]bool {
		t.Helper()
		if _, err := store.PurgeOldInvites(at); err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		invites, _ := store.GetUserInvites()
		for _, inv := range invites {
			out[inv.ID] = true
		}
		return out
	}
	// 20 days on: the used one stays, the open one expired 13 days ago and stays too
	if r := remaining(now.AddDate(0, 0, 20)); !r[used.ID] || !r[open.ID] || !r[link.ID] {
		t.Fatalf("nothing is due after 20 days: %v", r)
	}
	// 32 days on: the used one is gone, the expired one has 5 days left, the link is still open
	if r := remaining(now.AddDate(0, 0, 32)); r[used.ID] || !r[open.ID] || !r[link.ID] {
		t.Fatalf("after 32 days only the used invite goes: %v", r)
	}
	if r := remaining(now.AddDate(0, 0, 38)); r[open.ID] || !r[link.ID] {
		t.Fatalf("38 days on the expired invite goes, the open link stays: %v", r)
	}

	// A use given back (account not created) makes the invite usable again, without removal date
	again, _ := store.CreateUserInvite(admin.ID, "", nil, 7, 1)
	claim, _ := store.ClaimUserInvite(again.ID)
	store.ReleaseUserInvite(again.ID, claim)
	invites, _ = store.GetUserInvites()
	for _, inv := range invites {
		if inv.ID == again.ID && inv.RemoveAt != "" {
			t.Fatalf("released invite must not be due: %s", inv.RemoveAt)
		}
	}
}
