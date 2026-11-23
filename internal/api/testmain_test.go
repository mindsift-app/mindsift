package api

import (
	"io"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
	"golang.org/x/crypto/bcrypt"
)

func TestMain(m *testing.M) {
	// bcrypt at its lowest cost: the tests sign up, sign in and change passwords hundreds of times, at the
	// default cost each hash takes about 50 ms. What is tested (right password in, wrong one out, the
	// pre-hash form, rehashing old hashes) does not depend on the cost; the server never changes it.
	auth.PasswordCost = bcrypt.MinCost
	// No compaction pass at each test server's start; tests of the compaction call compactOnce
	compactAtStart = false
	code := m.Run()
	seededTemplates.mu.Lock()
	if seededTemplates.dir != "" {
		_ = os.RemoveAll(seededTemplates.dir)
	}
	seededTemplates.mu.Unlock()
	os.Exit(code)
}

// seededTemplates: the databases tests start from, built once per test run and copied for each test:
// migrated only (newMigratedStore), and with the sample data as setupTestServer starts (newSeededStore;
// one per day and time zone of the clock, the sample data has due dates relative to today). Migrating a
// new database took about 0.3 s, writing the sample data another 0.5 s of every test.
var seededTemplates struct {
	mu    sync.Mutex
	dir   string
	paths map[string]string
}

// newSeededStore opens a store at dbPath that holds what a new store at that place would after
// openSharing, EnsureDefaultUser and SeedStarterContent: a copy of the template database, opened the way
// setupTestServer opens its store.
func newSeededStore(t *testing.T, dbPath string) (*storage.Store, *domain.User) {
	t.Helper()
	copyFile(t, seededTemplate(t), dbPath)
	store, err := storage.NewStore(dbPath, storage.WithSecretsKey(testSecretsKey))
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	user, err := store.EnsureDefaultUser()
	if err != nil {
		t.Fatalf("failed to ensure test user: %v", err)
	}
	return store, user
}

// seededTemplate builds the template database for today, unless it exists.
func seededTemplate(t *testing.T) string {
	t.Helper()
	return templateDB(t, "seeded "+clock.Today()+" "+clock.Location().String(), []storage.StoreOption{storage.WithSecretsKey(testSecretsKey)},
		func(store *storage.Store) {
			openSharing(t, store)
			user, err := store.EnsureDefaultUser()
			if err != nil {
				t.Fatalf("failed to ensure test user: %v", err)
			}
			_ = store.SeedStarterContent(user)
		})
}

// newMigratedStore opens a store at dbPath like storage.NewStore on a new file, without options: a copy
// of a database that went through all migrations and holds nothing else.
func newMigratedStore(t *testing.T, dbPath string) (*storage.Store, error) {
	t.Helper()
	copyFile(t, templateDB(t, "migrated", nil, func(*storage.Store) {}), dbPath)
	return storage.NewStore(dbPath)
}

// templateDB: the template database named key, made by opening a new store with opts and handing it to
// fill, unless this test run has it already.
func templateDB(t *testing.T, key string, opts []storage.StoreOption, fill func(*storage.Store)) string {
	t.Helper()
	seededTemplates.mu.Lock()
	defer seededTemplates.mu.Unlock()
	if path, ok := seededTemplates.paths[key]; ok {
		return path
	}
	if seededTemplates.dir == "" {
		dir, err := os.MkdirTemp("", "mindsift-api-test-")
		if err != nil {
			t.Fatalf("template folder: %v", err)
		}
		seededTemplates.dir, seededTemplates.paths = dir, map[string]string{}
	}
	path := filepath.Join(seededTemplates.dir, strconv.Itoa(len(seededTemplates.paths)), "template.db")
	store, err := storage.NewStore(path, opts...)
	if err != nil {
		t.Fatalf("failed to create the template store: %v", err)
	}
	fill(store)
	// Closing the last connection writes the log into the database file, so the file alone is the copy
	if err := store.Close(); err != nil {
		t.Fatalf("closing the template store: %v", err)
	}
	if _, err := os.Stat(path + "-wal"); err == nil {
		t.Fatalf("the template database kept its write-ahead log")
	}
	seededTemplates.paths[key] = path
	return path
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	src, err := os.Open(from)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	if err := os.MkdirAll(filepath.Dir(to), 0o700); err != nil {
		t.Fatal(err)
	}
	dst, err := os.OpenFile(to, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		t.Fatal(err)
	}
	if err := dst.Close(); err != nil {
		t.Fatal(err)
	}
}
