package storage

import (
	"database/sql"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Schema migrations (FLAW-13). Every step runs exactly once per database and is recorded in
// schema_migrations; a failing step stops the start with its error instead of being ignored.
// New schema changes are appended as new steps (next free id), never edited into old ones.
// PRAGMA user_version mirrors the highest applied id. Ids 1 and 2 were used by earlier releases
// (database wipes on start), so the first step here is 3.

type migration struct {
	id   int
	name string
	run  func(s *Store) error
}

var migrations = []migration{
	{3, "Base schema v0.4.1", (*Store).migrateBaseline},
	{4, "Sessions", (*Store).migrateSessions},
	{5, "Media", (*Store).migrateMedia},
	{6, "Link previews", (*Store).migrateLinkPreviews},
	{7, "Notifications", (*Store).migrateNotifications},
	{8, "Journal", (*Store).migrateJournal},
	{9, "Web-Push", (*Store).migratePush},
	{10, "Registration and invite links", (*Store).migrateRegistration},
	{11, "Email confirmation", (*Store).migrateEmailVerification},
	{12, "Marker for entries from AI agents", (*Store).migrateAgentMark},
	{13, "Origin of entries (API keys)", (*Store).migrateOrigin},
	{14, "Clean up completed tasks", (*Store).migrateDoneCleanup},
	{15, "Voice input per person", (*Store).migrateVoiceInput},
	{16, "Retention and trash for tasks", (*Store).migrateRetention},
	{17, "OAuth for MCP access", (*Store).migrateOAuth},
	{18, "Folders in the trash", (*Store).migrateFolderTrash},
	{19, "Language per person", (*Store).migrateLanguage},
	{20, "Usernames from display names", (*Store).migrateUsernames},
	{21, "Voice input language per person", (*Store).migrateVoiceLanguage},
	{22, "Hidden values in notes", (*Store).migrateNoteSecrets},
	{23, "Several organizations per person", (*Store).migrateOrganizationMembers},
	{24, "Public links to notes", (*Store).migratePublicLinks},
	{25, "Cleanup of used invites", (*Store).migrateInviteCleanup},
	{26, "Order of lists per person", (*Store).migrateListOrder},
	{27, "Folder paths without spaces around slashes", (*Store).migrateFolderPaths},
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return err
	}
	applied := map[int]bool{}
	rows, err := s.db.Query(`SELECT id FROM schema_migrations`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil {
			applied[id] = true
		}
	}
	_ = rows.Close()

	last := 0
	for _, m := range migrations {
		last = m.id
		if applied[m.id] {
			continue
		}
		slog.Info("Database migration", "id", m.id, "name", m.name)
		if err := m.run(s); err != nil {
			return fmt.Errorf("Migration %d (%s): %w", m.id, m.name, err)
		}
		if _, err := s.db.Exec(`INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)`,
			m.id, m.name, domain.NowISO()); err != nil {
			return err
		}
	}
	_, err = s.db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, last))
	return err
}

var addColumnRe = regexp.MustCompile(`(?is)^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+(.+?);?\s*$`)

// execSchemaStatement runs one schema statement; "ALTER TABLE … ADD COLUMN" only when the column is
// missing, so that a real error is never mistaken for "already there".
func (s *Store) execSchemaStatement(q string) error {
	if m := addColumnRe.FindStringSubmatch(q); m != nil {
		return s.addColumnIfMissing(m[1], m[2], m[3])
	}
	if _, err := s.db.Exec(q); err != nil {
		return fmt.Errorf("%w (%s)", err, strings.TrimSpace(q))
	}
	return nil
}

func (s *Store) addColumnIfMissing(table, column, definition string) error {
	exists, err := s.columnExists(table, column)
	if err != nil || exists {
		return err
	}
	if _, err := s.db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, column, definition)); err != nil {
		return fmt.Errorf("Spalte %s.%s anlegen: %w", table, column, err)
	}
	return nil
}

func (s *Store) columnExists(table, column string) (bool, error) {
	rows, err := s.db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, pk int
		var name, typ string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return false, err
		}
		if strings.EqualFold(name, column) {
			return true, nil
		}
	}
	return false, rows.Err()
}
