package storage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"
)

// Sessions (FLAW-31): every login is a row; the session token carries its ID. A session ends on
// logout, when it is ended from the session list, when all sessions are ended, or after
// SessionIdleTimeout without use. Tokens are renewed while the session is used (sliding login).

// SessionIdleTimeout ends sessions that were not used for this long.
const SessionIdleTimeout = 30 * 24 * time.Hour

// sessionTouchEvery limits writes: last_used_at is updated at most this often.
const sessionTouchEvery = 5 * time.Minute

var ErrSessionNotFound = errors.New("Sitzung nicht gefunden")

type Session struct {
	ID         string `json:"id"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt"`
	UserAgent  string `json:"userAgent"`
	IP         string `json:"ip"`
	Current    bool   `json:"current"`
}

func (s *Store) migrateSessions() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			last_used_at TEXT NOT NULL,
			user_agent TEXT NOT NULL DEFAULT '',
			ip TEXT NOT NULL DEFAULT '',
			revoked_at TEXT NOT NULL DEFAULT ''
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`),
		// Replaced by sessions: a logout now ends the session instead of listing the token
		stmt(`DROP TABLE IF EXISTS revoked_tokens`),
	)
}

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339) }

// CreateSession starts a session for a login; old ended or idle sessions of the user are removed.
func (s *Store) CreateSession(userID, userAgent, ip string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	id := hex.EncodeToString(b)
	if len(userAgent) > 300 {
		userAgent = userAgent[:300]
	}
	idleCutoff := time.Now().Add(-SessionIdleTimeout).UTC().Format(time.RFC3339)
	return id, s.execInTx(
		stmt(`DELETE FROM sessions WHERE user_id = ? AND (revoked_at != '' OR last_used_at < ?)`, userID, idleCutoff),
		stmt(`INSERT INTO sessions (id, user_id, created_at, last_used_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)`,
			id, userID, nowUTC(), nowUTC(), userAgent, ip),
	)
}

// SessionActive reports whether the session belongs to the user, was not ended and was used recently.
// It also records the use (at most every few minutes).
func (s *Store) SessionActive(sessionID, userID string) bool {
	if sessionID == "" {
		return false
	}
	var lastUsed, revoked string
	err := s.db.QueryRow(`SELECT last_used_at, revoked_at FROM sessions WHERE id = ? AND user_id = ?`, sessionID, userID).
		Scan(&lastUsed, &revoked)
	if err != nil || revoked != "" {
		return false
	}
	last, err := time.Parse(time.RFC3339, lastUsed)
	if err != nil || time.Since(last) > SessionIdleTimeout {
		return false
	}
	if time.Since(last) > sessionTouchEvery {
		_, _ = s.db.Exec(`UPDATE sessions SET last_used_at = ? WHERE id = ?`, nowUTC(), sessionID)
	}
	return true
}

// ListSessions returns the user's active sessions, most recently used first.
func (s *Store) ListSessions(userID, currentID string) ([]Session, error) {
	idleCutoff := time.Now().Add(-SessionIdleTimeout).UTC().Format(time.RFC3339)
	rows, err := s.db.Query(`SELECT id, created_at, last_used_at, user_agent, ip FROM sessions
		WHERE user_id = ? AND revoked_at = '' AND last_used_at >= ? ORDER BY last_used_at DESC`, userID, idleCutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var ss Session
		if err := rows.Scan(&ss.ID, &ss.CreatedAt, &ss.LastUsedAt, &ss.UserAgent, &ss.IP); err != nil {
			return nil, err
		}
		ss.Current = ss.ID == currentID
		out = append(out, ss)
	}
	return out, rows.Err()
}

// RevokeSession ends one session of the user.
func (s *Store) RevokeSession(userID, sessionID string) error {
	res, err := s.db.Exec(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at = ''`, nowUTC(), sessionID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrSessionNotFound
	}
	return nil
}

// RevokeOtherSessions ends every session of the user except keepID ("" ends all).
func (s *Store) RevokeOtherSessions(userID, keepID string) error {
	_, err := s.db.Exec(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at = ''`, nowUTC(), userID, keepID)
	return err
}
