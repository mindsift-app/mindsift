package storage

import (
	"database/sql"
	"errors"
	"time"
)

// Web push: the browsers (devices) of a user that receive notifications, and the server's VAPID key
// pair when it is not given by environment.

type PushSubscription struct {
	ID        int64  `json:"id"`
	UserID    string `json:"-"`
	Endpoint  string `json:"endpoint"`
	P256dh    string `json:"-"`
	Auth      string `json:"-"`
	Device    string `json:"device"`
	CreatedAt string `json:"createdAt"`
}

func (s *Store) migratePush() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS push_subscriptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			endpoint TEXT NOT NULL UNIQUE,
			p256dh TEXT NOT NULL,
			auth TEXT NOT NULL,
			device TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`),
		stmt(`CREATE TABLE IF NOT EXISTS push_keys (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			public_key TEXT NOT NULL,
			private_key TEXT NOT NULL
		)`),
	)
}

// SavePushSubscription stores a device; an endpoint already known moves to this user.
func (s *Store) SavePushSubscription(userID, endpoint, p256dh, auth, device string) error {
	_, err := s.db.Exec(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
			auth = excluded.auth, device = excluded.device`,
		userID, endpoint, p256dh, auth, device, time.Now().UTC().Format(time.RFC3339))
	return err
}

func (s *Store) DeletePushSubscription(userID, endpoint string) error {
	_, err := s.db.Exec(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, userID, endpoint)
	return err
}

// ForgetPushEndpoint removes a device the push service no longer knows (HTTP 404/410).
func (s *Store) ForgetPushEndpoint(endpoint string) {
	_, _ = s.db.Exec(`DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint)
}

func (s *Store) PushSubscriptions(userID string) ([]PushSubscription, error) {
	rows, err := s.db.Query(`SELECT id, user_id, endpoint, p256dh, auth, device, created_at
		FROM push_subscriptions WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PushSubscription{}
	for rows.Next() {
		var p PushSubscription
		if err := rows.Scan(&p.ID, &p.UserID, &p.Endpoint, &p.P256dh, &p.Auth, &p.Device, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PushKeys returns the stored VAPID key pair; generate is called (once) when there is none yet.
func (s *Store) PushKeys(generate func() (public, private string, err error)) (string, string, error) {
	var pub, priv string
	err := s.db.QueryRow(`SELECT public_key, private_key FROM push_keys WHERE id = 1`).Scan(&pub, &priv)
	if err == nil {
		return pub, priv, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", "", err
	}
	if pub, priv, err = generate(); err != nil {
		return "", "", err
	}
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO push_keys (id, public_key, private_key) VALUES (1, ?, ?)`, pub, priv); err != nil {
		return "", "", err
	}
	// Another start may have won the race: use what is stored
	err = s.db.QueryRow(`SELECT public_key, private_key FROM push_keys WHERE id = 1`).Scan(&pub, &priv)
	return pub, priv, err
}
