package storage

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// OAuth for the MCP endpoint. MindSift is its own authorization
// server: clients register themselves (public clients, PKCE), a person agrees on the consent page,
// and the grant becomes an entry in api_keys (kind 'oauth'). Rights, origin, "last used" and revoking
// therefore work as for every key; the tokens hang on that entry and disappear with it. Codes and
// tokens are stored only as SHA-256 hashes.

const (
	APIKeyKindKey   = "key"
	APIKeyKindOAuth = "oauth"

	OAuthAccessPrefix  = "mindsift_oat_"
	OAuthRefreshPrefix = "mindsift_ort_"

	OAuthCodeTTL    = 10 * time.Minute
	OAuthAccessTTL  = time.Hour
	OAuthRefreshTTL = 90 * 24 * time.Hour
	// Clients nobody agreed to within this time are removed again (registration is open to anyone)
	oauthUnusedClientTTL = 24 * time.Hour
)

var (
	ErrOAuthClientNotFound = errors.New("unknown client")
	ErrOAuthInvalidGrant   = errors.New("invalid grant")
	ErrOAuthTokenInvalid   = errors.New("invalid token")
)

type OAuthClient struct {
	ID           string
	Name         string
	RedirectURIs []string
	CreatedAt    string
}

// OAuthTokens: what the token endpoint hands out
type OAuthTokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
	Scopes       []string
}

func (s *Store) migrateOAuth() error {
	if err := s.addColumnIfMissing("api_keys", "kind", "TEXT NOT NULL DEFAULT 'key'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("api_keys", "oauth_client_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS oauth_clients (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			redirect_uris TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`),
		stmt(`CREATE TABLE IF NOT EXISTS oauth_codes (
			code_hash TEXT PRIMARY KEY,
			client_id TEXT NOT NULL,
			key_id TEXT NOT NULL,
			redirect_uri TEXT NOT NULL,
			code_challenge TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			FOREIGN KEY(key_id) REFERENCES api_keys(id) ON DELETE CASCADE
		)`),
		stmt(`CREATE TABLE IF NOT EXISTS oauth_tokens (
			token_hash TEXT PRIMARY KEY,
			kind TEXT NOT NULL,
			key_id TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			replaced_at TEXT NOT NULL DEFAULT '',
			FOREIGN KEY(key_id) REFERENCES api_keys(id) ON DELETE CASCADE
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_key ON oauth_tokens(key_id)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_api_keys_oauth ON api_keys(user_id, oauth_client_id)`),
	)
}

func randomToken(prefix string) string {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	return prefix + hex.EncodeToString(buf)
}

func hashOAuthSecret(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func isoTime(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// CreateOAuthClient stores a self-registered client (RFC 7591); the redirect URIs are checked by the caller.
func (s *Store) CreateOAuthClient(name string, redirectURIs []string, now time.Time) (*OAuthClient, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "KI-Agent"
	}
	if r := []rune(name); len(r) > 60 {
		name = string(r[:60])
	}
	uris, _ := json.Marshal(redirectURIs)
	c := &OAuthClient{ID: domain.NewID("mcl"), Name: name, RedirectURIs: redirectURIs, CreatedAt: isoTime(now)}
	_, err := s.db.Exec(`INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)`,
		c.ID, c.Name, string(uris), c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) GetOAuthClient(id string) (*OAuthClient, error) {
	var c OAuthClient
	var uris string
	err := s.db.QueryRow(`SELECT id, name, redirect_uris, created_at FROM oauth_clients WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &uris, &c.CreatedAt)
	if err != nil {
		return nil, ErrOAuthClientNotFound
	}
	_ = json.Unmarshal([]byte(uris), &c.RedirectURIs)
	return &c, nil
}

// GrantOAuth records a person's consent and returns a one-time authorization code. The grant is the
// api_keys entry of this person and client; agreeing again reuses it with the newly chosen rights, so
// reconnecting does not pile up entries.
func (s *Store) GrantOAuth(userID string, client *OAuthClient, scopes []string, redirectURI, codeChallenge string, now time.Time) (string, error) {
	joined := strings.Join(NormalizeScopes(scopes), ",")
	var keyID string
	err := s.db.QueryRow(`SELECT id FROM api_keys WHERE user_id = ? AND kind = ? AND oauth_client_id = ?`,
		userID, APIKeyKindOAuth, client.ID).Scan(&keyID)
	switch err {
	case sql.ErrNoRows:
		keyID = domain.NewID("key")
		_, err = s.db.Exec(
			`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes, created_at, kind, oauth_client_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			// Nobody knows this secret: OAuth entries are only reachable through their tokens
			keyID, userID, client.Name+" (OAuth)", "OAuth", auth.HashAPIKey(randomToken("unused_")), joined, isoTime(now),
			APIKeyKindOAuth, client.ID)
	case nil:
		_, err = s.db.Exec(`UPDATE api_keys SET scopes = ? WHERE id = ?`, joined, keyID)
	}
	if err != nil {
		return "", err
	}
	code := randomToken("")
	_, err = s.db.Exec(`INSERT INTO oauth_codes (code_hash, client_id, key_id, redirect_uri, code_challenge, expires_at)
		VALUES (?, ?, ?, ?, ?, ?)`, hashOAuthSecret(code), client.ID, keyID, redirectURI, codeChallenge, isoTime(now.Add(OAuthCodeTTL)))
	if err != nil {
		return "", err
	}
	return code, nil
}

// pkceMatches: S256, base64url(SHA-256(verifier)) without padding (RFC 7636)
func pkceMatches(verifier, challenge string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	return subtle.ConstantTimeCompare([]byte(base64.RawURLEncoding.EncodeToString(sum[:])), []byte(challenge)) == 1
}

// ExchangeOAuthCode trades an authorization code for tokens. The code works once, within its time, for
// the client and redirect URI it was issued to and with the matching PKCE verifier.
func (s *Store) ExchangeOAuthCode(code, clientID, redirectURI, verifier string, now time.Time) (*OAuthTokens, error) {
	var codeClient, keyID, codeRedirect, challenge, expires string
	err := s.db.QueryRow(`SELECT client_id, key_id, redirect_uri, code_challenge, expires_at FROM oauth_codes WHERE code_hash = ?`,
		hashOAuthSecret(code)).Scan(&codeClient, &keyID, &codeRedirect, &challenge, &expires)
	if err != nil {
		return nil, ErrOAuthInvalidGrant
	}
	// Used up whatever happens next; a second attempt with the same code finds nothing
	res, err := s.db.Exec(`DELETE FROM oauth_codes WHERE code_hash = ?`, hashOAuthSecret(code))
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrOAuthInvalidGrant
	}
	if codeClient != clientID || codeRedirect != redirectURI || expires < isoTime(now) || !pkceMatches(verifier, challenge) {
		return nil, ErrOAuthInvalidGrant
	}
	return s.issueOAuthTokens(keyID, now)
}

// RefreshOAuth hands out new tokens for a refresh token and retires the old one. A retired refresh
// token used again means it was copied: every token of the grant ends, the client has to ask again.
func (s *Store) RefreshOAuth(refresh, clientID string, now time.Time) (*OAuthTokens, error) {
	var keyID, expires, replaced, grantClient string
	err := s.db.QueryRow(`SELECT t.key_id, t.expires_at, t.replaced_at, k.oauth_client_id FROM oauth_tokens t
		JOIN api_keys k ON k.id = t.key_id WHERE t.token_hash = ? AND t.kind = 'refresh'`,
		hashOAuthSecret(refresh)).Scan(&keyID, &expires, &replaced, &grantClient)
	if err != nil || grantClient != clientID || expires < isoTime(now) {
		return nil, ErrOAuthInvalidGrant
	}
	if replaced != "" {
		s.execLogged(`DELETE FROM oauth_tokens WHERE key_id = ?`, keyID)
		return nil, ErrOAuthInvalidGrant
	}
	res, err := s.db.Exec(`UPDATE oauth_tokens SET replaced_at = ? WHERE token_hash = ? AND replaced_at = ''`,
		isoTime(now), hashOAuthSecret(refresh))
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrOAuthInvalidGrant // refreshed in parallel
	}
	return s.issueOAuthTokens(keyID, now)
}

func (s *Store) issueOAuthTokens(keyID string, now time.Time) (*OAuthTokens, error) {
	var scopes string
	if err := s.db.QueryRow(`SELECT scopes FROM api_keys WHERE id = ?`, keyID).Scan(&scopes); err != nil {
		return nil, ErrOAuthInvalidGrant // revoked meanwhile
	}
	t := &OAuthTokens{
		AccessToken:  randomToken(OAuthAccessPrefix),
		RefreshToken: randomToken(OAuthRefreshPrefix),
		ExpiresIn:    int(OAuthAccessTTL.Seconds()),
		Scopes:       NormalizeScopes(strings.Split(scopes, ",")),
	}
	err := s.execInTx(
		stmt(`INSERT INTO oauth_tokens (token_hash, kind, key_id, expires_at) VALUES (?, 'access', ?, ?)`,
			hashOAuthSecret(t.AccessToken), keyID, isoTime(now.Add(OAuthAccessTTL))),
		stmt(`INSERT INTO oauth_tokens (token_hash, kind, key_id, expires_at) VALUES (?, 'refresh', ?, ?)`,
			hashOAuthSecret(t.RefreshToken), keyID, isoTime(now.Add(OAuthRefreshTTL))),
		stmt(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, isoTime(now), keyID),
	)
	if err != nil {
		return nil, err
	}
	return t, nil
}

// ValidateOAuthAccessToken returns owner, rights and entry id of an access token, like ValidateAPIKey.
func (s *Store) ValidateOAuthAccessToken(raw string, now time.Time) (*domain.User, []string, string, error) {
	var keyID, userID, scopes, expires string
	err := s.db.QueryRow(`SELECT k.id, k.user_id, k.scopes, t.expires_at FROM oauth_tokens t
		JOIN api_keys k ON k.id = t.key_id WHERE t.token_hash = ? AND t.kind = 'access'`,
		hashOAuthSecret(strings.TrimSpace(raw))).Scan(&keyID, &userID, &scopes, &expires)
	if err != nil || expires < isoTime(now) {
		return nil, nil, "", ErrOAuthTokenInvalid
	}
	s.execLogged(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, isoTime(now), keyID)
	u, err := s.GetUserByID(userID)
	return u, NormalizeScopes(strings.Split(scopes, ",")), keyID, err
}

// RevokeOAuthToken ends one token (RFC 7009). Revoking a refresh token ends the access tokens of the
// grant as well; the entry itself stays until the person removes it.
func (s *Store) RevokeOAuthToken(raw, clientID string) error {
	var keyID, kind, grantClient string
	err := s.db.QueryRow(`SELECT t.key_id, t.kind, k.oauth_client_id FROM oauth_tokens t JOIN api_keys k ON k.id = t.key_id
		WHERE t.token_hash = ?`, hashOAuthSecret(raw)).Scan(&keyID, &kind, &grantClient)
	if err != nil || grantClient != clientID {
		return rowErr(err) // an unknown token or one of another client: nothing to do
	}
	if kind == "refresh" {
		_, err = s.db.Exec(`DELETE FROM oauth_tokens WHERE key_id = ?`, keyID)
		return err
	}
	_, err = s.db.Exec(`DELETE FROM oauth_tokens WHERE token_hash = ?`, hashOAuthSecret(raw))
	return err
}

// PurgeOAuth removes expired codes and tokens, clients nobody agreed to and – with idleDays > 0 –
// OAuth entries unused for that many days (their tokens go with them).
func (s *Store) PurgeOAuth(now time.Time, idleDays int) (removedGrants int, err error) {
	if idleDays > 0 {
		cutoff := isoTime(now.AddDate(0, 0, -idleDays))
		res, err := s.db.Exec(`DELETE FROM api_keys WHERE kind = ? AND CASE WHEN last_used_at = '' THEN created_at ELSE last_used_at END < ?`,
			APIKeyKindOAuth, cutoff)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		removedGrants = int(n)
	}
	// After the grants, so that a client whose last connection just went is removed in the same pass
	return removedGrants, s.execInTx(
		stmt(`DELETE FROM oauth_codes WHERE expires_at < ?`, isoTime(now)),
		stmt(`DELETE FROM oauth_tokens WHERE expires_at < ?`, isoTime(now)),
		stmt(`DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT oauth_client_id FROM api_keys WHERE kind = ?)`,
			isoTime(now.Add(-oauthUnusedClientTTL)), APIKeyKindOAuth),
	)
}
