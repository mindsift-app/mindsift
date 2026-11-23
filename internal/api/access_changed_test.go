package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// Shares removed in bulk by the administration reach the people concerned as ACCESS_CHANGED, so their
// apps load their lists, notes and groups again: removing someone from an organization tells that
// organization's members (and nobody else), a stricter sharing mode every connection.
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

	// A stricter sharing mode that removes something: every connection
	if _, err := store.AddListShare(owner.ID, list.ID, "user", member.ID, "editor"); err == nil {
		t.Fatal("sharing across organizations was allowed")
	}
	sys.SharingMode = storage.SharingOpen
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "user", member.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	if r := doJSON(t, ts, http.MethodPut, "/api/v1/admin/settings", adminToken, map[string]string{"sharingMode": storage.SharingPrivate}); r.StatusCode != http.StatusOK {
		t.Fatalf("stricter sharing mode: status %d", r.StatusCode)
	}
	for who, st := range map[string]*sseStream{"the member": memberStream, "an outsider": outsiderStream} {
		if st.waitFor(t, eventAccessChanged, 10*time.Second) == nil {
			t.Fatalf("%s got no ACCESS_CHANGED after a stricter sharing mode", who)
		}
	}

	// An account deleted: its shares are gone for everyone it shared with, every connection is told
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/admin/users/"+member.ID, adminToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("delete account: status %d", r.StatusCode)
	}
	if outsiderStream.waitFor(t, eventAccessChanged, 10*time.Second) == nil {
		t.Fatal("no ACCESS_CHANGED after an account was deleted")
	}
}
