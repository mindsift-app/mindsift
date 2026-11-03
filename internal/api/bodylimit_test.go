package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestRequestBodyLimited(t *testing.T) {
	srv, _, token := setupTestServer(t)
	router := srv.Router()
	huge := `{"content":"` + strings.Repeat("x", defaultMaxBody) + `"}`
	if rec := sessionCall(router, "POST", "/api/v1/inbox", token, huge, ""); rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("body over the limit: want 400/413, got %d", rec.Code)
	}
	if rec := sessionCall(router, "POST", "/api/v1/inbox", token, `{"content":"klein"}`, ""); rec.Code >= 300 {
		t.Fatalf("normal body: got %d %s", rec.Code, rec.Body.String())
	}
	if srv.bodyLimitFor("/api/v1/docs/doc_1/sync") != syncMaxBody || srv.bodyLimitFor("/api/v1/import/obsidian") <= defaultMaxBody {
		t.Fatal("sync and import keep their larger limits")
	}
}

func TestWebhookTokenInURLOnlyAPIKey(t *testing.T) {
	srv, _, token := setupTestServer(t)
	rec := sessionCall(srv.Router(), "POST", "/api/v1/webhooks/ingest?token="+token, "", `{"text":"x"}`, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("session token in URL: want 401, got %d", rec.Code)
	}
}
