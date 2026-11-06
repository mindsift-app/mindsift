package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// A user manager looks after members, invites and organizations, but not admins, passwords, roles,
// e-mail addresses or the server settings.
func TestUserManagerRights(t *testing.T) {
	_, store, ts, admin, adminToken := startRealtimeServer(t)
	manager, managerToken := newTestUser(t, store, "verwaltung@example.com")
	role := domain.RoleManager
	if _, err := store.UpdateUser(manager.ID, nil, nil, &role, nil, nil, nil); err != nil {
		t.Fatalf("make manager: %v", err)
	}
	member, _ := newTestUser(t, store, "mitglied@example.com")

	expect := func(resp *http.Response, want int, what string) {
		t.Helper()
		if resp.StatusCode != want {
			t.Errorf("%s: status %d, want %d", what, resp.StatusCode, want)
		}
	}
	expect(doJSON(t, ts, http.MethodGet, "/api/v1/admin/users", managerToken, nil), http.StatusOK, "list users")
	expect(doJSON(t, ts, http.MethodPost, "/api/v1/admin/invites", managerToken, map[string]any{"validDays": 3}), http.StatusCreated, "create invite")
	expect(doJSON(t, ts, http.MethodPatch, "/api/v1/admin/users/"+member.ID, managerToken, map[string]any{"isActive": false}), http.StatusOK, "lock member")
	expect(doJSON(t, ts, http.MethodPatch, "/api/v1/admin/users/"+member.ID, managerToken, map[string]any{"displayName": "Mia"}), http.StatusOK, "rename member")

	// Taking over an account by its address, handing out roles and passwords stay with admins
	expect(doJSON(t, ts, http.MethodPatch, "/api/v1/admin/users/"+member.ID, managerToken, map[string]any{"email": "boese@example.com"}), http.StatusForbidden, "change e-mail")
	expect(doJSON(t, ts, http.MethodPatch, "/api/v1/admin/users/"+member.ID, managerToken, map[string]any{"role": "admin"}), http.StatusForbidden, "give admin role")
	expect(doJSON(t, ts, http.MethodPut, "/api/v1/admin/users/"+member.ID+"/password", managerToken, map[string]any{"password": "neues-passwort-123"}), http.StatusForbidden, "set password")
	expect(doJSON(t, ts, http.MethodPatch, "/api/v1/admin/users/"+admin.ID, managerToken, map[string]any{"isActive": false}), http.StatusForbidden, "lock admin")
	expect(doJSON(t, ts, http.MethodDelete, "/api/v1/admin/users/"+admin.ID, managerToken, nil), http.StatusForbidden, "delete admin")
	expect(doJSON(t, ts, http.MethodGet, "/api/v1/admin/settings", managerToken, nil), http.StatusForbidden, "read settings")
	expect(doJSON(t, ts, http.MethodGet, "/api/v1/admin/backups", managerToken, nil), http.StatusForbidden, "list backups")

	// A user created by a manager is always a member
	resp := doJSON(t, ts, http.MethodPost, "/api/v1/admin/users", managerToken, map[string]any{
		"email": "neu@example.com", "password": "passwort-123456", "role": "admin",
	})
	expect(resp, http.StatusCreated, "create user")
	var created domain.User
	_ = json.NewDecoder(resp.Body).Decode(&created)
	if created.Role != domain.RoleMember {
		t.Errorf("a user manager created role %q, want member", created.Role)
	}

	// Organizations: add and remove members
	org, _ := store.CreateOrganization("Familie")
	expect(doJSON(t, ts, http.MethodPost, "/api/v1/admin/organizations/"+org.ID+"/members", managerToken, map[string]any{"userId": member.ID}), http.StatusOK, "add to organization")
	if !store.IsOrganizationMember(org.ID, member.ID) {
		t.Errorf("member should be in the organization")
	}
	expect(doJSON(t, ts, http.MethodDelete, "/api/v1/admin/organizations/"+org.ID+"/members/"+member.ID, managerToken, nil), http.StatusOK, "remove from organization")
	if store.IsOrganizationMember(org.ID, member.ID) {
		t.Errorf("member should have left the organization")
	}

	// Members get nothing of it, admins everything
	_, memberToken := newTestUser(t, store, "andere@example.com")
	expect(doJSON(t, ts, http.MethodGet, "/api/v1/admin/users", memberToken, nil), http.StatusForbidden, "member lists users")
	expect(doJSON(t, ts, http.MethodGet, "/api/v1/admin/settings", adminToken, nil), http.StatusOK, "admin reads settings")
}

// Without people search nobody is suggested; people are found by exact e-mail or username only, and
// those one works with together still show by name.
func TestPeopleSearchAndLookup(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	anna, annaToken := newTestUser(t, store, "anna@example.com")
	ben, _ := newTestUser(t, store, "ben@example.com")

	directory := func(token string) map[string]bool {
		t.Helper()
		var users []domain.PublicUser
		_ = json.NewDecoder(doJSON(t, ts, http.MethodGet, "/api/v1/users/directory", token, nil).Body).Decode(&users)
		out := map[string]bool{}
		for _, u := range users {
			out[u.ID] = u.Findable
		}
		return out
	}

	// Open mode with search: everyone is findable
	if d := directory(annaToken); !d[ben.ID] || !d[owner.ID] {
		t.Fatalf("with people search Anna should find Ben and the owner, got %v", d)
	}

	off := false
	sys, _ := store.GetSystemSettings()
	sys.PeopleSearch = &off
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatalf("switch off people search: %v", err)
	}
	d := directory(annaToken)
	if _, listed := d[ben.ID]; listed {
		t.Errorf("without people search Ben must not be listed for Anna, got %v", d)
	}

	// Exact lookup works; unknown and self look the same
	resp := doJSON(t, ts, http.MethodPost, "/api/v1/users/lookup", annaToken, map[string]string{"login": "BEN@example.com"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lookup by e-mail: status %d", resp.StatusCode)
	}
	var found domain.PublicUser
	_ = json.NewDecoder(resp.Body).Decode(&found)
	if found.ID != ben.ID || !found.Findable {
		t.Errorf("lookup returned %+v", found)
	}
	for _, login := range []string{"niemand@example.com", "anna@example.com", ""} {
		if resp := doJSON(t, ts, http.MethodPost, "/api/v1/users/lookup", annaToken, map[string]string{"login": login}); resp.StatusCode != http.StatusNotFound {
			t.Errorf("lookup %q: status %d, want 404", login, resp.StatusCode)
		}
	}

	// Working together on a note: the owner's collaborators see each other's names, not findable
	doc, _ := store.CreateDocument(owner.ID, "", "Anleitung", "🗒️", "", nil, nil, false)
	_, _ = store.CreateDocShare(owner.ID, doc.ID, anna.ID, "read")
	_, _ = store.CreateDocShare(owner.ID, doc.ID, ben.ID, "read")
	d = directory(annaToken)
	if findable, listed := d[ben.ID]; !listed || findable {
		t.Errorf("Ben should show by name for Anna but not be findable, got listed=%v findable=%v", listed, findable)
	}
	_ = ownerToken
}

// Organizations: a group belongs to one of its creator's organizations.
func TestGroupOrganizationChoice(t *testing.T) {
	_, store, ts, _, _ := startRealtimeServer(t)
	sys, _ := store.GetSystemSettings()
	sys.SharingMode = storage.SharingOrganizations
	_ = store.UpdateSystemSettings(sys)
	anna, annaToken := newTestUser(t, store, "anna@example.com")
	family, _ := store.CreateOrganization("Familie")
	work, _ := store.CreateOrganization("Firma")
	_ = store.AddOrganizationMember(family.ID, anna.ID)
	_ = store.AddOrganizationMember(work.ID, anna.ID)

	if resp := doJSON(t, ts, http.MethodPost, "/api/v1/teams", annaToken, map[string]string{"name": "WG"}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("with two organizations the group needs one, status %d", resp.StatusCode)
	}
	resp := doJSON(t, ts, http.MethodPost, "/api/v1/teams", annaToken, map[string]string{"name": "WG", "organizationId": family.ID})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create group in the family: status %d", resp.StatusCode)
	}
	var team domain.Team
	_ = json.NewDecoder(resp.Body).Decode(&team)
	if team.OrgID != family.ID {
		t.Errorf("group organization = %q, want the family", team.OrgID)
	}
	other, _ := store.CreateOrganization("Verein")
	if resp := doJSON(t, ts, http.MethodPost, "/api/v1/teams", annaToken, map[string]string{"name": "X", "organizationId": other.ID}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a group in someone else's organization must fail, status %d", resp.StatusCode)
	}
}
