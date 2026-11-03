package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// twoUsers creates two members and their tokens on a fresh test server.
func twoUsers(t *testing.T) (srv *Server, router http.Handler, aID, aTok, bID, bTok string) {
	t.Helper()
	srv, store, _ := setupTestServer(t)
	router = srv.Router()
	a, _ := store.CreateUser("sec_a@example.com", "hash", "Sec A", "member")
	b, _ := store.CreateUser("sec_b@example.com", "hash", "Sec B", "member")
	aTok, _ = auth.GenerateToken(srv.cfg.JWTSecret, a.ID, a.Email, a.DisplayName, a.TokenVersion, testSession(t, store, a.ID))
	bTok, _ = auth.GenerateToken(srv.cfg.JWTSecret, b.ID, b.Email, b.DisplayName, b.TokenVersion, testSession(t, store, b.ID))
	return srv, router, a.ID, aTok, b.ID, bTok
}

func getWith(t *testing.T, router http.Handler, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// The people directory and collaborator list must never expose other users' private settings
// (Discord/custom webhook URL, alarm e-mail, role, token version).
func TestDirectoryHidesPrivateUserFields(t *testing.T) {
	srv, router, aID, _, _, bTok := twoUsers(t)

	// User A gives themselves a secret Discord webhook, a custom webhook and a private alarm address
	discord := "https://discord.com/api/webhooks/42/SECRET-TOKEN"
	custom := "https://hook.example.com/secret"
	alarm := "privat-a@example.com"
	if _, err := srv.store.UpdateUserFull(aID, nil, nil, nil, nil, nil, &alarm, &discord, &custom, nil, nil); err != nil {
		t.Fatalf("set webhooks: %v", err)
	}

	for _, path := range []string{"/api/v1/users/directory", "/api/v1/collaborators"} {
		rec := getWith(t, router, path, bTok)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d", path, rec.Code)
		}
		body := rec.Body.String()
		for _, leaked := range []string{"SECRET-TOKEN", "hook.example.com", "discordWebhookUrl", "customWebhookUrl", "alarmEmail", "tokenVersion", "notificationSettings"} {
			if strings.Contains(body, leaked) {
				t.Errorf("%s leaks %q: %s", path, leaked, body)
			}
		}
		// The fields others legitimately need must still be there
		var users []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &users); err != nil {
			t.Fatalf("%s: decode: %v", path, err)
		}
		if len(users) == 0 {
			t.Fatalf("%s: expected at least one user", path)
		}
		if _, ok := users[0]["displayName"]; !ok {
			t.Errorf("%s: displayName missing from public view", path)
		}
	}
}

// Someone without access to a note/list/folder must not be able to read its share list.
func TestShareListsRequireAccess(t *testing.T) {
	srv, router, aID, aTok, _, bTok := twoUsers(t)

	// Note owned by A
	doc, err := srv.store.CreateDocument(aID, "", "Geheim", "📝", "", []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "x"}}, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	// List owned by A
	list, err := srv.store.CreateList(aID, "Privat", "", "shopping")
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	// Shared folder owned by A
	folder, err := srv.store.CreateSharedFolder(aID, "Akten", "")
	if err != nil {
		t.Fatalf("CreateSharedFolder: %v", err)
	}

	cases := []struct {
		name string
		path string
	}{
		{"doc shares", "/api/v1/documents/" + doc.ID + "/shares"},
		{"list shares", "/api/v1/lists/" + list.ID + "/shares"},
		{"folder shares", "/api/v1/workspace/folders/shared/" + folder.ID + "/shares"},
	}
	for _, c := range cases {
		// Owner A may read them
		if rec := getWith(t, router, c.path, aTok); rec.Code != http.StatusOK {
			t.Errorf("%s: owner expected 200, got %d", c.name, rec.Code)
		}
		// Outsider B must be refused (404, like the object itself)
		if rec := getWith(t, router, c.path, bTok); rec.Code != http.StatusNotFound {
			t.Errorf("%s: outsider expected 404, got %d (%s)", c.name, rec.Code, rec.Body.String())
		}
	}
}

// Deleting a note that the caller cannot see returns 404, not a 500 with a raw SQL error.
func TestDeleteForeignDocumentIsNotFound(t *testing.T) {
	srv, router, aID, _, _, bTok := twoUsers(t)
	doc, err := srv.store.CreateDocument(aID, "", "Geheim", "📝", "", []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "x"}}, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/documents/"+doc.ID, nil)
	req.Header.Set("Authorization", "Bearer "+bTok)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 deleting foreign doc, got %d (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "sql") {
		t.Errorf("response leaks raw SQL error: %s", rec.Body.String())
	}
}
