package api

import (
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// A new password from the command line lifts the sign-in lock of the account in the running server,
// which only the server can do (its counters live in memory).
func TestCLIEventsReachTheRunningServer(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	u, err := store.CreateUserWithUsername("bert@example.com", "bert", "x", "", domain.RoleMember)
	if err != nil {
		t.Fatal(err)
	}
	ip := clientIPInfo{ip: "192.0.2.7"}
	for i := 0; i < loginLimitAccountIP; i++ {
		srv.loginGuard.recordFailure(u.ID, ip)
	}
	if srv.loginGuard.lockedFor(u.ID, ip) == 0 {
		t.Fatal("expected the account to be locked for this address")
	}
	last, err := store.LastAuditID()
	if err != nil {
		t.Fatal(err)
	}
	cli := func(action string) storage.AuditEntry {
		return storage.AuditEntry{ActorKind: storage.AuditActorCLI, Source: storage.AuditSourceCLI, Action: action,
			TargetKind: storage.AuditTargetUser, TargetID: u.ID, TargetName: u.Username}
	}
	if err := store.RecordAudit(cli(storage.AuditAccountRoleChanged), map[string]string{"from": "member", "to": "admin"}); err != nil {
		t.Fatal(err)
	}
	// A row of the administration with the same account is not the command line's: the lock stays
	web := cli(storage.AuditAccountPasswordReset)
	web.ActorKind, web.Source = storage.AuditActorUser, storage.AuditSourceWeb
	if err := store.RecordAudit(web, nil); err != nil {
		t.Fatal(err)
	}
	if srv.applyCLIEvents(last); srv.loginGuard.lockedFor(u.ID, ip) == 0 {
		t.Fatal("only the command line's rows are handled")
	}
	if err := store.RecordAudit(cli(storage.AuditAccountPasswordReset), nil); err != nil {
		t.Fatal(err)
	}
	next := srv.applyCLIEvents(last)
	if next <= last {
		t.Fatalf("the events after %d are handled, got %d", last, next)
	}
	if srv.loginGuard.lockedFor(u.ID, ip) != 0 {
		t.Fatal("a new password from the command line lifts the lock")
	}
	if again := srv.applyCLIEvents(next); again != next {
		t.Fatal("handled events are not read twice")
	}
}
