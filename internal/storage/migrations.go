package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

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
	{28, "Links to notes carry the note's id", (*Store).migrateWikiLinksToIDs},
	{29, "Muted task lists and due alarms per person", (*Store).migrateTaskAlerts},
	{30, "Mentions in notes", (*Store).migrateMentions},
	{31, "Notification center", (*Store).migrateCenter},
	{32, "Reminders per task", (*Store).migrateReminders},
	{33, "New e-mail addresses wait for confirmation", (*Store).migrateEmailChanges},
	{34, "Profile pictures only uploaded or emoji", (*Store).migrateAvatars},
	{35, "Mail alarms go to the login address", (*Store).migrateAlarmToLoginAddress},
	{36, "Guided tour offered once to new accounts", (*Store).migrateTourOffer},
	{37, "Two-factor sign-in: authenticator app, recovery codes, trusted devices", (*Store).migrateMFA},
	{38, "Passkeys", (*Store).migratePasskeys},
	{39, "Sign-in through an OpenID Connect provider", (*Store).migrateOIDC},
	{40, "Accounts without an e-mail address", (*Store).migrateEmailOptional},
}

func (s *Store) migrate() error {
	// A database without any table is new (or was just emptied by the demo reset): nothing to back up
	var tables int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).Scan(&tables); err != nil {
		return err
	}
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return err
	}
	applied := map[int]bool{}
	lastApplied := 0
	rows, err := s.db.Query(`SELECT id FROM schema_migrations`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return err
		}
		applied[id] = true
		lastApplied = max(lastApplied, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()

	known, pending := 0, false
	for _, m := range migrations {
		known = max(known, m.id)
		pending = pending || !applied[m.id]
	}
	// An older binary on a database a newer one has migrated would run on a schema it does not know
	if lastApplied > known {
		return s.newerDatabase(lastApplied, known)
	}
	if pending && tables > 0 && s.systemBackupDir != "" {
		if err := s.backupBeforeMigrations(lastApplied); err != nil {
			return err
		}
	}

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
	if _, err = s.db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, last)); err != nil {
		return err
	}
	s.migrationsFinished()
	return nil
}

// Before pending migrations run on a database with content, a gzip-compressed copy of it goes to
// $DATA_DIR/backups/system/pre-migration-<last applied id>-<time>.db.gz, the way back after an update.
// The last preMigrationKeep copies stay; they are not part of the daily backups (other name, no
// retention in days). Without the copy nothing is migrated. Migrations are not one transaction: a step
// that fails can leave the database half migrated, and a restart loop would copy that state again and
// again. So the marker file names the copy taken before the attempt, until the migrations have run
// through; while it is there, that copy is kept besides the newest ones.

const (
	preMigrationKeep   = 3
	preMigrationMarker = "pre-migration-pending"
)

var (
	preMigrationNameRe = regexp.MustCompile(`^pre-migration-(\d+)-(\d{4}-\d{2}-\d{2}-\d{6})\.db\.gz$`)
	// migrationNow: the time in the name of the copy (tests set it)
	migrationNow = time.Now
)

// NewerDatabaseError: the database has a migration this binary does not know, so an older MindSift was
// started on a database a newer one has already migrated.
type NewerDatabaseError struct {
	DatabaseID int // highest migration applied to the database
	KnownID    int // highest migration this binary knows
	BackupDir  string
}

func (e *NewerDatabaseError) Error() string {
	where := "a pre-migration backup"
	if e.BackupDir != "" {
		where = "a pre-migration backup from " + e.BackupDir
	}
	return fmt.Sprintf("the database has migration %d, this MindSift version knows only up to %d: an older version is running on a database a newer version has migrated. "+
		"Run the newer image again, or roll back: stop MindSift, restore %s (unpack it and put it in place of mindsift.db, removing mindsift.db-wal and mindsift.db-shm) and start the older image",
		e.DatabaseID, e.KnownID, where)
}

func (s *Store) newerDatabase(dbID, known int) error {
	err := &NewerDatabaseError{DatabaseID: dbID, KnownID: known, BackupDir: s.systemBackupDir}
	slog.Error("Database is newer than this MindSift version; not starting, so it stays untouched",
		"database_migration", dbID, "known_migration", known, "backups", s.systemBackupDir)
	return err
}

// backupBeforeMigrations writes the copy before migrating; an error stops the start before anything
// changed (a full disk, most likely).
func (s *Store) backupBeforeMigrations(lastApplied int) error {
	dir := s.systemBackupDir
	now := migrationNow()
	name := fmt.Sprintf("pre-migration-%d-%s.db.gz", lastApplied, now.Format("2006-01-02-150405"))
	if err := s.writeSnapshot(dir, name, now); err != nil {
		slog.Error("Backup before the database migration failed; MindSift does not migrate without one and stops. "+
			"The copy needs free space of about the size of the database (mindsift.db) in the backup folder; free some and start again",
			"folder", dir, "error", err)
		return fmt.Errorf("backup before the database migration to %s failed, the database was not changed (free disk space and start again): %w", dir, err)
	}
	marker := filepath.Join(dir, preMigrationMarker)
	pinned := ""
	if b, err := os.ReadFile(marker); err == nil {
		prev := strings.TrimSpace(string(b))
		if _, err := os.Stat(filepath.Join(dir, prev)); err == nil && preMigrationNameRe.MatchString(prev) && prev != name {
			pinned = prev
		}
	}
	if pinned == "" {
		if err := os.WriteFile(marker, []byte(name+"\n"), 0o600); err != nil {
			slog.Warn("Could not note the pre-migration backup as pending", "file", marker, "error", err)
		}
	}
	slog.Info("Backup written before the database migration; to go back after the update, restore it (see README, Rolling back)",
		"file", filepath.Join(dir, name), "last_migration", lastApplied)
	if pinned != "" {
		slog.Warn("An earlier migration attempt did not finish; the backup from before it is kept as well",
			"file", filepath.Join(dir, pinned))
	}
	if err := prunePreMigrationBackups(dir, preMigrationKeep, pinned); err != nil {
		slog.Warn("Removing old pre-migration backups failed", "folder", dir, "error", err)
	}
	return nil
}

// migrationsFinished: the attempt went through, so its copy no longer needs to be kept on its own.
func (s *Store) migrationsFinished() {
	if s.systemBackupDir == "" {
		return
	}
	if err := os.Remove(filepath.Join(s.systemBackupDir, preMigrationMarker)); err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Warn("Could not remove the marker of the pre-migration backup", "folder", s.systemBackupDir, "error", err)
	}
}

// prunePreMigrationBackups keeps the newest keep copies in dir, pinned among them when given.
func prunePreMigrationBackups(dir string, keep int, pinned string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	type copyFile struct{ name, stamp string }
	var files []copyFile
	for _, e := range entries {
		if m := preMigrationNameRe.FindStringSubmatch(e.Name()); m != nil && !e.IsDir() && e.Name() != pinned {
			files = append(files, copyFile{e.Name(), m[2]})
		}
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].stamp != files[j].stamp {
			return files[i].stamp > files[j].stamp
		}
		return files[i].name > files[j].name
	})
	if pinned != "" {
		keep--
	}
	for i := max(keep, 0); i < len(files); i++ {
		if err := os.Remove(filepath.Join(dir, files[i].name)); err != nil {
			return err
		}
	}
	return nil
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
