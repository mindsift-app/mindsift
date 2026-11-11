package storage

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

// captureLog collects what is logged for the rest of the test.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	before := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(before) })
	return &buf
}

// "No such row" is an answer; anything else is a failure and is logged with the place it happened,
// except a request that went away.
func TestDatabaseErrorsAreToldFromAnswers(t *testing.T) {
	log := captureLog(t)
	if dbFailed(nil) || dbFailed(sql.ErrNoRows) || dbFailed(fmt.Errorf("lookup: %w", sql.ErrNoRows)) {
		t.Fatal("no error and no such row are not failures")
	}
	if log.Len() != 0 {
		t.Fatalf("nothing to log yet: %s", log)
	}
	if !dbFailed(fmt.Errorf("read: %w", context.Canceled)) {
		t.Fatal("a cancelled read is no answer")
	}
	if log.Len() != 0 {
		t.Fatalf("a request that went away is not logged: %s", log)
	}
	if !dbFailed(errors.New("disk I/O error")) {
		t.Fatal("a database error is a failure")
	}
	if got := log.String(); !strings.Contains(got, "Database query failed") || !strings.Contains(got, "at=dberr_test.go:") ||
		!strings.Contains(got, "disk I/O error") {
		t.Fatalf("the failure is logged with its place: %s", got)
	}

	broken := errors.New("database is locked")
	if rowErr(sql.ErrNoRows) != nil || rowErr(nil) != nil || rowErr(broken) != broken {
		t.Fatal("rowErr drops only \"no such row\"")
	}
}

// A database that cannot answer is not read as "no": what decides on signing in, on the last
// administrator, on the MCP switch or on sending alarms answers on the safe side or with an error.
func TestDatabaseFailureAnswersOnTheSafeSide(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	if store.IsPendingRegistration(alice.ID) || store.IsEmailUnverified(alice.ID) || store.EmailInUse("niemand@test.local") ||
		store.IsLastAdmin(alice.ID) || store.IsDocShared("doc_keine") || !store.MCPEnabledSetting() {
		t.Fatal("answers while the database works")
	}
	if _, err := store.GetSystemSettings(); err != nil {
		t.Fatalf("settings while the database works: %v", err)
	}

	log := captureLog(t)
	if err := store.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if !store.IsPendingRegistration(alice.ID) {
		t.Error("an account that cannot be checked counts as waiting for approval")
	}
	if !store.IsEmailUnverified(alice.ID) {
		t.Error("an address that cannot be checked counts as unconfirmed")
	}
	if !store.EmailInUse("niemand@test.local") {
		t.Error("an address that cannot be checked counts as taken")
	}
	if !store.IsLastAdmin(alice.ID) {
		t.Error("an administrator who cannot be checked counts as the last one")
	}
	if !store.IsDocShared("doc_keine") {
		t.Error("a note that cannot be checked counts as shared")
	}
	if store.MCPEnabledSetting() {
		t.Error("the MCP switch counts as off when it cannot be read")
	}
	if settings, err := store.GetSystemSettings(); err == nil || settings == nil {
		t.Errorf("settings that cannot be read are an error, with the defaults beside it: %v %v", settings, err)
	}
	if _, err := store.GetDueTasksForAlarm(); err == nil {
		t.Error("alarms that cannot be read are an error")
	}
	if n := strings.Count(log.String(), "Database query failed"); n < 6 {
		t.Errorf("every failed check is logged, got %d entries: %s", n, log)
	}
}
