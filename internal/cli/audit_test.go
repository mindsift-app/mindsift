package cli

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func compact(raw json.RawMessage) string {
	var b bytes.Buffer
	if err := json.Compact(&b, raw); err != nil {
		return string(raw)
	}
	return b.String()
}

// Every change of the command line lands in the audit log, which `mindsift audit` prints
func TestAuditCommand(t *testing.T) {
	path, store := testDB(t)
	mustCreate(t, store, "admin", domain.RoleAdmin)
	if r := run(t, path, "", "audit"); r.code != ExitOK || !strings.Contains(r.stdout, "empty") {
		t.Fatalf("empty log: %d %s", r.code, r.stdout)
	}

	for _, args := range [][]string{
		{"users", "create", "bert", "--email", "bert@example.com"},
		{"make-admin", "bert"},
		{"make-admin", "bert", "--revoke"},
		{"reset-password", "bert"},
		{"users", "delete", "bert", "--yes"},
	} {
		if r := run(t, path, "", args...); r.code != ExitOK {
			t.Fatalf("%v: %d %s", args, r.code, r.stderr)
		}
	}

	r := run(t, path, "", "audit", "--json", "--limit", "3")
	var entries []storage.AuditEntry
	if err := json.Unmarshal([]byte(r.stdout), &entries); err != nil || r.code != ExitOK {
		t.Fatalf("json: %v %s", err, r.stdout)
	}
	if len(entries) != 3 || entries[0].Action != storage.AuditAccountDeleted || entries[1].Action != storage.AuditAccountPasswordReset ||
		entries[2].Action != storage.AuditAccountRoleChanged || compact(entries[2].Details) != `{"from":"admin","to":"member"}` ||
		len(entries[1].Details) != 0 {
		t.Fatalf("newest first, three: %+v", entries)
	}
	for _, e := range entries {
		if e.ActorKind != storage.AuditActorCLI || e.Source != storage.AuditSourceCLI || e.TargetName != "bert" {
			t.Fatalf("row: %+v", e)
		}
	}

	r = run(t, path, "", "audit")
	if r.code != ExitOK || !strings.Contains(r.stdout, "account.created") || !strings.Contains(r.stdout, `{"role":"member"}`) ||
		!strings.Contains(r.stdout, "cli") {
		t.Fatalf("table: %s", r.stdout)
	}
	// The one-time passwords never reach the log
	if strings.Contains(strings.ToLower(r.stdout), "password\":") {
		t.Fatalf("password in the log: %s", r.stdout)
	}

	for _, bad := range []string{"0", "501", "viele"} {
		if r := run(t, path, "", "audit", "--limit", bad); r.code != ExitUsage {
			t.Fatalf("--limit %s: %d", bad, r.code)
		}
	}
}
