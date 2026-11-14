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
	// What real pages contain: comments, unquoted attributes, upper case, a <title> inside an inline SVG
	// before the page's own, and tags after the head
	messy := `<HTML><HEAD>
	<!-- <meta property="og:title" content="aus einem Kommentar"> -->
	<svg viewBox="0 0 1 1"><title>Logo</title><path d="M0 0"/></svg>
	<TITLE>Seite &amp; Titel</TITLE>
	<meta name=description content=Kurz>
	<META PROPERTY="og:image" CONTENT="https://example.com/a.png?x=1&amp;y=2">
	<link rel="shortcut icon" href=/fav.ico>
	<link rel="apple-touch-icon" href="/touch.png">
	<script>var s = "<meta property='og:site_name' content='aus Skript'>";</script>
	</HEAD><BODY><title>im Körper</title></BODY></HTML>`
	m = parsePageMeta(messy)
	if m.title != "Seite & Titel" || m.description != "Kurz" || m.image != "https://example.com/a.png?x=1&y=2" ||
		m.icon != "/touch.png" || m.siteName != "" {
		t.Fatalf("messy page: %+v", m)
	}
	// Entities are decoded once: "&amp;lt;" is the text "&lt;", not "<"
	if m := parsePageMeta(`<head><meta property="og:title" content="a &amp;lt; b"></head>`); m.title != "a &lt; b" {
		t.Fatalf("decoded twice: %q", m.title)
	}
	if m := parsePageMeta(`<head><title>Ohne Ende`); m.title != "Ohne Ende" {
		t.Fatalf("cut off page: %+v", m)
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

// The administration switches link previews off for the whole server: nothing is fetched or served (not
// even a cached preview), the answer says why in a way the app understands, and the status tells the app.
func TestLinkPreviewsSwitchedOffServerWide(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	p := &storage.LinkPreview{URL: "https://example.com/", Title: "Beispiel", OK: true, Icon: []byte("\x89PNG\r\n\x1a\n"), IconMime: "image/png"}
	if err := store.SaveLinkPreview(p); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String(), `"linkPreviews":true`) {
		t.Fatal("link previews are on by default")
	}
	if rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","linkPreviews":false}`, ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"linkPreviews":false`) {
		t.Fatalf("switch off: %d %s", rec.Code, rec.Body.String())
	}
	for _, path := range []string{"/api/v1/link-preview?url=https://example.com/", "/api/v1/link-preview/" + p.Key + "/icon"} {
		rec := sessionCall(router, "GET", path, token, "", "")
		if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"link_previews_off"`) || !strings.Contains(rec.Body.String(), "ausgeschaltet") {
			t.Fatalf("%s while off: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	if !strings.Contains(sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String(), `"linkPreviews":false`) {
		t.Fatal("the status must tell the app that previews are off")
	}
	// Other settings saved without the field leave it as it is
	sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","instanceName":"Neu"}`, "")
	if sys, _ := store.GetSystemSettings(); sys.LinkPreviews == nil || *sys.LinkPreviews {
		t.Fatal("saving other settings must keep link previews off")
	}
	sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","linkPreviews":true}`, "")
	if rec := sessionCall(router, "GET", "/api/v1/link-preview?url=https://example.com/", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("on again: %d %s", rec.Code, rec.Body.String())
	}
}
