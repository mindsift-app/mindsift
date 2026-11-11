package storage

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"path/filepath"
	"runtime"
	"strconv"
)

// Many functions here answer with a plain value (a bool, a count, a list) and have no error to return.
// A database error must not pass for an answer there: it is logged with the place it happened, and
// functions that decide on something (rights, "is there one", "is it the last one") ask dbFailed, so
// they can answer on the safe side instead of reading the zero value as "no". "No such row" is an
// answer, not an error.

// logDBErr logs a database error in a place that cannot return it.
func logDBErr(err error) { reportDBErr(err) }

// dbFailed is logDBErr for places that decide: true when the database failed.
func dbFailed(err error) bool { return reportDBErr(err) }

// rowErr is err with "no such row" turned into nil, for lookups whose zero value is the answer then.
func rowErr(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}

// execLogged runs a statement nothing else depends on (last_used_at, updated_at, cleaning up); a
// failure is logged instead of dropped.
func (s *Store) execLogged(query string, args ...any) {
	_, err := s.db.Exec(query, args...)
	reportDBErr(err)
}

func reportDBErr(err error) bool {
	if err == nil || errors.Is(err, sql.ErrNoRows) {
		return false
	}
	if !errors.Is(err, context.Canceled) { // the request went away, nothing is wrong with the database
		_, file, line, _ := runtime.Caller(2)
		slog.Error("Database query failed", "at", filepath.Base(file)+":"+strconv.Itoa(line), "error", err)
	}
	return true
}
