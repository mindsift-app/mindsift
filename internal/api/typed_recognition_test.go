package api

import (
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// "Datum und Menge beim Tippen erkennen" is on for a new account, the settings switch it per account and
// /auth/me reports it; other settings leave it alone.
func TestTypedRecognitionSetting(t *testing.T) {
	t.Parallel()
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)

	current := func() any {
		_, _, me := oauthDo(t, router, http.MethodGet, "/api/v1/auth/me", token, "", "")
		u, _ := me["user"].(map[string]any)
		if u == nil {
			t.Fatalf("me: %v", me)
		}
		return u["typedRecognition"]
	}
	if got := current(); got != true {
		t.Fatalf("new account: typedRecognition = %v, want true", got)
	}
	rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"typedRecognition":false}`, "")
	if rec.Code != http.StatusOK || store.TypedRecognition(claims.UserID) {
		t.Fatalf("switch off: %d %s", rec.Code, rec.Body.String())
	}
	if got := current(); got != false {
		t.Fatalf("after switching off: typedRecognition = %v", got)
	}
	if rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"voiceInput":"browser"}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("other setting: %d", rec.Code)
	}
	if store.TypedRecognition(claims.UserID) {
		t.Fatal("another setting switched the recognition back on")
	}
	if rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"typedRecognition":true}`, ""); rec.Code != http.StatusOK || !store.TypedRecognition(claims.UserID) {
		t.Fatalf("switch on: %d", rec.Code)
	}
}
