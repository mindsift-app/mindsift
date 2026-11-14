package storage

import (
	"fmt"
	"log/slog"
)

// ResetAndSeedDemo drops all tables, recreates the schema, and seeds demo accounts and demo data.
func (s *Store) ResetAndSeedDemo() error {
	// Logged-in demo visitors stay logged in: their sessions survive the reset (fixed account IDs)
	kept := s.demoSessions()
	// The settings are seeded anew with the tables
	defer s.forgetSystemSettings()
	if err := s.dropAllTables(); err != nil {
		if err := s.recoverDemoDatabase(fmt.Errorf("drop all tables: %w", err)); err != nil {
			return err
		}
	} else if err := s.migrate(); err != nil {
		if err := s.recoverDemoDatabase(fmt.Errorf("migrate schema: %w", err)); err != nil {
			return err
		}
	}
	if err := s.EnsureDemoAccounts(); err != nil {
		return fmt.Errorf("reset demo: ensure demo accounts: %w", err)
	}
	for _, k := range kept {
		s.execLogged(`INSERT OR IGNORE INTO sessions (id, user_id, created_at, last_used_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)`,
			k.id, k.userID, k.created, k.lastUsed, k.agent, k.ip)
	}
	slog.Info("Demo mode: database reset and filled with sample data")
	return nil
}

// WithDemoMode marks the store as the demo's (MINDSIFT_DEMO): its data is disposable, so a database the
// migrations fail on is wiped and migrated anew instead of stopping the start (see recoverDemoDatabase).
// Never for a server with real data.
func WithDemoMode() StoreOption {
	return func(s *Store) { s.demoMode = true }
}

// recoverDemoDatabase is the demo's way out when its database cannot be reset or migrated the normal way,
// for instance because a reset stopped half-way and left an FTS5 index without its shadow tables: it wipes
// the database (wipeDatabase, which cannot fail on a broken schema) and migrates the empty one. cause is
// the error that got it here.
func (s *Store) recoverDemoDatabase(cause error) error {
	slog.Error("Demo mode: the database could not be reset or migrated; wiping it and starting from an empty database", "error", cause)
	if err := s.wipeDatabase(); err != nil {
		return fmt.Errorf("reset demo: %w; wiping the database failed as well: %v", cause, err)
	}
	if err := s.migrate(); err != nil {
		return fmt.Errorf("reset demo: migrate the wiped database (after: %v): %w", cause, err)
	}
	slog.Info("Demo mode: database wiped and migrated anew")
	return nil
}

type keptSession struct{ id, userID, created, lastUsed, agent, ip string }

func (s *Store) demoSessions() []keptSession {
	rows, err := s.db.Query(`SELECT id, user_id, created_at, last_used_at, user_agent, ip FROM sessions
		WHERE revoked_at = '' AND user_id IN (?, ?)`, DemoAdminID, DemoUserID)
	if err != nil {
		return nil // first start: no sessions table yet
	}
	defer rows.Close()
	var out []keptSession
	for rows.Next() {
		var k keptSession
		if !dbFailed(rows.Scan(&k.id, &k.userID, &k.created, &k.lastUsed, &k.agent, &k.ip)) {
			out = append(out, k)
		}
	}
	logDBErr(rows.Err())
	return out
}
