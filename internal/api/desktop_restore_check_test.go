package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// plainServerDatabase: a closed server database (plain .db, which the upload takes as well) after change
// ran on it with its own connection.
func plainServerDatabase(t *testing.T, change func(db *sql.DB)) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mindsift.db")
	st, err := storage.NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateUser("anna@example.com", "hash", "Anna", domain.RoleAdmin); err != nil {
		t.Fatal(err)
	}
	_ = st.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode = DELETE`); err != nil {
		t.Fatal(err)
	}
	if change != nil {
		change(db)
	}
	_ = db.Close()
	return path
}

// Audit 2026-11-22 F5: an uploaded snapshot is checked before it is opened as a store: one with a trigger
// or view MindSift's schema does not have, or a damaged one, is refused and its folder removed; an
// untouched server database passes.
func TestDesktopSnapshotRefusesForeignSchemaAndDamage(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)

	if rec := uploadSnapshot(t, router, token, plainServerDatabase(t, nil)); rec.Code != http.StatusOK {
		t.Fatalf("a plain server database: %d %s", rec.Code, rec.Body.String())
	}

	trigger := plainServerDatabase(t, func(db *sql.DB) {
		if _, err := db.Exec(`CREATE TRIGGER evil AFTER UPDATE ON users BEGIN UPDATE users SET display_name = 'x'; END`); err != nil {
			t.Fatal(err)
		}
	})
	view := plainServerDatabase(t, func(db *sql.DB) {
		if _, err := db.Exec(`CREATE VIEW users_v AS SELECT * FROM users`); err != nil {
			t.Fatal(err)
		}
	})
	damaged := plainServerDatabase(t, nil)
	raw, _ := os.ReadFile(damaged)
	for i := 4096 + 100; i < len(raw) && i < 4096*6; i += 7 { // pages 2 to 6 garbled, the header stays
		raw[i] ^= 0x5a
	}
	_ = os.WriteFile(damaged, raw, 0o600)

	for name, path := range map[string]string{"trigger": trigger, "view": view, "damaged": damaged} {
		rec := uploadSnapshot(t, router, token, path)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s, want 400", name, rec.Code, rec.Body.String())
		}
		if entries, _ := os.ReadDir(srv.snapshotRoot()); len(entries) != 0 {
			t.Errorf("%s: staged folders left: %d", name, len(entries))
		}
	}
	if rec := uploadSnapshot(t, router, token, trigger); !strings.Contains(rec.Body.String(), "beschädigt") {
		t.Errorf("message for a refused snapshot: %s", rec.Body.String())
	}
}

// A take-over that is running keeps its folder: cancelling, the expiry and a new upload (which used to
// remove every staged folder before it waited for the import gate) leave it alone until it is done.
func TestDesktopSnapshotFolderStaysDuringTakeOver(t *testing.T) {
	snapshot, _, _ := serverSnapshot(t)
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)

	rec := uploadSnapshot(t, router, token, snapshot)
	var up snapshotUploadResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &up) != nil {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	dir := srv.stagedSnapshotDir(up.Token)
	release, ok := srv.claimSnapshot(up.Token)
	if !ok {
		t.Fatal("claim refused")
	}
	if rec := sessionCall(router, http.MethodDelete, "/api/v1/admin/backups/server-snapshot/"+up.Token, token, "", ""); rec.Code != http.StatusOK {
		t.Errorf("cancel: %d", rec.Code)
	}
	srv.snapshot.mu.Lock()
	srv.snapshot.token, srv.snapshot.created = up.Token, time.Now().Add(-2*snapshotStageTTL)
	srv.snapshot.mu.Unlock()
	_ = srv.stagedSnapshotDir(up.Token) // past the expiry
	srv.clearSnapshots("other")         // a new upload claiming the gate
	if _, err := os.Stat(filepath.Join(dir, snapshotDBName)); err != nil {
		t.Fatalf("the folder of the running take-over was removed: %v", err)
	}
	release()
	srv.clearSnapshots("")
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("released folder still there: %v", err)
	}
	if _, ok := srv.claimSnapshot(up.Token); ok {
		t.Error("a removed snapshot could be claimed")
	}
}
