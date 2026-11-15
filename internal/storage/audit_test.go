package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func auditTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// Migration 60 moves the command line's record into the audit log and drops cli_events
func TestAuditLogTakesOverCLIEvents(t *testing.T) {
	s := auditTestStore(t)
	if err := s.migrateCLIEvents(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`DROP TABLE audit_log`); err != nil {
		t.Fatal(err)
	}
	for _, r := range [][3]string{
		{"users-create", "u1", "role=admin"},
		{"make-admin", "u2", "role member -> admin"},
		{"revoke-admin", "u2", "role admin -> member"},
		{"reset-password", "u3", "sessions ended, second factors removed"},
		{"users-delete", "u4", "notes=3 tasks=1 lists=0 taskLists=0"},
	} {
		if _, err := s.db.Exec(`INSERT INTO cli_events (action, user_id, username, detail, created_at) VALUES (?, ?, ?, ?, ?)`,
			r[0], r[1], "name-"+r[1], r[2], nowUTC()); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.migrateAuditLog(); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'cli_events'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("cli_events is dropped: %d %v", n, err)
	}
	got, err := s.AuditEntriesAfter(0, AuditSourceCLI)
	if err != nil || len(got) != 5 {
		t.Fatalf("all rows moved: %d %v", len(got), err)
	}
	want := []struct{ action, details string }{
		{AuditAccountCreated, `{"role":"admin"}`},
		{AuditAccountRoleChanged, `{"from":"member","to":"admin"}`},
		{AuditAccountRoleChanged, `{"from":"admin","to":"member"}`},
		{AuditAccountPasswordReset, `{"secondFactorsRemoved":true}`},
		{AuditAccountDeleted, ``},
	}
	for i, w := range want {
		e := got[i]
		if e.Action != w.action || string(e.Details) != w.details || e.ActorKind != AuditActorCLI || e.TargetKind != AuditTargetUser || e.TargetName == "" {
			t.Errorf("row %d: %+v details %s, want %s %s", i, e, e.Details, w.action, w.details)
		}
	}
}

func TestAuditFilterPagingAndRetention(t *testing.T) {
	s := auditTestStore(t)
	rec := func(action, actor, target, at string) {
		t.Helper()
		e := AuditEntry{At: at, ActorKind: AuditActorUser, ActorID: actor, ActorName: actor, Action: action,
			TargetKind: AuditTargetUser, TargetID: target, TargetName: target, Source: AuditSourceWeb}
		if err := s.RecordAudit(e, map[string]string{"from": "member", "to": "admin"}); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	old := now.Add(-AuditKeep - time.Hour).Format(time.RFC3339)
	rec(AuditAccountCreated, "admin", "anna", old)
	rec(AuditAccountRoleChanged, "admin", "anna", now.Format(time.RFC3339))
	rec(AuditSettingsChanged, "admin", "", now.Format(time.RFC3339))
	rec(AuditAccountDeleted, "bert", "carl", now.Format(time.RFC3339))

	all, _ := s.AuditEntries(AuditFilter{})
	if len(all) != 4 || all[0].Action != AuditAccountDeleted {
		t.Fatalf("newest first: %+v", all)
	}
	if string(all[0].Details) != `{"from":"member","to":"admin"}` {
		t.Fatalf("details: %s", all[0].Details)
	}
	if got, _ := s.AuditEntries(AuditFilter{Action: "account."}); len(got) != 3 {
		t.Fatalf("category: %d", len(got))
	}
	if got, _ := s.AuditEntries(AuditFilter{Action: AuditAccountRoleChanged}); len(got) != 1 {
		t.Fatalf("exact action: %d", len(got))
	}
	// Rows the account did or that concern it
	if got, _ := s.AuditEntries(AuditFilter{UserID: "anna"}); len(got) != 2 {
		t.Fatalf("account as target: %d", len(got))
	}
	if got, _ := s.AuditEntries(AuditFilter{UserID: "bert"}); len(got) != 1 {
		t.Fatalf("account as actor: %d", len(got))
	}
	page, _ := s.AuditEntries(AuditFilter{Limit: 2})
	rest, _ := s.AuditEntries(AuditFilter{Limit: 2, BeforeID: page[1].ID})
	if len(page) != 2 || len(rest) != 2 || rest[0].ID >= page[1].ID {
		t.Fatalf("paging: %+v / %+v", page, rest)
	}

	n, err := s.PruneAudit(now)
	if err != nil || n != 1 {
		t.Fatalf("one row older than a year goes: %d %v", n, err)
	}
	if got, _ := s.AuditEntries(AuditFilter{}); len(got) != 3 {
		t.Fatalf("the others stay: %d", len(got))
	}
}
