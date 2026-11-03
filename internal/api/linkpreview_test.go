package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/storage"
)

func TestParsePageMeta(t *testing.T) {
	doc := `<!doctype html><html><head>
	<meta charset="utf-8"><title>Fallback Titel</title>
	<meta property="og:title" content="Rezept: Käsespätzle &amp; Salat">
	<meta name="description" content="Schnell   gemacht,
	für 4 Personen.">
	<meta property='og:image' content='/img/spaetzle.jpg'>
	<meta property="og:site_name" content="Kochseite">
	<link rel="icon" href="/favicon.png"><link rel="stylesheet" href="x.css">
	</head><body><meta property="og:title" content="nicht im Kopf"></body></html>`
	m := parsePageMeta(doc)
	if m.title != "Rezept: Käsespätzle & Salat" || m.description != "Schnell gemacht, für 4 Personen." ||
		m.siteName != "Kochseite" || m.image != "/img/spaetzle.jpg" || m.icon != "/favicon.png" {
		t.Fatalf("unexpected meta: %+v", m)
	}
	if m := parsePageMeta(`<head><title> Nur Titel </title></head>`); m.title != "Nur Titel" {
		t.Fatalf("title fallback: %+v", m)
	}
	if long := cleanText(strings.Repeat("a", 500), 200); len([]rune(long)) != 200 || !strings.HasSuffix(long, "…") {
		t.Fatalf("long text not shortened: %d", len(long))
	}
}

func TestLinkPreviewEndpoints(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	if rec := sessionCall(router, "GET", "/api/v1/link-preview?url=http://example.com", token, "", ""); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("http link: want 422, got %d", rec.Code)
	}
	// A cached preview is answered without fetching; its pictures are served with the login
	p := &storage.LinkPreview{URL: "https://example.com/", Title: "Beispiel", OK: true, Icon: []byte("\x89PNG\r\n\x1a\n"), IconMime: "image/png"}
	if err := store.SaveLinkPreview(p); err != nil {
		t.Fatal(err)
	}
	rec := sessionCall(router, "GET", "/api/v1/link-preview?url=https://example.com/", token, "", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"title":"Beispiel"`) || !strings.Contains(rec.Body.String(), `"hasIcon":true`) {
		t.Fatalf("cached preview: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, "GET", "/api/v1/link-preview/"+p.Key+"/icon", token, "", ""); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("icon: %d", rec.Code)
	}
	if rec := sessionCall(router, "GET", "/api/v1/link-preview/"+p.Key+"/image", token, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("missing image: want 404, got %d", rec.Code)
	}
	if rec := sessionCall(router, "GET", "/api/v1/link-preview/"+p.Key+"/icon", "", "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("without login: want 401, got %d", rec.Code)
	}
}
