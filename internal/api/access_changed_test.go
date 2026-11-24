package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// Shares removed in bulk by the administration reach the people concerned as ACCESS_CHANGED, so their
// apps load their lists, notes and groups again: removing someone from an organization, deleting one, a
// stricter sharing mode and a deleted account tell the people whose shares or groups went, nobody else,
// and nobody at all when nothing went.
func TestAdministrationChangesSendAccessChanged(t *testing.T) {
	_, store, ts, owner, adminToken := startRealtimeServer(t)
	member, memberToken := newTestUser(t, store, "org-mitglied@example.com")
	_, outsiderToken := newTestUser(t, store, "aussen@example.com")
	org, err := store.CreateOrganization("Firma")
	if err != nil {
		t.Fatal(err)
	}
	for _, uid := range []string{owner.ID, member.ID} {
		if err := store.AddOrganizationMember(org.ID, uid); err != nil {
			t.Fatal(err)
		}
	}
	sys, err := store.GetSystemSettings()
	if err != nil {
		t.Fatal(err)
	}
	sys.SharingMode = storage.SharingOrganizations
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	list, err := store.CreateList(owner.ID, "Team-Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "user", member.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	memberStream := openSSE(t, ts, memberToken)
	outsiderStream := openSSE(t, ts, outsiderToken)

	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/admin/organizations/"+org.ID+"/members/"+member.ID, adminToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("remove organization member: status %d", r.StatusCode)
	}
	if memberStream.waitFor(t, eventAccessChanged, 10*time.Second) == nil {
		t.Fatal("the person removed from the organization got no ACCESS_CHANGED")
	}
	if m := outsiderStream.waitFor(t, eventAccessChanged, 500*time.Millisecond); m != nil {
		t.Fatal("someone outside the organization got ACCESS_CHANGED")
	}

	// Nothing to remove (no share across the organization left): nobody is told
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/admin/organizations/"+org.ID+"/members", adminToken, map[string]string{"userId": member.ID}); r.StatusCode != http.StatusOK {
		t.Fatalf("add organization member: status %d", r.StatusCode)
	}
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/admin/organizations/"+org.ID+"/members/"+member.ID, adminToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("remove organization member again: status %d", r.StatusCode)
	}
	if m := memberStream.waitFor(t, eventAccessChanged, 500*time.Millisecond); m != nil {
		t.Fatal("ACCESS_CHANGED although nothing was removed")
	}

	ownerStream := openSSE(t, ts, adminToken)
	setMode := func(mode string) {
		t.Helper()
		sys.SharingMode = mode
		if err := store.UpdateSystemSettings(sys); err != nil {
			t.Fatal(err)
		}
	}
	share := func() {
		t.Helper()
		if _, err := store.AddListShare(owner.ID, list.ID, "user", member.ID, "editor"); err != nil {
			t.Fatal(err)
		}
	}
	told := func(what string, want, notWant map[string]*sseStream) {
		t.Helper()
		for who, st := range want {
			if st.waitFor(t, eventAccessChanged, 10*time.Second) == nil {
				t.Fatalf("%s: %s got no ACCESS_CHANGED", what, who)
			}
		}
		for who, st := range notWant {
			if st.waitFor(t, eventAccessChanged, 500*time.Millisecond) != nil {
				t.Fatalf("%s: %s got ACCESS_CHANGED", what, who)
			}
		}
	}

	// Deleting an organization: the people whose share went, not the outsider
	if _, err := store.AddListShare(owner.ID, list.ID, "user", member.ID, "editor"); err == nil {
		t.Fatal("sharing across organizations was allowed")
	}
	if err := store.AddOrganizationMember(org.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	share()
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/admin/organizations/"+org.ID, adminToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("delete organization: status %d", r.StatusCode)
	}
	told("organization deleted", map[string]*sseStream{"the member": memberStream, "the owner": ownerStream},
		map[string]*sseStream{"an outsider": outsiderStream})
	// ... and nobody when it connected nothing that was shared
	empty, err := store.CreateOrganization("Leer")
	if err != nil {
		t.Fatal(err)
	}
	for _, uid := range []string{owner.ID, member.ID} {
		if err := store.AddOrganizationMember(empty.ID, uid); err != nil {
			t.Fatal(err)
		}
	}
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/admin/organizations/"+empty.ID, adminToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("delete organization without shares: status %d", r.StatusCode)
	}
	told("organization without shares deleted", nil,
		map[string]*sseStream{"the member": memberStream, "the owner": ownerStream, "an outsider": outsiderStream})

	// A stricter sharing mode that removes something: the people of the share, not the outsider
	setMode(storage.SharingOpen)
	share()
	if r := doJSON(t, ts, http.MethodPut, "/api/v1/admin/settings", adminToken, map[string]string{"sharingMode": storage.SharingPrivate}); r.StatusCode != http.StatusOK {
		t.Fatalf("stricter sharing mode: status %d", r.StatusCode)
	}
	told("stricter sharing mode", map[string]*sseStream{"the member": memberStream, "the owner": ownerStream},
		map[string]*sseStream{"an outsider": outsiderStream})

	// An account deleted: everyone it shared with is told, not the outsider
	setMode(storage.SharingOpen)
	share()
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/admin/users/"+member.ID, adminToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("delete account: status %d", r.StatusCode)
	}
	told("account deleted", map[string]*sseStream{"the owner": ownerStream}, map[string]*sseStream{"an outsider": outsiderStream})
}
