package cli

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/mindsift-app/mindsift/internal/api"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// testDB creates a migrated database (as the server leaves it) and returns its path; the store that
// created it stays open, as a running server would.
func testDB(t *testing.T) (string, *storage.Store) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mindsift.db")
	store, err := storage.NewStore(path)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return path, store
}

type result struct {
	code   int
	stdout string
	stderr string
}

func run(t *testing.T, dbPath string, stdin string, args ...string) result {
	t.Helper()
	var out, errOut bytes.Buffer
	code := Run(args, Env{Stdout: &out, Stderr: &errOut, Stdin: strings.NewReader(stdin), DatabasePath: dbPath})
	return result{code, out.String(), errOut.String()}
}

func decode(t *testing.T, r result) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(r.stdout), &m); err != nil {
		t.Fatalf("output is not one JSON object: %v\n%s", err, r.stdout)
	}
	return m
}

func mustCreate(t *testing.T, store *storage.Store, name, role string) *domain.User {
	t.Helper()
	hash, _ := auth.HashPassword("altes-passwort")
	u, err := store.CreateUserWithUsername(name+"@example.com", name, hash, "", role)
	if err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
	return u
}

func TestHelpAndUnknownCommand(t *testing.T) {
	for _, arg := range []string{"help", "-h", "--help"} {
		r := run(t, "", "", arg)
		if r.code != ExitOK || !strings.Contains(r.stdout, "reset-password") {
			t.Fatalf("%s: code %d, output %q", arg, r.code, r.stdout)
		}
	}
	if r := run(t, "", "", "frobnicate"); r.code != ExitUsage || !strings.Contains(r.stderr, "unknown command") {
		t.Fatalf("unknown command: code %d, stderr %q", r.code, r.stderr)
	}
	if IsCommand(nil) || IsCommand([]string{"serve"}) || !IsCommand([]string{"users"}) {
		t.Fatal("IsCommand: no arguments and serve start the server, anything else is a command")
	}
}

func TestCreateFirstAccountMustBeAdmin(t *testing.T) {
	path, store := testDB(t)
	r := run(t, path, "", "users", "create", "anna", "--email", "anna@example.com", "--json")
	if r.code != ExitRefused || decode(t, r)["code"] != "first_admin" {
		t.Fatalf("first account as member: code %d, %s", r.code, r.stdout)
	}
	r = run(t, path, "", "users", "create", "anna", "--email", "anna@example.com", "--admin", "--json")
	if r.code != ExitOK {
		t.Fatalf("first admin: code %d, %s %s", r.code, r.stdout, r.stderr)
	}
	if !store.SetupPending() {
		t.Fatal("the first admin from the command line leaves the setup wizard's questions for the first sign-in")
	}
}

func TestCreateGeneratesPasswordAndJSON(t *testing.T) {
	path, store := testDB(t)
	mustCreate(t, store, "admin", domain.RoleAdmin)

	r := run(t, path, "", "users", "create", "Bert", "--email", "Bert@Example.com", "--display-name", "Bert B.", "--json")
	if r.code != ExitOK {
		t.Fatalf("code %d: %s %s", r.code, r.stdout, r.stderr)
	}
	m := decode(t, r)
	pw, _ := m["oneTimePassword"].(string)
	if len(pw) < 20 || m["created"] != true {
		t.Fatalf("expected a generated password, got %v", m)
	}
	user := m["user"].(map[string]any)
	if user["username"] != "bert" || user["email"] != "bert@example.com" || user["role"] != "member" || user["displayName"] != "Bert B." {
		t.Fatalf("unexpected user %v", user)
	}
	u, err := store.GetUserByLogin("bert")
	if err != nil || !auth.CheckPassword(pw, u.PasswordHash) {
		t.Fatal("the printed one-time password must sign in")
	}

	// Plain output shows the password once as well
	r = run(t, path, "", "users", "create", "carla", "--email", "carla@example.com")
	if r.code != ExitOK || !strings.Contains(r.stdout, "One-time password: ") {
		t.Fatalf("code %d: %s", r.code, r.stdout)
	}
}

func TestCreateValidation(t *testing.T) {
	path, store := testDB(t)
	mustCreate(t, store, "admin", domain.RoleAdmin)
	pwFile := filepath.Join(t.TempDir(), "pw")
	_ = os.WriteFile(pwFile, []byte("ein-gutes-passwort\n"), 0o600)

	cases := []struct {
		name  string
		stdin string
		args  []string
		exit  int
		code  string
	}{
		{"invalid username", "", []string{"users", "create", "a b!", "--email", "x@example.com"}, ExitUsage, "invalid"},
		{"missing email", "", []string{"users", "create", "dora"}, ExitUsage, "invalid"},
		{"invalid email", "", []string{"users", "create", "dora", "--email", "Dora <d@example.com>"}, ExitUsage, "invalid"},
		{"username taken", "", []string{"users", "create", "ADMIN", "--email", "neu@example.com"}, ExitRefused, "username_taken"},
		{"email taken", "", []string{"users", "create", "dora", "--email", "admin@example.com"}, ExitRefused, "email_taken"},
		{"short password", "kurz\n", []string{"users", "create", "dora", "--email", "d@example.com", "--password-stdin"}, ExitUsage, "invalid"},
		{"two password sources", "x", []string{"users", "create", "dora", "--email", "d@example.com", "--password-stdin", "--password-file", pwFile}, ExitUsage, "invalid"},
		{"unknown flag", "", []string{"users", "create", "dora", "--email", "d@example.com", "--root"}, ExitUsage, "invalid"},
		{"two names", "", []string{"users", "create", "dora", "emil", "--email", "d@example.com"}, ExitUsage, "invalid"},
	}
	for _, tc := range cases {
		r := run(t, path, tc.stdin, append(tc.args, "--json")...)
		if r.code != tc.exit || decode(t, r)["code"] != tc.code {
			t.Errorf("%s: code %d, %s", tc.name, r.code, r.stdout)
		}
	}
	if n, _ := store.CountUsers(); n != 1 {
		t.Fatalf("refused creates must not leave accounts, have %d", n)
	}

	// A given password: from stdin and from a file, without the trailing line break, nothing printed
	r := run(t, path, "ein-gutes-passwort\n", "users", "create", "dora", "--email", "d@example.com", "--password-stdin", "--json")
	if r.code != ExitOK || decode(t, r)["oneTimePassword"] != nil {
		t.Fatalf("stdin: code %d, %s", r.code, r.stdout)
	}
	r = run(t, path, "", "users", "create", "emil", "--email=e@example.com", "--password-file", pwFile, "--admin")
	if r.code != ExitOK || strings.Contains(r.stdout, "One-time") {
		t.Fatalf("file: code %d, %s", r.code, r.stdout)
	}
	for _, name := range []string{"dora", "emil"} {
		u, _ := store.GetUserByLogin(name)
		if u == nil || !auth.CheckPassword("ein-gutes-passwort", u.PasswordHash) {
			t.Fatalf("%s: the given password must sign in", name)
		}
	}
	if u, _ := store.GetUserByLogin("emil"); u.Role != domain.RoleAdmin {
		t.Fatal("--admin creates an administrator")
	}
}

func TestUsersList(t *testing.T) {
	path, store := testDB(t)
	admin := mustCreate(t, store, "admin", domain.RoleAdmin)
	mustCreate(t, store, "bert", domain.RoleMember)
	if _, err := store.CreateSession(admin.ID, "test", "192.0.2.1", storage.SessionViaPassword); err != nil {
		t.Fatal(err)
	}
	r := run(t, path, "", "users", "--json")
	if r.code != ExitOK {
		t.Fatalf("code %d: %s", r.code, r.stderr)
	}
	var list []userInfo
	if err := json.Unmarshal([]byte(r.stdout), &list); err != nil || len(list) != 2 {
		t.Fatalf("expected two accounts: %v %s", err, r.stdout)
	}
	if list[0].Username != "admin" || list[0].Role != "admin" || list[0].LastSignIn == "" || list[1].LastSignIn != "" {
		t.Fatalf("unexpected list %+v", list)
	}
	r = run(t, path, "", "users", "list")
	if r.code != ExitOK || !strings.Contains(r.stdout, "LAST SIGN-IN") || !strings.Contains(r.stdout, "bert@example.com") {
		t.Fatalf("table: %s", r.stdout)
	}
}

func TestResetPasswordEndsSessions(t *testing.T) {
	path, store := testDB(t)
	admin := mustCreate(t, store, "admin", domain.RoleAdmin)
	bert := mustCreate(t, store, "bert", domain.RoleMember)

	// A running server on the same database, with a signed-in session of bert
	cfg := &config.Config{DatabasePath: path, JWTSecret: "test-jwt-secret-key-of-32-bytes!"}
	srv := api.NewServer(cfg, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	sid, _ := store.CreateSession(bert.ID, "test", "192.0.2.1", storage.SessionViaPassword)
	token, _ := auth.GenerateToken(cfg.JWTSecret, bert.ID, bert.Email, bert.DisplayName, bert.TokenVersion, sid)
	me := func() int {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Router().ServeHTTP(rec, req)
		return rec.Code
	}
	if code := me(); code != http.StatusOK {
		t.Fatalf("before: %d", code)
	}

	// Second factor on, so --disable-2fa has something to remove
	now := time.Now()
	if err := store.StartTOTPSetup(bert.ID, "sealed", now); err != nil {
		t.Fatal(err)
	}
	if ok, err := store.ConfirmTOTP(bert.ID, 1, []string{"h1"}, now); err != nil || !ok {
		t.Fatalf("ConfirmTOTP: %v %v", ok, err)
	}

	r := run(t, path, "", "reset-password", "bert@example.com", "--json")
	if r.code != ExitOK {
		t.Fatalf("code %d: %s %s", r.code, r.stdout, r.stderr)
	}
	m := decode(t, r)
	pw, _ := m["oneTimePassword"].(string)
	u, _ := store.GetUserByID(bert.ID)
	if !auth.CheckPassword(pw, u.PasswordHash) || auth.CheckPassword("altes-passwort", u.PasswordHash) {
		t.Fatal("the new password replaces the old one")
	}
	if store.SessionActive(sid, bert.ID) || u.TokenVersion == bert.TokenVersion {
		t.Fatal("the reset ends every session and raises the token version")
	}
	if code := me(); code != http.StatusUnauthorized {
		t.Fatalf("the running server must refuse the old token at once, got %d", code)
	}
	if !store.TOTPActive(bert.ID) {
		t.Fatal("without --disable-2fa the second factor stays")
	}
	if a, _ := store.GetUserByID(admin.ID); a.TokenVersion != admin.TokenVersion {
		t.Fatal("other accounts stay signed in")
	}

	r = run(t, path, "", "reset-password", "bert", "--disable-2fa")
	if r.code != ExitOK || store.TOTPActive(bert.ID) || store.RecoveryCodesLeft(bert.ID) != 0 {
		t.Fatalf("--disable-2fa: code %d, totp %v, %s", r.code, store.TOTPActive(bert.ID), r.stdout)
	}

	events, _ := store.CLIEventsAfter(0)
	if len(events) != 2 || events[0].Action != actionResetPassword || events[0].UserID != bert.ID {
		t.Fatalf("each reset is recorded for the server: %+v", events)
	}

	if r := run(t, path, "", "reset-password", "niemand"); r.code != ExitNotFound {
		t.Fatalf("unknown account: %d", r.code)
	}
	// The local part of an address signs in, but never names an account here
	if r := run(t, path, "", "reset-password", "bert@"); r.code != ExitNotFound {
		t.Fatalf("inexact name: %d", r.code)
	}
}

func TestLastAdminProtection(t *testing.T) {
	path, store := testDB(t)
	admin := mustCreate(t, store, "admin", domain.RoleAdmin)
	mustCreate(t, store, "bert", domain.RoleMember)

	for _, args := range [][]string{{"users", "delete", "admin", "--yes"}, {"make-admin", "admin", "--revoke"}} {
		r := run(t, path, "", append(args, "--json")...)
		if r.code != ExitRefused || decode(t, r)["code"] != "last_admin" {
			t.Fatalf("%v: code %d, %s", args, r.code, r.stdout)
		}
	}
	// A disabled admin does not count
	other := mustCreate(t, store, "olga", domain.RoleAdmin)
	inactive := false
	if _, err := store.UpdateUser(other.ID, nil, nil, nil, &inactive, nil, nil); err != nil {
		t.Fatal(err)
	}
	if r := run(t, path, "", "make-admin", "admin", "--revoke"); r.code != ExitRefused {
		t.Fatalf("disabled admin counted: %d", r.code)
	}

	if r := run(t, path, "", "make-admin", "bert", "--json"); r.code != ExitOK || decode(t, r)["changed"] != true {
		t.Fatalf("make-admin: %d %s", r.code, r.stdout)
	}
	if r := run(t, path, "", "make-admin", "admin", "--revoke"); r.code != ExitOK {
		t.Fatalf("revoke with another admin: %d %s", r.code, r.stderr)
	}
	u, _ := store.GetUserByID(admin.ID)
	if u.Role != domain.RoleMember {
		t.Fatalf("revoked admin: role %s", u.Role)
	}
	if r := run(t, path, "", "make-admin", "admin", "--revoke", "--json"); r.code != ExitOK || decode(t, r)["changed"] != false {
		t.Fatalf("revoking a member changes nothing: %s", r.stdout)
	}
}

func TestDeleteDryRunAndDelete(t *testing.T) {
	path, store := testDB(t)
	mustCreate(t, store, "admin", domain.RoleAdmin)
	bert := mustCreate(t, store, "bert", domain.RoleMember)
	if _, err := store.CreateDocument(bert.ID, "", "Rezepte", "", "", nil, nil, false); err != nil {
		t.Fatal(err)
	}

	r := run(t, path, "", "users", "delete", "bert", "--json")
	m := decode(t, r)
	if r.code != ExitOK || m["deleted"] != false || m["content"].(map[string]any)["notes"] != float64(1) {
		t.Fatalf("dry run: %d %s", r.code, r.stdout)
	}
	if u, _ := store.GetUserByID(bert.ID); u == nil {
		t.Fatal("without --yes nothing is deleted")
	}
	r = run(t, path, "", "users", "delete", "bert")
	if r.code != ExitOK || !strings.Contains(r.stdout, "--yes") {
		t.Fatalf("plain dry run: %s", r.stdout)
	}

	r = run(t, path, "", "users", "delete", "bert", "--yes")
	if r.code != ExitOK {
		t.Fatalf("delete: %d %s %s", r.code, r.stdout, r.stderr)
	}
	if u, err := store.GetUserByID(bert.ID); u != nil || err == nil {
		t.Fatal("the account is gone")
	}
	if docs, _ := store.GetDocuments(bert.ID); len(docs) != 0 {
		t.Fatal("its notes are gone")
	}
	if events, _ := store.CLIEventsAfter(0); len(events) != 1 || events[0].Action != actionDelete {
		t.Fatalf("recorded: %+v", events)
	}
}

func TestCheckAndBackup(t *testing.T) {
	path, store := testDB(t)
	mustCreate(t, store, "admin", domain.RoleAdmin)
	r := run(t, path, "", "check", "--json")
	if r.code != ExitOK || decode(t, r)["ok"] != true {
		t.Fatalf("check: %d %s %s", r.code, r.stdout, r.stderr)
	}
	r = run(t, path, "", "check", "--backup", "--json")
	m := decode(t, r)
	backup, _ := m["backup"].(string)
	if r.code != ExitOK || filepath.Dir(backup) != filepath.Join(filepath.Dir(path), "backups", "system") {
		t.Fatalf("backup: %d %s", r.code, r.stdout)
	}
	if _, err := os.Stat(backup); err != nil {
		t.Fatalf("backup file: %v", err)
	}
	if files, _ := storage.ListBackups(filepath.Dir(backup)); len(files) != 1 {
		t.Fatal("the snapshot is listed with the daily backups")
	}
}

func TestCheckFindsProblems(t *testing.T) {
	path, store := testDB(t)
	mustCreate(t, store, "admin", domain.RoleAdmin)
	// A row pointing nowhere, written without the foreign key check
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(0)&_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO list_items (id, list_id, text, is_completed, position, created_at, updated_at) VALUES ('i1', 'missing', 'x', 0, 0, '', '')`); err != nil {
		t.Skipf("list_items layout differs: %v", err)
	}
	r := run(t, path, "", "check", "--json")
	m := decode(t, r)
	if r.code != ExitFailed || m["ok"] != false || len(m["problems"].([]any)) == 0 {
		t.Fatalf("problems: %d %s", r.code, r.stdout)
	}
}

func TestRefusedInDemoMode(t *testing.T) {
	path, store := testDB(t)
	mustCreate(t, store, "admin", domain.RoleAdmin)
	for _, args := range [][]string{
		{"users", "create", "bert", "--email", "b@example.com"},
		{"users", "delete", "admin", "--yes"},
		{"reset-password", "admin"},
		{"make-admin", "admin"},
		{"check", "--backup"},
	} {
		var out bytes.Buffer
		code := Run(args, Env{Stdout: &out, Stderr: &out, Stdin: strings.NewReader(""), DatabasePath: path, DemoMode: true})
		if code != ExitRefused {
			t.Errorf("%v in demo mode: code %d, %s", args, code, out.String())
		}
	}
	var out bytes.Buffer
	if code := Run([]string{"users"}, Env{Stdout: &out, Stderr: &out, DatabasePath: path, DemoMode: true}); code != ExitOK {
		t.Fatalf("listing is fine in the demo: %d %s", code, out.String())
	}
}

func TestDatabaseMissingOrOtherVersion(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope", "mindsift.db")
	if r := run(t, missing, "", "users"); r.code != ExitFailed || !strings.Contains(r.stderr, "no database") {
		t.Fatalf("missing: %d %s", r.code, r.stderr)
	}
	if _, err := os.Stat(filepath.Dir(missing)); err == nil {
		t.Fatal("no folder is created for a missing database")
	}

	path, store := testDB(t)
	if _, err := store.CreateUserWithUsername("a@example.com", "admin", "x", "", domain.RoleAdmin); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO schema_migrations (id, name, applied_at) VALUES (9999, 'from the future', '')`); err != nil {
		t.Fatal(err)
	}
	r := run(t, path, "", "users", "--json")
	if r.code != ExitFailed || !strings.Contains(decode(t, r)["error"].(string), "migration 9999") {
		t.Fatalf("newer database: %d %s", r.code, r.stdout)
	}
	if _, err := db.Exec(`DELETE FROM schema_migrations WHERE id >= (SELECT MAX(id) FROM schema_migrations WHERE id < 9999)`); err != nil {
		t.Fatal(err)
	}
	if r := run(t, path, "", "users"); r.code != ExitFailed || !strings.Contains(r.stderr, "start the server of this version once") {
		t.Fatalf("older database: %d %s", r.code, r.stderr)
	}
}
