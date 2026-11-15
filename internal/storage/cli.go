package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
)

// What the command line (internal/cli, `mindsift users …`) needs from the store: opening the database of
// a running server without migrating it. Each change it makes goes to the audit log (audit.go), which
// the server reads (AuditEntriesAfter) to do what only it can do: end live connections of the account,
// lift the lock of the sign-in protection, write the change to its own log.

// WithExistingSchema opens a database the server has already set up and migrated, and nothing else: no
// new file, no migrations, no planner statistics. A database that is behind or ahead of this binary is
// refused (SchemaMismatchError), since the command line runs next to a server that may own it.
func WithExistingSchema() StoreOption {
	return func(s *Store) { s.existingSchema = true }
}

// SchemaMismatchError: the database was migrated by another version of MindSift than this binary.
type SchemaMismatchError struct {
	DatabaseID int // highest migration applied to the database
	KnownID    int // highest migration this binary knows
}

func (e *SchemaMismatchError) Error() string {
	if e.DatabaseID > e.KnownID {
		return fmt.Sprintf("the database has migration %d, this binary knows only up to %d: run the command with the binary of the MindSift version that uses this database (docker exec into the running container)", e.DatabaseID, e.KnownID)
	}
	return fmt.Sprintf("the database is at migration %d, this binary expects %d: start the server of this version once (it migrates the database), then run the command again", e.DatabaseID, e.KnownID)
}

// checkExistingSchema stands in for migrate under WithExistingSchema.
func (s *Store) checkExistingSchema(dbPath string) error {
	if !s.inMemory {
		if _, err := os.Stat(dbPath); err != nil {
			return fmt.Errorf("no database at %s (set DATA_DIR or DATABASE_URL as for the server): %w", dbPath, err)
		}
	}
	var lastApplied sql.NullInt64
	if err := s.db.QueryRow(`SELECT MAX(id) FROM schema_migrations`).Scan(&lastApplied); err != nil {
		return fmt.Errorf("%s is not a MindSift database: %w", dbPath, err)
	}
	known := migrations[len(migrations)-1].id
	if int(lastApplied.Int64) != known {
		return &SchemaMismatchError{DatabaseID: int(lastApplied.Int64), KnownID: known}
	}
	s.blockRefsReady.Store(true)
	s.noteStorageReady.Store(true)
	return nil
}

// migrateCLIEvents is migration 54: the record of changes made on the command line (moved into the
// audit log and dropped by migration 60).
func (s *Store) migrateCLIEvents() error {
	return s.execSchemaStatement(`CREATE TABLE IF NOT EXISTS cli_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		action TEXT NOT NULL,
		user_id TEXT NOT NULL DEFAULT '',
		username TEXT NOT NULL DEFAULT '',
		detail TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	)`)
}

// ResetPassword sets a new password given by the administration (admin API, command line) and ends every
// sign-in of the account in one transaction: the token version goes up (every JWT is refused) and every
// session is ended, as "sign out everywhere" does. With mustChange the person has to choose an own password
// at the next sign-in before anything else (must_change_password); without, an earlier request is dropped.
func (s *Store) ResetPassword(userID, passwordHash string, mustChange bool) error {
	must := 0
	if mustChange {
		must = 1
	}
	return s.execInTx(
		stmt(`UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = ? WHERE id = ?`, passwordHash, must, userID),
		stmt(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''`, nowUTC(), userID),
	)
}

// migrateMustChangePassword is migration 63: whether the account has to choose a new password at its next
// sign-in (set by a reset of the administration that asks for it, cleared by the person's new password).
func (s *Store) migrateMustChangePassword() error {
	return s.addColumnIfMissing("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0")
}

// RevokeAPIAccess removes every API key and every OAuth grant (MCP connection of an AI client) of the
// account, with their tokens, and its calendar subscription (its address answers 404 from then on: like a
// leaked key it reads the person's tasks without signing in); returns how many keys and grants went and
// whether there was a subscription. Scripts, AI clients and calendar apps have to be connected again by
// the person. A plain password change or signing out everywhere keeps all of them.
func (s *Store) RevokeAPIAccess(userID string) (keys, grants int, feed bool, err error) {
	err = s.db.QueryRow(`SELECT COALESCE(SUM(kind = ?), 0), COALESCE(SUM(kind = ?), 0) FROM api_keys WHERE user_id = ?`,
		APIKeyKindKey, APIKeyKindOAuth, userID).Scan(&keys, &grants)
	if err != nil {
		return 0, 0, false, err
	}
	if err = s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM calendar_feeds WHERE user_id = ?)`, userID).Scan(&feed); err != nil {
		return 0, 0, false, err
	}
	// Codes and tokens hang on their grant (ON DELETE CASCADE); removed explicitly all the same
	err = s.execInTx(
		stmt(`DELETE FROM oauth_codes WHERE key_id IN (SELECT id FROM api_keys WHERE user_id = ?)`, userID),
		stmt(`DELETE FROM oauth_tokens WHERE key_id IN (SELECT id FROM api_keys WHERE user_id = ?)`, userID),
		stmt(`DELETE FROM api_keys WHERE user_id = ?`, userID),
		stmt(`DELETE FROM calendar_feeds WHERE user_id = ?`, userID),
	)
	if err != nil {
		return 0, 0, false, err
	}
	return keys, grants, feed, nil
}

// UsernameTaken: an account has this username (compared in lower case).
func (s *Store) UsernameTaken(username string) (bool, error) {
	return s.usernameTaken(strings.ToLower(strings.TrimSpace(username)), "")
}

// LastSignIns: per account the time of its newest session (each sign-in starts one), RFC 3339.
func (s *Store) LastSignIns() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT user_id, MAX(created_at) FROM sessions GROUP BY user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, at string
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		out[id] = at
	}
	return out, rows.Err()
}

// IntegrityProblems runs PRAGMA integrity_check and PRAGMA foreign_key_check; an empty result means the
// database is sound. Only reads, so it may run next to the server.
func (s *Store) IntegrityProblems() ([]string, error) {
	var problems []string
	rows, err := s.db.Query(`PRAGMA integrity_check`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if line != "ok" {
			problems = append(problems, "integrity_check: "+line)
		}
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var table, parent string
		var rowid sql.NullInt64
		var fkid int
		if err := rows.Scan(&table, &rowid, &parent, &fkid); err != nil {
			return nil, err
		}
		problems = append(problems, fmt.Sprintf("foreign_key_check: %s row %d points to a missing row in %s", table, rowid.Int64, parent))
	}
	return problems, rows.Err()
}

// AccountContent counts what deleting an account takes with it (DeleteUser), for the command line's
// preview. Shared* count own items others can see now; they go as well. OthersTasks are tasks of other
// people in the account's task lists: they stay, as personal tasks of their owners.
type AccountContent struct {
	Notes           int `json:"notes"`
	Tasks           int `json:"tasks"`
	TaskLists       int `json:"taskLists"`
	Lists           int `json:"lists"`
	SharedNotes     int `json:"sharedNotes"`
	SharedTaskLists int `json:"sharedTaskLists"`
	SharedLists     int `json:"sharedLists"`
	OthersTasks     int `json:"othersTasks"`
}

// CountAccountContent: see AccountContent.
func (s *Store) CountAccountContent(userID string) (AccountContent, error) {
	var c AccountContent
	queries := []struct {
		dst *int
		q   string
	}{
		{&c.Notes, `SELECT COUNT(*) FROM documents WHERE user_id = ?1`},
		{&c.Tasks, `SELECT COUNT(*) FROM thoughts WHERE user_id = ?1 AND (status = 'kept' OR (status = 'converted' AND converted_type IN ('task', 'document_block')))`},
		{&c.TaskLists, `SELECT COUNT(*) FROM task_lists WHERE user_id = ?1`},
		{&c.Lists, `SELECT COUNT(*) FROM lists WHERE user_id = ?1`},
		{&c.SharedNotes, `SELECT COUNT(*) FROM documents d WHERE d.user_id = ?1 AND (
			EXISTS (SELECT 1 FROM doc_shares s WHERE s.doc_id = d.id) OR EXISTS (SELECT 1 FROM doc_team_shares s WHERE s.doc_id = d.id))`},
		{&c.SharedTaskLists, `SELECT COUNT(*) FROM task_lists t WHERE t.user_id = ?1 AND EXISTS (SELECT 1 FROM task_list_shares s WHERE s.task_list_id = t.id)`},
		{&c.SharedLists, `SELECT COUNT(*) FROM lists l WHERE l.user_id = ?1 AND EXISTS (SELECT 1 FROM list_shares s WHERE s.list_id = l.id)`},
		{&c.OthersTasks, `SELECT COUNT(*) FROM thoughts WHERE user_id != ?1 AND task_list_id IN (SELECT id FROM task_lists WHERE user_id = ?1)`},
	}
	for _, q := range queries {
		if err := s.db.QueryRow(q.q, userID).Scan(q.dst); err != nil {
			return c, err
		}
	}
	return c, nil
}
