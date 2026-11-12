package api

import (
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// The app asks a new account once about the guided tour: /auth/me says whether it already asked, the
// settings remember the answer. The demo's shared accounts keep no answer (each browser does).
func TestTourOfferFlag(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)

	offered := func() any {
		_, _, me := oauthDo(t, router, http.MethodGet, "/api/v1/auth/me", token, "", "")
		u, _ := me["user"].(map[string]any)
		if u == nil {
			t.Fatalf("me: %v", me)
		}
		return u["tourOffered"]
	}
	if got := offered(); got != false {
		t.Fatalf("new account: tourOffered = %v, want false", got)
	}

	// Another setting leaves the answer alone
	if rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"voiceInput":"browser"}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("other setting: %d %s", rec.Code, rec.Body.String())
	}
	if offered() != false {
		t.Fatal("another setting must not mark the tour as offered")
	}

	// The demo ignores it: everybody shares its accounts
	srv.cfg.DemoMode = true
	if rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"tourOffered":true}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("demo: %d %s", rec.Code, rec.Body.String())
	}
	if store.TourOffered(claims.UserID) {
		t.Fatal("the demo must not store the answer on the shared account")
	}
	srv.cfg.DemoMode = false

	rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"tourOffered":true}`, "")
	if rec.Code != http.StatusOK || !store.TourOffered(claims.UserID) {
		t.Fatalf("set: %d %s", rec.Code, rec.Body.String())
	}
	if got := offered(); got != true {
		t.Fatalf("after the answer: tourOffered = %v, want true", got)
	}
}
