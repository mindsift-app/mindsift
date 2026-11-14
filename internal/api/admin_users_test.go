package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// An address another account has is 409 in the admin's user management, not a 500 from the database
func TestAdminUserEmailTakenIsConflict(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	taken, _ := newTestUser(t, store, "taken@example.com")
	other, _ := newTestUser(t, store, "other@example.com")

	errText := func(body []byte) string {
		var res struct{ Error string }
		_ = json.Unmarshal(body, &res)
		return res.Error
	}

	rec := sessionCall(router, "POST", "/api/v1/admin/users", token,
		`{"email":"Taken@Example.com","password":"ein-langes-Passwort-42","displayName":"Neu"}`, "")
	if rec.Code != http.StatusConflict || errText(rec.Body.Bytes()) != "E-Mail-Adresse existiert bereits" {
		t.Fatalf("create with a taken address: %d %s", rec.Code, rec.Body.String())
	}

	rec = sessionCall(router, "PATCH", "/api/v1/admin/users/"+other.ID, token, `{"email":"taken@example.com"}`, "")
	if rec.Code != http.StatusConflict || errText(rec.Body.Bytes()) != "E-Mail-Adresse existiert bereits" {
		t.Fatalf("update to a taken address: %d %s", rec.Code, rec.Body.String())
	}
	// Nothing else of the request was applied
	rec = sessionCall(router, "PATCH", "/api/v1/admin/users/"+other.ID, token, `{"email":"taken@example.com","username":"neuer.name"}`, "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("update to a taken address with a username: %d %s", rec.Code, rec.Body.String())
	}
	if u, _ := store.GetUserByID(other.ID); u.Email != "other@example.com" || u.Username == "neuer.name" {
		t.Fatalf("refused update changed the account: %+v", u)
	}

	// The own address (also in other case) is no conflict
	rec = sessionCall(router, "PATCH", "/api/v1/admin/users/"+taken.ID, token, `{"email":"TAKEN@example.com","displayName":"Taken"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("update keeping the own address: %d %s", rec.Code, rec.Body.String())
	}
	rec = sessionCall(router, "PATCH", "/api/v1/admin/users/"+other.ID, token, `{"email":"free@example.com"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("update to a free address: %d %s", rec.Code, rec.Body.String())
	}
}

// A display name with a line break is stored in one line (admin, registration and profile go through the
// same store functions)
func TestAdminUserDisplayNameOneLine(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	rec := sessionCall(router, "POST", "/api/v1/admin/users", token,
		`{"email":"neu@example.com","password":"ein-langes-Passwort-42","displayName":"Anna\nBcc: x@example.com"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var created struct{ ID, DisplayName string }
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.DisplayName != "Anna Bcc: x@example.com" {
		t.Fatalf("display name not cleaned: %q", created.DisplayName)
	}
	rec = sessionCall(router, "PATCH", "/api/v1/admin/users/"+created.ID, token, `{"displayName":"Anna\r\n\tB."}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}
	if u, _ := store.GetUserByID(created.ID); u.DisplayName != "Anna B." {
		t.Fatalf("display name not cleaned on update: %q", u.DisplayName)
	}
	// Nothing but control characters: the username, as for an empty name
	rec = sessionCall(router, "POST", "/api/v1/admin/users", token,
		`{"email":"leer@example.com","password":"ein-langes-Passwort-42","displayName":"\u0000\n"}`, "")
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"displayName":"leer"`) {
		t.Fatalf("create with a control-only name: %d %s", rec.Code, rec.Body.String())
	}
}

// The admin's user management checks an address the way the profile does
func TestAdminUserInvalidEmail(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	other, _ := newTestUser(t, store, "other@example.com")
	errText := func(body []byte) string {
		var res struct{ Error string }
		_ = json.Unmarshal(body, &res)
		return res.Error
	}
	for _, email := range []string{"keine-adresse", "a@b@c", "Anna <anna@example.com>", "@example.com"} {
		body, _ := json.Marshal(map[string]string{"email": email, "password": "ein-langes-Passwort-42", "displayName": "Neu"})
		rec := sessionCall(router, "POST", "/api/v1/admin/users", token, string(body), "")
		if rec.Code != http.StatusBadRequest || errText(rec.Body.Bytes()) != "Ungültige E-Mail-Adresse" {
			t.Errorf("create with %q: %d %s", email, rec.Code, rec.Body.String())
		}
		body, _ = json.Marshal(map[string]string{"email": email, "username": "neuer.name"})
		rec = sessionCall(router, "PATCH", "/api/v1/admin/users/"+other.ID, token, string(body), "")
		if rec.Code != http.StatusBadRequest || errText(rec.Body.Bytes()) != "Ungültige E-Mail-Adresse" {
			t.Errorf("update to %q: %d %s", email, rec.Code, rec.Body.String())
		}
	}
	// Nothing of a refused update was applied
	if u, _ := store.GetUserByID(other.ID); u.Email != "other@example.com" || u.Username == "neuer.name" {
		t.Fatalf("refused update changed the account: %+v", u)
	}
	// Spaces and capitals around a valid address are no reason to refuse it
	rec := sessionCall(router, "POST", "/api/v1/admin/users", token,
		`{"email":" Neu@Example.com ","password":"ein-langes-Passwort-42","displayName":"Neu"}`, "")
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"email":"neu@example.com"`) {
		t.Fatalf("create with a valid address: %d %s", rec.Code, rec.Body.String())
	}
}

// An empty display name becomes the username, which (unlike the part of the address before the @) no
// other account has: in the admin's user management, in the profile and at registration
func TestEmptyDisplayNameBecomesUsername(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	created := func(body string) (id, username, display string) {
		t.Helper()
		rec := sessionCall(router, "POST", "/api/v1/admin/users", token, body, "")
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		var u struct{ ID, Username, DisplayName string }
		_ = json.Unmarshal(rec.Body.Bytes(), &u)
		return u.ID, u.Username, u.DisplayName
	}
	_, u1, d1 := created(`{"email":"sandro@email.de","password":"ein-langes-Passwort-42","displayName":""}`)
	id2, u2, d2 := created(`{"email":"sandro@firma.de","password":"ein-langes-Passwort-42","displayName":"  "}`)
	if u1 != "sandro" || d1 != "sandro" || u2 != "sandro1" || d2 != "sandro1" {
		t.Fatalf("got %s/%s and %s/%s, want sandro/sandro and sandro1/sandro1", u1, d1, u2, d2)
	}

	// The admin clears the name: the username again
	if rec := sessionCall(router, "PATCH", "/api/v1/admin/users/"+id2, token, `{"displayName":"Sandro F."}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", rec.Code, rec.Body.String())
	}
	rec := sessionCall(router, "PATCH", "/api/v1/admin/users/"+id2, token, `{"displayName":"\u202e"}`, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"displayName":"sandro1"`) {
		t.Fatalf("admin clears the name: %d %s", rec.Code, rec.Body.String())
	}

	// The person clears it in the profile, together with a new username: the new one
	me, meToken := newTestUser(t, store, "anna@example.com")
	rec = sessionCall(router, "PATCH", "/api/v1/auth/settings", meToken, `{"displayName":"","username":"anna.b"}`, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"displayName":"anna.b"`) {
		t.Fatalf("profile clears the name: %d %s", rec.Code, rec.Body.String())
	}
	if u, _ := store.GetUserByID(me.ID); u.DisplayName != "anna.b" {
		t.Fatalf("stored name %q", u.DisplayName)
	}

	// Registration without a name
	setRegistration(t, store, storage.RegistrationOpen, "")
	rec = sessionCall(router, "POST", "/api/v1/auth/register", "",
		`{"email":"sandro@privat.de","password":"password123","displayName":""}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", rec.Code, rec.Body.String())
	}
	if u, _ := store.GetUserByEmail("sandro@privat.de"); u == nil || u.Username != "sandro2" || u.DisplayName != "sandro2" {
		t.Fatalf("registered account: %+v", u)
	}
}

// Names typed in by people cannot start a line of their own in the plain-text part of a mail
func TestMailNamesStayOnOneLine(t *testing.T) {
	text, htmlBody := renderMail(mailContent{
		Preheader: "Anna\nX wartet",
		Greeting:  mailGreeting("de", time.Now(), "Anna\nBcc: x@example.com"),
		Intro:     "Erste Zeile\nZweite Zeile",
		Sections:  []mailSection{{Items: []mailItem{{Title: "Anna\r\nFake: header", Meta: "a@example.com\n"}}}},
	})
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "Bcc:") || strings.HasPrefix(line, "Fake:") {
			t.Fatalf("name broke into its own line:\n%s", text)
		}
	}
	if !strings.Contains(text, "Erste Zeile\nZweite Zeile") {
		t.Fatalf("intro must keep its line breaks:\n%s", text)
	}
	if !strings.Contains(text, "• Anna Fake: header (a@example.com)") {
		t.Fatalf("item title not in one line:\n%s", text)
	}
	if strings.Contains(htmlBody, "Anna<br>") {
		t.Fatalf("HTML greeting must not break either")
	}
}
