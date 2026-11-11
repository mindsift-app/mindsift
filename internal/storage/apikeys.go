package storage

import (
	"errors"
	"strings"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// --- API KEYS & WEBHOOKS ---

// Rights of an API key. They hold the same over every access: REST (curl, smart home) and the MCP
// endpoint for AI agents. The ids of the first three come from the time they only delivered data
// (webhooks) and stay for existing keys. Notes are reachable over MCP only, never over REST.
const (
	ScopeTriage = "webhook:triage" // thoughts into the inbox
	ScopeTask   = "webhook:task"   // create tasks
	ScopeList   = "webhook:list"   // add items to lists

	ScopeTasksRead  = "tasks:read"  // task lists and tasks
	ScopeTasksWrite = "tasks:write" // create, change, complete and delete tasks
	ScopeListsRead  = "lists:read"  // lists and their items
	ScopeListsWrite = "lists:write" // add, change and check off items

	ScopeNotesRead   = "notes:read"   // notes and their bullets (MCP only)
	ScopeNotesCreate = "notes:create" // create new notes (MCP only); existing ones stay untouched
	ScopeNotesWrite  = "notes:write"  // change bullets, rename, move to the trash (MCP only)

	ScopeInboxRead  = "inbox:read"  // open inbox entries (MCP only)
	ScopeInboxWrite = "inbox:write" // convert or discard inbox entries (MCP only)
)

// AllScopes in display order.
var AllScopes = []string{ScopeTriage, ScopeTask, ScopeList, ScopeTasksRead, ScopeTasksWrite, ScopeListsRead, ScopeListsWrite,
	ScopeNotesRead, ScopeNotesCreate, ScopeNotesWrite, ScopeInboxRead, ScopeInboxWrite}

// NormalizeScopes keeps the known scopes in a fixed order; none at all means triage only.
func NormalizeScopes(scopes []string) []string {
	want := map[string]bool{}
	for _, sc := range scopes {
		want[strings.ToLower(strings.TrimSpace(sc))] = true
	}
	out := []string{}
	for _, sc := range AllScopes {
		if want[sc] {
			out = append(out, sc)
		}
	}
	if len(out) == 0 {
		out = []string{ScopeTriage}
	}
	return out
}

func (s *Store) CreateAPIKey(userID, name string, scopes []string) (*domain.APIKey, error) {
	if strings.TrimSpace(name) == "" {
		name = "Smarthome / Webhook Key"
	}
	rawKey, prefix, hash := auth.GenerateAPIKey()
	k := &domain.APIKey{
		ID:        domain.NewID("key"),
		UserID:    userID,
		Name:      strings.TrimSpace(name),
		KeyPrefix: prefix,
		KeyHash:   hash,
		RawKey:    rawKey,
		Scopes:    strings.Join(NormalizeScopes(scopes), ","),
		CreatedAt: domain.NowISO(),
		Kind:      APIKeyKindKey,
	}

	_, err := s.db.Exec(
		`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		k.ID, k.UserID, k.Name, k.KeyPrefix, k.KeyHash, k.Scopes, k.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return k, nil
}

func (s *Store) GetAPIKeys(userID string) ([]domain.APIKey, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, name, key_prefix, scopes, last_used_at, created_at, kind
		 FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keys := make([]domain.APIKey, 0)
	for rows.Next() {
		var k domain.APIKey
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.KeyPrefix, &k.Scopes, &k.LastUsedAt, &k.CreatedAt, &k.Kind); !dbFailed(err) {
			keys = append(keys, k)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return keys, nil
}

// UpdateAPIKey changes name and/or rights of an own key; the secret itself never changes. nil keeps
// a value. Returns ErrAPIKeyNotFound for keys of other users.
func (s *Store) UpdateAPIKey(userID, keyID string, name *string, scopes *[]string) (*domain.APIKey, error) {
	if name != nil {
		n := strings.TrimSpace(*name)
		if n == "" {
			return nil, errors.New("Der Name darf nicht leer sein")
		}
		if res, err := s.db.Exec(`UPDATE api_keys SET name = ? WHERE id = ? AND user_id = ?`, n, keyID, userID); err != nil {
			return nil, err
		} else if c, _ := res.RowsAffected(); c == 0 {
			return nil, ErrAPIKeyNotFound
		}
	}
	if scopes != nil {
		joined := strings.Join(NormalizeScopes(*scopes), ",")
		if res, err := s.db.Exec(`UPDATE api_keys SET scopes = ? WHERE id = ? AND user_id = ?`, joined, keyID, userID); err != nil {
			return nil, err
		} else if c, _ := res.RowsAffected(); c == 0 {
			return nil, ErrAPIKeyNotFound
		}
	}
	keys, err := s.GetAPIKeys(userID)
	if err != nil {
		return nil, err
	}
	for i := range keys {
		if keys[i].ID == keyID {
			return &keys[i], nil
		}
	}
	return nil, ErrAPIKeyNotFound
}

var ErrAPIKeyNotFound = errors.New("API-Schlüssel nicht gefunden")

func (s *Store) DeleteAPIKey(userID, keyID string) error {
	_, err := s.db.Exec(`DELETE FROM api_keys WHERE id = ? AND user_id = ?`, keyID, userID)
	return err
}

func (s *Store) ValidateAPIKeyAndGetUser(rawKey string) (*domain.User, error) {
	u, _, _, err := s.ValidateAPIKey(rawKey)
	return u, err
}

// ValidateAPIKey returns the owner of a key, the key's scopes and its id.
func (s *Store) ValidateAPIKey(rawKey string) (*domain.User, []string, string, error) {
	hash := auth.HashAPIKey(strings.TrimSpace(rawKey))
	var keyID, userID, scopes string
	err := s.db.QueryRow(`SELECT id, user_id, scopes FROM api_keys WHERE key_hash = ? AND kind = ?`, hash, APIKeyKindKey).Scan(&keyID, &userID, &scopes)
	if err != nil {
		return nil, nil, "", errors.New("invalid API key")
	}
	s.execLogged(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, domain.NowISO(), keyID)
	u, err := s.GetUserByID(userID)
	return u, NormalizeScopes(strings.Split(scopes, ",")), keyID, err
}
