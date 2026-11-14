package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// The third-party licenses come as plain text to signed-in people only (they name every dependency's
// version); without the file (development) the address answers 404. The old public address is gone.
func TestThirdPartyLicenses(t *testing.T) {
	srv, _, token := setupTestServer(t)
	srv.staticFS = fstest.MapFS{"index.html": {Data: []byte("<html><head></head></html>")}}
	file := filepath.Join(t.TempDir(), thirdPartyLicensesName)
	if err := os.WriteFile(file, []byte("react 19.2.0 (MIT)\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	srv.licensesFile = file
	router := srv.Router()

	if rec := getWith(t, router, "/api/v1/third-party-licenses", ""); rec.Code != http.StatusUnauthorized || strings.Contains(rec.Body.String(), "react") {
		t.Fatalf("without signing in: %d %q", rec.Code, rec.Body.String())
	}
	if rec := getWith(t, router, "/third-party-licenses.txt", ""); strings.Contains(rec.Body.String(), "react 19.2.0") {
		t.Fatalf("old public address still serves the file: %d", rec.Code)
	}
	rec := getWith(t, router, "/api/v1/third-party-licenses", token)
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") || !strings.Contains(rec.Body.String(), "react 19.2.0") {
		t.Fatalf("licenses: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("served without nosniff")
	}

	for _, missing := range []string{"", filepath.Join(t.TempDir(), "fehlt.txt"), t.TempDir()} {
		srv.licensesFile = missing
		if rec := getWith(t, srv.Router(), "/api/v1/third-party-licenses", token); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "<html>") {
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
