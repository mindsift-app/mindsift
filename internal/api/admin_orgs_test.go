package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// A second organization with the same name (trimmed, any case) is refused with 409, also on rename;
// renaming to the own name in other case is fine, and duplicates from before stay as they are
func TestOrganizationNamesUnique(t *testing.T) {
	srv, _, admin := setupTestServer(t)
	router := srv.Router()
	create := func(name string) (int, map[string]any) {
		body, _ := json.Marshal(map[string]string{"name": name})
		rec := sessionCall(router, "POST", "/api/v1/admin/organizations", admin, string(body), "")
		out := map[string]any{}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	code, first := create("Vertrieb")
	if code != http.StatusCreated {
		t.Fatalf("first: %d %v", code, first)
	}
	for _, name := range []string{"Vertrieb", "  vertrieb ", "VERTRIEB"} {
		if code, res := create(name); code != http.StatusConflict || res["code"] != "organization_name_taken" || res["error"] != "Eine Organisation mit diesem Namen gibt es schon" {
			t.Fatalf("%q: %d %v", name, code, res)
		}
	}
	// Umlauts compare without regard to case as well
	if code, _ := create("Übersee"); code != http.StatusCreated {
		t.Fatalf("Übersee: %d", code)
	}
	if code, _ := create("übersee"); code != http.StatusConflict {
		t.Fatalf("übersee: %d", code)
	}
	code, second := create("Einkauf")
	if code != http.StatusCreated {
		t.Fatalf("second: %d", code)
	}
	rename := func(id, name string) (int, map[string]any) {
		body, _ := json.Marshal(map[string]string{"name": name})
		rec := sessionCall(router, "PUT", "/api/v1/admin/organizations/"+id, admin, string(body), "")
		out := map[string]any{}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	if code, res := rename(second["id"].(string), " Vertrieb"); code != http.StatusConflict || res["code"] != "organization_name_taken" {
		t.Fatalf("rename to a taken name: %d %v", code, res)
	}
	if code, _ := rename(first["id"].(string), "VERTRIEB"); code != http.StatusOK {
		t.Fatalf("rename to the own name in other case: %d", code)
	}
}

// Adding someone already in the organization changes nothing and writes no second log entry
func TestAddOrganizationMemberIdempotent(t *testing.T) {
	srv, store, admin := setupTestServer(t)
	router := srv.Router()
	org, err := store.CreateOrganization("Team Nord")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := newTestUser(t, store, "nord@example.com")
	add := func() map[string]any {
		rec := sessionCall(router, "POST", "/api/v1/admin/organizations/"+org.ID+"/members", admin, `{"userId":"`+u.ID+`"}`, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
		}
		out := map[string]any{}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	count := func() int {
		entries, err := store.AuditEntries(storage.AuditFilter{Action: storage.AuditOrgMemberAdded, Limit: 50})
		if err != nil {
			t.Fatal(err)
		}
		return len(entries)
	}
	if res := add(); res["added"] != true || count() != 1 {
		t.Fatalf("first add: %v, %d entries", res, count())
	}
	if res := add(); res["added"] != false || count() != 1 {
		t.Fatalf("second add must change nothing: %v, %d entries", res, count())
	}
	if !store.IsOrganizationMember(org.ID, u.ID) {
		t.Fatal("not a member")
	}
}
