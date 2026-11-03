package api

import (
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// The language of a person and the server's default language, as the app reads and changes them.
func TestLanguageSettings(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)

	// Without anything set the default language is German
	_, _, st := oauthDo(t, router, http.MethodGet, "/api/v1/auth/status", "", "", "")
	if st["defaultLanguage"] != "de" {
		t.Fatalf("auth status: %v", st["defaultLanguage"])
	}
	_, _, adm := oauthDo(t, router, http.MethodGet, "/api/v1/admin/settings", token, "", "")
	if adm["defaultLanguage"] != "de" {
		t.Fatalf("admin settings: %v", adm["defaultLanguage"])
	}

	// Own choice: supported codes and "" only
	rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"language":"de"}`, "")
	if rec.Code != http.StatusOK || store.Language(claims.UserID) != "de" {
		t.Fatalf("set language: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"language":"en"}`, ""); rec.Code != http.StatusOK || store.Language(claims.UserID) != "en" {
		t.Fatalf("English: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, http.MethodPatch, "/api/v1/auth/settings", token, `{"language":"xx"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown language must be refused, got %d", rec.Code)
	}
	_, _, me := oauthDo(t, router, http.MethodGet, "/api/v1/auth/me", token, "", "")
	if u, _ := me["user"].(map[string]interface{}); u == nil || u["language"] != "en" {
		t.Fatalf("me: %v", me["user"])
	}

	// The admin's default language; an unknown one is refused, an empty one leaves it as it is
	if code, _, _ := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", token, "application/json", `{"defaultLanguage":"xx"}`); code != http.StatusBadRequest {
		t.Fatalf("unknown default language must be refused, got %d", code)
	}
	if code, _, _ := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", token, "application/json", `{"defaultLanguage":"de"}`); code != http.StatusOK {
		t.Fatalf("set default language, got %d", code)
	}
	if code, _, _ := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", token, "application/json", `{"instanceName":"X"}`); code != http.StatusOK {
		t.Fatalf("save without language, got %d", code)
	}
	if code, _, _ := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", token, "application/json", `{"defaultLanguage":"en"}`); code != http.StatusOK {
		t.Fatalf("English default, got %d", code)
	}
	if _, _, st := oauthDo(t, router, http.MethodGet, "/api/v1/auth/status", "", "", ""); st["defaultLanguage"] != "en" {
		t.Fatalf("status after switching: %v", st["defaultLanguage"])
	}
	if store.DefaultLanguageSetting() != "en" {
		t.Fatalf("stored default language: %q", store.DefaultLanguageSetting())
	}
}
