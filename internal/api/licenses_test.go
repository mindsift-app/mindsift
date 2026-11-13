package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// The third-party licenses come as plain text without signing in, next to the app's page; without the
// file (development) the address answers 404, not the app's page.
func TestThirdPartyLicenses(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	srv.staticFS = fstest.MapFS{"index.html": {Data: []byte("<html><head></head></html>")}}
	file := filepath.Join(t.TempDir(), thirdPartyLicensesName)
	if err := os.WriteFile(file, []byte("react 19.2.0 (MIT)\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	srv.licensesFile = file
	router := srv.Router()

	rec := getWith(t, router, "/third-party-licenses.txt", "")
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") || !strings.Contains(rec.Body.String(), "react 19.2.0") {
		t.Fatalf("licenses: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("served without nosniff")
	}

	for _, missing := range []string{"", filepath.Join(t.TempDir(), "fehlt.txt"), t.TempDir()} {
		srv.licensesFile = missing
		if rec := getWith(t, srv.Router(), "/third-party-licenses.txt", ""); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "<html>") {
			t.Fatalf("without the file (%q): %d %q", missing, rec.Code, rec.Body.String())
		}
	}

	// The default is the file beside the running binary
	if exe, err := os.Executable(); err == nil {
		if got := defaultThirdPartyLicenses(); filepath.Base(got) != thirdPartyLicensesName || filepath.Dir(got) == "" {
			t.Fatalf("default path for %s: %q", exe, got)
		}
	}
}
