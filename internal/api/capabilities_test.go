package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

func statusCapabilities(t *testing.T, srv *Server) map[string]bool {
	t.Helper()
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/auth/status", nil))
	var st struct {
		Capabilities map[string]bool `json:"capabilities"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatalf("status: %v", err)
	}
	if len(st.Capabilities) != len(allCapabilities) {
		t.Fatalf("status reports %d capabilities, want %d: %v", len(st.Capabilities), len(allCapabilities), st.Capabilities)
	}
	return st.Capabilities
}

// /auth/status tells what the instance offers: a server everything it is configured for, sharing mode
// private switches off sharing only, the desktop app what needs other people, sign-in, a browser or an
// address others reach.
func TestCapabilitiesInAuthStatus(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := NewServer(&config.Config{Port: "8080", DatabasePath: dbPath, JWTSecret: "capabilities-test-secret-0123456789"}, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)

	caps := statusCapabilities(t, srv)
	for _, c := range []capability{capAccounts, capSignIn, capSharing, capWatch, capEmail, capPush, capPublicLinks, capPublicAddress, capLiveDrawing, capInstall} {
		if !caps[string(c)] {
			t.Errorf("server: %s off", c)
		}
	}
	// No https BASE_URL: no passkeys
	if caps[string(capPasskeys)] {
		t.Error("server without BASE_URL: passkeys on")
	}

	sys, err := store.GetSystemSettings()
	if err != nil {
		t.Fatal(err)
	}
	sys.SharingMode = storage.SharingPrivate
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	caps = statusCapabilities(t, srv)
	if caps[string(capSharing)] || !caps[string(capAccounts)] || !caps[string(capWatch)] || !caps[string(capEmail)] {
		t.Errorf("sharing mode private: %v, want only sharing off", caps)
	}

	desktopStore, desktopDB := freshStore(t)
	desktop := startDesktop(t, desktopStore, desktopDB, config.DesktopLinux, nil)
	caps = statusCapabilities(t, desktop)
	for c, on := range caps {
		if on {
			t.Errorf("desktop app: %s on", c)
		}
	}
}
