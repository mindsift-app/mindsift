package storage

import (
	"database/sql"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Origin of tasks, thoughts and list items: which API key created an entry and which one changed it
// last, and over which access (REST "api" or "mcp"). Both stay for good, also after the user edits the
// entry. Key names are resolved when reading, so renaming a key shows everywhere at once.

const (
	OriginAPI = "api" // REST: /inbox, /webhooks/ingest and the other endpoints a key may use
	OriginMCP = "mcp"
)

// Tables with origin columns; RecordOrigin only takes these
const (
	OriginTableThoughts  = "thoughts"
	OriginTableListItems = "list_items"
)

// migrateOrigin replaces agent_mark (migration 12, which the user's own edit cleared) with the
// permanent origin. Old marks and the sources webhook/agent are carried over without a key.
func (s *Store) migrateOrigin() error {
	for _, table := range []string{OriginTableThoughts, OriginTableListItems} {
		for _, col := range []string{"created_via", "created_key_id", "changed_via", "changed_key_id", "changed_at"} {
			if err := s.addColumnIfMissing(table, col, "TEXT NOT NULL DEFAULT ''"); err != nil {
				return err
			}
		}
	}
	return s.execInTx(
		stmt(`UPDATE thoughts SET created_via = 'api' WHERE created_via = '' AND source = 'webhook'`),
		stmt(`UPDATE thoughts SET created_via = 'mcp' WHERE created_via = '' AND source = 'agent'`),
		stmt(`UPDATE thoughts SET changed_via = 'mcp' WHERE changed_via = '' AND agent_mark = 'edited'`),
		stmt(`UPDATE list_items SET created_via = 'mcp' WHERE created_via = '' AND agent_mark = 'created'`),
		stmt(`UPDATE list_items SET changed_via = 'mcp' WHERE changed_via = '' AND agent_mark = 'edited'`),
	)
}

// originColumns: the five origin values of a SELECT, key ids resolved to names (prefix e.g. "li." for
// an aliased table). Scan them with scanOrigin.
func originColumns(prefix string) string {
	keyName := func(col string) string {
		return `CASE WHEN ` + prefix + col + ` = '' THEN '' ELSE COALESCE((SELECT k.name FROM api_keys k WHERE k.id = ` +
			prefix + col + `), NULL) END`
	}
	return prefix + `created_via, ` + keyName("created_key_id") + `, ` + prefix + `changed_via, ` + keyName("changed_key_id") + `, ` + prefix + `changed_at`
}

// originDest holds the scanned origin columns; result is nil for entries no key ever touched. A key
// name is NULL when the key was deleted since.
type originDest struct {
	createdVia, changedVia, changedAt string
	createdKey, changedKey            sql.NullString
}

func (o *originDest) targets() []any {
	return []any{&o.createdVia, &o.createdKey, &o.changedVia, &o.changedKey, &o.changedAt}
}

func (o *originDest) result() *domain.Origin {
	if o.createdVia == "" && o.changedVia == "" {
		return nil
	}
	return &domain.Origin{
		CreatedVia: o.createdVia, CreatedKey: o.createdKey.String, CreatedKeyDeleted: !o.createdKey.Valid,
		ChangedVia: o.changedVia, ChangedKey: o.changedKey.String, ChangedKeyDeleted: !o.changedKey.Valid,
		ChangedAt: o.changedAt,
	}
}

// RecordOrigin notes that an API key created (created) or changed an entry and returns the entry's
// origin as it is now. via is OriginAPI or OriginMCP; keyID may be empty (MCP from a login session).
func (s *Store) RecordOrigin(table, id, via, keyID string, created bool) *domain.Origin {
	if table != OriginTableThoughts && table != OriginTableListItems {
		return nil
	}
	if created {
		_, _ = s.db.Exec(`UPDATE `+table+` SET created_via = ?, created_key_id = ? WHERE id = ?`, via, keyID, id)
	} else {
		_, _ = s.db.Exec(`UPDATE `+table+` SET changed_via = ?, changed_key_id = ?, changed_at = ? WHERE id = ?`, via, keyID, domain.NowISO(), id)
	}
	return s.Origin(table, id)
}

// Origin reads the origin of one entry (nil if no key touched it).
func (s *Store) Origin(table, id string) *domain.Origin {
	if table != OriginTableThoughts && table != OriginTableListItems {
		return nil
	}
	var o originDest
	if err := s.db.QueryRow(`SELECT `+originColumns("")+` FROM `+table+` WHERE id = ?`, id).Scan(o.targets()...); err != nil {
		return nil
	}
	return o.result()
}

// copyOriginToListItem: a thought turned into a list item in the triage keeps where it came from.
func (s *Store) copyOriginToListItem(thoughtID, itemID string) {
	cols := []string{"created_via", "created_key_id", "changed_via", "changed_key_id", "changed_at"}
	set := make([]string, len(cols))
	for i, c := range cols {
		set[i] = c + ` = (SELECT ` + c + ` FROM thoughts WHERE id = ?)`
	}
	args := []any{}
	for range cols {
		args = append(args, thoughtID)
	}
	args = append(args, itemID)
	_, _ = s.db.Exec(`UPDATE list_items SET `+strings.Join(set, ", ")+` WHERE id = ?`, args...)
}
