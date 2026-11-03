package storage

import (
	"fmt"
	"log/slog"
)

// ResetAndSeedDemo drops all tables, recreates the schema, and seeds demo accounts and demo data.
func (s *Store) ResetAndSeedDemo() error {
	// Logged-in demo visitors stay logged in: their sessions survive the reset (fixed account IDs)
	kept := s.demoSessions()
	if err := s.dropAllTables(); err != nil {
		return fmt.Errorf("reset demo: drop all tables: %w", err)
	}
	if err := s.migrate(); err != nil {
		return fmt.Errorf("reset demo: migrate schema: %w", err)
	}
	if err := s.EnsureDemoAccounts(); err != nil {
		return fmt.Errorf("reset demo: ensure demo accounts: %w", err)
	}
	for _, k := range kept {
		_, _ = s.db.Exec(`INSERT OR IGNORE INTO sessions (id, user_id, created_at, last_used_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)`,
			k.id, k.userID, k.created, k.lastUsed, k.agent, k.ip)
	}
	slog.Info("🧹 Demo mode: database reset and filled with sample data")
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
		if rows.Scan(&k.id, &k.userID, &k.created, &k.lastUsed, &k.agent, &k.ip) == nil {
			out = append(out, k)
		}
	}
	return out
}
