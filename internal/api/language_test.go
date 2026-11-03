package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
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

// Error answers follow Accept-Language, else the default language.
func TestErrorLanguage(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	router := srv.Router()
	login := func(lang string) (string, string) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"login":"","password":""}`))
		if lang != "" {
			req.Header.Set("Accept-Language", lang)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		var body map[string]string
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return body["error"], rec.Header().Get("Content-Language")
	}
	if msg, lang := login("en-US,en;q=0.9"); msg != "Username/email and password required" || lang != "en" {
		t.Fatalf("English: %q (%s)", msg, lang)
	}
	if msg, lang := login(""); msg != "Benutzername/E-Mail und Passwort erforderlich" || lang != "de" {
		t.Fatalf("default: %q (%s)", msg, lang)
	}
	srv.cfg.DefaultLanguage = "en"
	if msg, _ := login("ja"); msg != "Username/email and password required" {
		t.Fatalf("unsupported language falls back to the default: %q", msg)
	}
}

// Message texts chosen through variables, which the catalog test cannot find in the code.
func TestMessageTextsTranslated(t *testing.T) {
	keys := []string{headingNews, headingSummary, changeDeleted, changeDone, changeReopened, changeDue, changeText,
		changePriority, changeList, changeOther, "Jemand", "Dringend", "Wichtig", "Niedrig", "Normal",
		"Heute: {task}", "Heute, {time}: {task}", "Morgen: {task}", "Morgen, {time}: {task}"}
	for _, g := range []string{"Hallo", "Guten Morgen", "Guten Abend"} {
		keys = append(keys, g, g+", {name}")
	}
	for _, k := range sharedTexts {
		keys = append(keys, k)
	}
	keys = append(keys, staticTexts...)
	for _, lang := range i18n.CatalogLanguages() {
		for _, k := range keys {
			if !i18n.Has(lang, k) {
				t.Errorf("%s lacks %q", lang, k)
			}
		}
	}
	// A mail in English: greeting, texts and dates
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	_ = store.SetLanguage(claims.UserID, "en")
	c := srv.dueAlarmMail(srv.userLanguage(claims.UserID), storage.DueTaskAlarm{Title: "Dentist", UserName: "Ada", Priority: "high"}, domain.HumanDue("en", "2026-10-30T15:30"))
	text, html := renderMail(c)
	for _, want := range []string{"Ada", "One of your tasks is due now:", "Due: 10/30/2026, 3:30 PM · Important", "a clear head in three seconds"} {
		if !strings.Contains(text+html, want) {
			t.Errorf("English alarm mail lacks %q:\n%s", want, text)
		}
	}
	if !strings.Contains(html, `<html lang="en">`) {
		t.Error("English mail must say lang=en")
	}
}

// The setup wizard's language becomes the server's default and the first admin's language; the
// sample data follows it.
func TestSetupLanguage(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "setup_lang.db")
	store, err := storage.NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	srv := NewServer(&config.Config{DatabasePath: dbPath, JWTSecret: "x"}, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	router := srv.Router()
	setup := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(body))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	if rec := setup(`{"email":"a@example.com","password":"secretpassword","defaultLanguage":"xx"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown language must be refused, got %d", rec.Code)
	}
	if rec := setup(`{"email":"a@example.com","password":"secretpassword","defaultLanguage":"fr","createSampleData":true}`); rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d %s", rec.Code, rec.Body.String())
	}
	admin, _ := store.GetUserByEmail("a@example.com")
	if store.DefaultLanguageSetting() != "fr" || store.Language(admin.ID) != "fr" {
		t.Fatalf("default %q, admin %q", store.DefaultLanguageSetting(), store.Language(admin.ID))
	}
	docs, _ := store.GetDocuments(admin.ID)
	found := false
	for _, d := range docs {
		found = found || d.Title == "Getting started"
	}
	if !found {
		t.Fatal("French admin should get the English sample data")
	}
}

// index.html and manifest.json come in the browser's language.
func TestStaticFilesLocalized(t *testing.T) {
	html := `<html lang="de" class="dark"><meta name="description" content="MindSift — Der Kopf frei in drei Sekunden. Instant Capture, Tinder-Style Triage, Workspace & Echtzeit-Listen." />`
	got := string(localizeStatic([]byte(html), "it"))
	if !strings.Contains(got, `<html lang="it"`) || !strings.Contains(got, "La mente libera in tre secondi") {
		t.Fatalf("Italian index.html: %s", got)
	}
	manifest := `{"shortcuts":[{"name": "Neue Aufgabe", "short_name": "Aufgabe"}]}`
	if got := string(localizeStatic([]byte(manifest), "en")); got != `{"shortcuts":[{"name": "New task", "short_name": "Task"}]}` {
		t.Fatalf("English manifest: %s", got)
	}
}
