package api

import (
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
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
	last, err := store.LastCLIEventID()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordCLIEvent("make-admin", u.ID, u.Username, "role member -> admin"); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordCLIEvent("reset-password", u.ID, u.Username, "sessions ended"); err != nil {
		t.Fatal(err)
	}
	next := srv.applyCLIEvents(last)
	if next <= last {
		t.Fatalf("the events after %d are handled, got %d", last, next)
	}
	if srv.loginGuard.lockedFor(u.ID, ip) != 0 {
		t.Fatal("reset-password from the command line lifts the lock")
	}
	if again := srv.applyCLIEvents(next); again != next {
		t.Fatal("handled events are not read twice")
	}
}
