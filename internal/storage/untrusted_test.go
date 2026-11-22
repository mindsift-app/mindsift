package storage

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

// A store opened as a file from elsewhere distrusts schema code and checks cell sizes on every connection.
func TestUntrustedFilePragmas(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mindsift.db")
	st, err := NewStore(path, WithUntrustedFile())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	for _, p := range []struct {
		pragma string
		want   int
	}{{"trusted_schema", 0}, {"cell_size_check", 1}, {"foreign_keys", 1}} {
		var got int
		if err := st.db.QueryRow(`PRAGMA ` + p.pragma).Scan(&got); err != nil || got != p.want {
			t.Errorf("PRAGMA %s = %d (%v), want %d", p.pragma, got, err, p.want)
		}
	}
}

// CheckUntrustedDatabase: MindSift's own schema passes (with the names of the current schema), a foreign
// trigger does not, and the checks stop with the context.
func TestCheckUntrustedDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mindsift.db")
	st, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	known, err := st.SchemaObjects()
	if err != nil || len(known) == 0 {
		t.Fatalf("schema objects: %v %v", known, err)
	}
	_ = st.Close()
	ctx := context.Background()
	if err := CheckUntrustedDatabase(ctx, path, known); err != nil {
		t.Fatalf("MindSift's own database refused: %v", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER trg_sneaky AFTER INSERT ON users BEGIN DELETE FROM users; END`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	if err := CheckUntrustedDatabase(ctx, path, known); !errors.Is(err, ErrForeignSchema) {
		t.Errorf("foreign trigger: %v, want ErrForeignSchema", err)
	}

	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := CheckUntrustedDatabase(cancelled, path, known); err == nil {
		t.Error("checks ran past a cancelled context")
	}
}
