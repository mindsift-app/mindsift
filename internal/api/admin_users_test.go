package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
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
	// Nothing but control characters: the name from the address, as for an empty one
	rec = sessionCall(router, "POST", "/api/v1/admin/users", token,
		`{"email":"leer@example.com","password":"ein-langes-Passwort-42","displayName":"\u0000\n"}`, "")
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"displayName":"leer"`) {
		t.Fatalf("create with a control-only name: %d %s", rec.Code, rec.Body.String())
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
