package storage

import (
	"database/sql"
	"errors"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Sign-in through an OpenID Connect provider (api/oidc.go). An account is tied to the provider's identity,
// the pair issuer and subject ("sub"), in oidc_identities; the e-mail address only finds or names the account
// at the first sign-in, so a changed address at the provider keeps the link. An account has at most one
// identity per issuer, an identity belongs to one account. Sessions remember how they were started (via):
// the second factor the administration requires is asked of password sign-ins only, the provider has its own.

// How a session was started (sessions.via); "" in rows of earlier versions counts as password.
const (
	SessionViaPassword = "password"
	SessionViaPasskey  = "passkey"
	SessionViaOIDC     = "oidc"
)

var (
	// ErrOIDCIdentityTaken: the identity at the provider already belongs to another account
	ErrOIDCIdentityTaken = errors.New("Dieses Konto beim Anbieter ist bereits mit einem anderen MindSift-Konto verknüpft")
	// ErrOIDCAlreadyLinked: the account already has an identity at this provider
	ErrOIDCAlreadyLinked = errors.New("Dein Konto ist bereits mit dem Anbieter verknüpft")
)

func (s *Store) migrateOIDC() error {
	if err := s.addColumnIfMissing("sessions", "via", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS oidc_identities (
			issuer TEXT NOT NULL,
			subject TEXT NOT NULL,
			user_id TEXT NOT NULL,
			email TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			last_login_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (issuer, subject)
		)`),
		stmt(`CREATE UNIQUE INDEX IF NOT EXISTS idx_oidc_identities_user ON oidc_identities(user_id, issuer)`),
	)
}

// OIDCIdentityUser returns the account tied to the identity; "" when there is none.
func (s *Store) OIDCIdentityUser(issuer, subject string) (string, error) {
	var userID string
	err := s.db.QueryRow(`SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?`, issuer, subject).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return userID, err
}

// HasOIDCIdentity: the account signs in through the provider of this issuer. When the database cannot say,
// it does (the stricter answer for confirming sensitive changes).
func (s *Store) HasOIDCIdentity(userID, issuer string) bool {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM oidc_identities WHERE user_id = ? AND issuer = ?`, userID, issuer).Scan(&n)
	return dbFailed(err) || n > 0
}

// LinkOIDCIdentity ties the identity to the account. Refused when the identity belongs to another account
// (ErrOIDCIdentityTaken) or the account already has one of this issuer (ErrOIDCAlreadyLinked); the same
// pair again is no error.
func (s *Store) LinkOIDCIdentity(issuer, subject, userID, email string, now time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var owner string
	err = tx.QueryRow(`SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?`, issuer, subject).Scan(&owner)
	switch {
	case err == nil && owner == userID:
		return nil
	case err == nil:
		return ErrOIDCIdentityTaken
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}
	var n int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM oidc_identities WHERE user_id = ? AND issuer = ?`, userID, issuer).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrOIDCAlreadyLinked
	}
	at := now.UTC().Format(time.RFC3339)
	if _, err := tx.Exec(`INSERT INTO oidc_identities (issuer, subject, user_id, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)`,
		issuer, subject, userID, domain.NormalizeEmail(email), at, at); err != nil {
		return err
	}
	return tx.Commit()
}

// UnlinkOIDCIdentity removes the identity (its account is gone).
func (s *Store) UnlinkOIDCIdentity(issuer, subject string) error {
	_, err := s.db.Exec(`DELETE FROM oidc_identities WHERE issuer = ? AND subject = ?`, issuer, subject)
	return err
}

// TouchOIDCIdentity records a sign-in through the identity.
func (s *Store) TouchOIDCIdentity(issuer, subject string, now time.Time) {
	s.execLogged(`UPDATE oidc_identities SET last_login_at = ? WHERE issuer = ? AND subject = ?`, now.UTC().Format(time.RFC3339), issuer, subject)
}

// SetAdminByGroup makes the account an administrator (admin) or takes the role back to member (!admin) as the
// provider's group says. The last administrator is never taken back. Managers and members outside the group
// stay what they are. changed reports whether the role changed.
func (s *Store) SetAdminByGroup(userID string, admin bool) (changed bool, err error) {
	var res sql.Result
	if admin {
		res, err = s.db.Exec(`UPDATE users SET role = 'admin' WHERE id = ? AND role != 'admin'`, userID)
	} else {
		res, err = s.db.Exec(`UPDATE users SET role = 'member' WHERE id = ? AND role = 'admin'
			AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND id != ?) > 0`, userID, userID)
	}
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// UserByEmailExactly finds the account whose login address is exactly email (no username, unlike
// GetUserByLogin); sql.ErrNoRows when there is none.
func (s *Store) UserByEmailExactly(email string) (*domain.User, error) {
	email = domain.NormalizeEmail(email)
	if email == "" {
		return nil, sql.ErrNoRows
	}
	return scanUser(s.db.QueryRow(`SELECT `+userSelectCols+` FROM users WHERE LOWER(email) = ?`, email))
}

// CountOIDCIdentities: how many accounts sign in through the provider of this issuer.
func (s *Store) CountOIDCIdentities(issuer string) int {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM oidc_identities WHERE issuer = ?`, issuer).Scan(&n)
	return n
}

// SessionVia tells how the session was started (SessionVia*); "" for an unknown session.
func (s *Store) SessionVia(sessionID string) string {
	if sessionID == "" {
		return ""
	}
	var via string
	if err := s.db.QueryRow(`SELECT via FROM sessions WHERE id = ?`, sessionID).Scan(&via); err != nil {
		return ""
	}
	if via == "" {
		return SessionViaPassword
	}
	return via
}
