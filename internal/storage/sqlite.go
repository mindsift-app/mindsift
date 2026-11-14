package storage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
	// inMemory: the database lives in memory (tests), where each connection is a database of its own
	inMemory     bool
	maxIdleConns int
	initMu       sync.Mutex
	// dataDir is the directory of the database file ($DATA_DIR); empty for databases without a file
	dataDir string
	// mediaRoot holds the files of images and audio in notes ($DATA_DIR/media), see media.go
	mediaRoot string
	// systemBackupDir ($DATA_DIR/backups/system) takes the copy written before pending migrations
	// (migrations.go); empty for databases without a file (tests in memory)
	systemBackupDir string
	// blockRefsReady: block_refs exists (migration 41 has run), so writing blocks maintains it
	blockRefsReady atomic.Bool
	// noteStorageReady: migration 44 has run, so the log stores bullet texts by reference (doclog.go) and
	// new blocks bring their key in the search index (note_storage.go)
	noteStorageReady atomic.Bool
	// secretsKey seals the SMTP password in the system settings (sealed.go, WithSecretsKey)
	secretsKey []byte

	// OnTaskCreated is told about tasks the store creates by itself (next occurrence of a repeating
	// task), so the server can push them to connected clients.
	OnTaskCreated func(*domain.Thought)

	// ConfiguredLanguage is DEFAULT_LANGUAGE, the default language until an admin picks one
	ConfiguredLanguage string

	// The system settings as last read (GetSystemSettings); settingsGen counts the changes, so a read that
	// raced with one does not keep the old state
	settingsMu    sync.Mutex
	settingsCache *domain.SystemSettings
	settingsGen   uint64
}

func NewStore(dbPath string, opts ...StoreOption) (*Store, error) {
	if dbPath != ":memory:" && !strings.HasPrefix(dbPath, "file:") {
		dir := filepath.Dir(dbPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create data directory %s: %w", dir, err)
		}
	}

	// _txlock=immediate: transactions take the write lock when they begin. A transaction that reads
	// first and writes later would otherwise fail at once with SQLITE_BUSY while another one writes
	// (busy_timeout cannot help there); now it simply waits its turn (FLAW-23).
	// journal_size_limit: the WAL grows to the size of the largest transaction (an import, a large paste)
	// and without a limit stays that large; with it, SQLite cuts it back to 16 MB once a checkpoint has
	// written it into the database.
	dsn := dbPath
	if !strings.Contains(dsn, "?") {
		dsn += "?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)&_pragma=journal_size_limit(16777216)&_txlock=immediate"
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite db: %w", err)
	}

	// DB_MAX_CONNS=1 is for tests: any code that needs a second connection while it holds one (a query
	// inside a loop over open rows, s.db inside a transaction) then hangs at once instead of only when the
	// pool runs dry under load and everything stops for good
	maxConns := 8
	if n, err := strconv.Atoi(os.Getenv("DB_MAX_CONNS")); err == nil && n > 0 {
		maxConns = n
	}
	db.SetMaxOpenConns(maxConns)
	maxIdle := min(4, maxConns)
	db.SetMaxIdleConns(maxIdle)

	store := &Store{db: db, maxIdleConns: maxIdle,
		inMemory: strings.Contains(dbPath, ":memory:") || strings.Contains(dbPath, "mode=memory")}
	for _, opt := range opts {
		opt(store)
	}
	if dbPath != ":memory:" && !strings.HasPrefix(dbPath, "file:") {
		store.dataDir = filepath.Dir(dbPath)
		store.mediaRoot = filepath.Join(filepath.Dir(dbPath), "media")
		store.systemBackupDir = filepath.Join(filepath.Dir(dbPath), "backups", "system")
	}
	if err := store.migrate(); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}
	if err := store.Optimize(); err != nil {
		slog.Warn("Updating the query planner statistics failed", "error", err)
	}

	return store, nil
}

// minStatRows: statistics of a table analyzed with fewer rows are dropped (see Optimize).
const minStatRows = 1000

// sqlDropMisleadingStats removes statistics the planner is better off without: those of tables that were
// small when analyzed, and those of the shadow tables of FTS5 indexes (FTS5 reaches them by rowid or
// primary key only, where the default assumptions always pick the right plan).
const sqlDropMisleadingStats = `DELETE FROM sqlite_stat1 WHERE CAST(stat AS INTEGER) < ? OR tbl IN (
	SELECT m.name || s.suffix FROM sqlite_schema m,
		(SELECT '_data' AS suffix UNION ALL SELECT '_idx' UNION ALL SELECT '_content' UNION ALL SELECT '_docsize' UNION ALL SELECT '_config') s
	WHERE m.type = 'table' AND m.sql LIKE 'CREATE VIRTUAL TABLE%fts5%')`

// Optimize lets SQLite update its statistics (sqlite_stat1) for the tables that need it, so the query
// planner knows how selective each index is; without them it guesses, and picked a poor plan for
// MediaOfUser. Runs after the migrations and with the compaction every six hours. 0x10002 checks every
// table, not only the ones this connection has queried (the pool hands out any connection); SQLite caps
// the work per table (analysis_limit), so it stays quick on large databases.
//
// Statistics of small tables are not kept: they no longer fit once the table grows (an import adds
// thousands of rows in a minute, the next run is hours away), and a table the planner believes tiny is
// scanned instead of searched. On a new server the start analyzed the FTS5 index of notes with 2 rows;
// every merge of the index then read all of it to delete a few pages, each note of an import took
// longer than the one before, and the import held the write lock almost without a break, so sign-ins
// of other people failed with SQLITE_BUSY. Without statistics the planner assumes a large table.
//
// The statistics change in one transaction, so no other connection loads them half done. The connection
// that analyzed keeps the dropped estimates in memory (a reload does not reset them) and is closed.
func (s *Store) Optimize() error {
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	err = func() error {
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.Exec(`PRAGMA optimize=0x10002`); err != nil {
			return err
		}
		var hasStats int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE name = 'sqlite_stat1'`).Scan(&hasStats); err != nil {
			return err
		}
		if hasStats > 0 {
			if _, err := tx.Exec(sqlDropMisleadingStats, minStatRows); err != nil {
				return err
			}
		}
		return tx.Commit()
	}()
	if !s.inMemory {
		// Every connection to an in-memory database is a database of its own: that one stays
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		// The other connections loaded the statistics when they opened and keep them: idle ones are
		// replaced, so the new statistics reach the pool (busy ones keep theirs until they close)
		s.db.SetMaxIdleConns(0)
		s.db.SetMaxIdleConns(s.maxIdleConns)
	}
	return err
}

// SQLiteVersion is the version of the SQLite engine built into the binary (modernc.org/sqlite), logged
// at startup: scanners such as govulncheck and Trivy do not see it, since the C code is translated to Go.
func (s *Store) SQLiteVersion() (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT sqlite_version()`).Scan(&v)
	return v, err
}

// DBStats: the connection pool of the database (metrics).
func (s *Store) DBStats() sql.DBStats { return s.db.Stats() }

// Ping answers whether the database answers a query (health check with ?db=1).
func (s *Store) Ping(ctx context.Context) error {
	var one int
	return s.db.QueryRowContext(ctx, `SELECT 1`).Scan(&one)
}

func (s *Store) Close() error {
	s.forgetSystemSettings()
	return s.db.Close()
}

// dropAllTables removes every table and view; used by the demo mode reset.
func (s *Store) dropAllTables() error {
	conn, err := s.db.Conn(context.Background())
	if err != nil {
		return err
	}
	defer conn.Close()
	ctx := context.Background()
	// Views first (documents_fts_source reads two tables)
	rows, err := conn.QueryContext(ctx, `SELECT type, name FROM sqlite_master WHERE type IN ('view', 'table') AND name NOT LIKE 'sqlite_%'
		ORDER BY type = 'table'`)
	if err != nil {
		return err
	}
	var drops []string
	for rows.Next() {
		var typ, name string
		if err := rows.Scan(&typ, &name); err != nil {
			_ = rows.Close()
			return err
		}
		drops = append(drops, `DROP `+strings.ToUpper(typ)+` IF EXISTS "`+strings.ReplaceAll(name, `"`, `""`)+`"`)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()

	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	for _, q := range drops {
		if _, err := conn.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	_, err = conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`)
	return err
}

// migrateBaseline is migration 3: the complete schema as of v0.4.1, built so that it also brings any
// older database up to that state. It runs once per database (see migrations.go).
func (s *Store) migrateBaseline() error {
	schema := `
	PRAGMA journal_mode = WAL;
	PRAGMA synchronous = NORMAL;
	PRAGMA foreign_keys = ON;
	PRAGMA busy_timeout = 5000;

	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		username TEXT NOT NULL DEFAULT '',
		password_hash TEXT NOT NULL,
		display_name TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'member',
		is_active INTEGER NOT NULL DEFAULT 1,
		token_version INTEGER NOT NULL DEFAULT 1,
		alarm_channels TEXT NOT NULL DEFAULT 'discord',
		alarm_email TEXT NOT NULL DEFAULT '',
		discord_webhook_url TEXT NOT NULL DEFAULT '',
		custom_webhook_url TEXT NOT NULL DEFAULT '',
		notify_before_minutes INTEGER NOT NULL DEFAULT 30,
		avatar_url TEXT NOT NULL DEFAULT '',
		organization_id TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);

	CREATE TABLE IF NOT EXISTS user_invites (
		id TEXT PRIMARY KEY,
		code TEXT UNIQUE NOT NULL,
		email TEXT NOT NULL DEFAULT '',
		role TEXT NOT NULL DEFAULT 'member',
		organization_id TEXT NOT NULL DEFAULT '',
		created_by TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		used_by TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS thoughts (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		content TEXT NOT NULL,
		tags TEXT NOT NULL DEFAULT '[]',
		priority TEXT NOT NULL DEFAULT 'normal',
		source TEXT NOT NULL DEFAULT 'manual',
		status TEXT NOT NULL DEFAULT 'inbox',
		is_completed INTEGER NOT NULL DEFAULT 0,
		converted_type TEXT DEFAULT '',
		converted_ref_id TEXT DEFAULT '',
		due_date TEXT DEFAULT '',
		task_list_id TEXT NOT NULL DEFAULT '',
		kanban_status TEXT NOT NULL DEFAULT 'todo',
		notes TEXT NOT NULL DEFAULT '',
		alarm_sent INTEGER NOT NULL DEFAULT 0,
		subtasks TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL,
		triaged_at TEXT DEFAULT '',
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_thoughts_user_status ON thoughts(user_id, status, created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_thoughts_user_due ON thoughts(user_id, due_date);
	CREATE INDEX IF NOT EXISTS idx_thoughts_task_list ON thoughts(task_list_id);

	CREATE TABLE IF NOT EXISTS task_lists (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		space_id TEXT DEFAULT '',
		title TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '📋',
		color TEXT NOT NULL DEFAULT '#2563eb',
		columns TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_task_lists_user ON task_lists(user_id, updated_at DESC);

	-- Organizations are defined by server admins and decide who can see whom (sharing_mode = organizations)
	CREATE TABLE IF NOT EXISTS organizations (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		created_at TEXT NOT NULL
	);

	-- Teams are the user-managed groups ("Gruppen"); org_id is the creator's organization
	CREATE TABLE IF NOT EXISTS teams (
		id TEXT PRIMARY KEY,
		org_id TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS team_members (
		team_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'member',
		joined_at TEXT NOT NULL,
		PRIMARY KEY (team_id, user_id),
		FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS documents (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL DEFAULT '',
		space_id TEXT DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		folder_id TEXT NOT NULL DEFAULT '',
		markdown_cache TEXT NOT NULL DEFAULT '',
		icon TEXT NOT NULL DEFAULT '📄',
		content TEXT NOT NULL DEFAULT '',
		blocks_json TEXT NOT NULL DEFAULT '[]',
		tags TEXT NOT NULL DEFAULT '[]',
		folder_path TEXT NOT NULL DEFAULT '',
		is_pinned INTEGER NOT NULL DEFAULT 0,
		is_archived INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, is_archived, updated_at DESC);

	CREATE TABLE IF NOT EXISTS blocks (
		id TEXT PRIMARY KEY,
		document_id TEXT NOT NULL,
		content TEXT NOT NULL DEFAULT '',
		level INT NOT NULL DEFAULT 0,
		position REAL NOT NULL DEFAULT 0,
		type TEXT NOT NULL DEFAULT 'bullet',
		checked INTEGER NOT NULL DEFAULT 0,
		collapsed INTEGER NOT NULL DEFAULT 0,
		lang TEXT NOT NULL DEFAULT '',
		FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_blocks_doc_pos ON blocks(document_id, position ASC);

	CREATE TABLE IF NOT EXISTS block_tags (
		tag TEXT NOT NULL,
		document_id TEXT NOT NULL,
		block_id TEXT NOT NULL,
		PRIMARY KEY(tag, block_id),
		FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
		FOREIGN KEY(block_id) REFERENCES blocks(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_block_tags_tag ON block_tags(tag);
	CREATE INDEX IF NOT EXISTS idx_block_tags_doc ON block_tags(document_id);

	CREATE TABLE IF NOT EXISTS doc_shares (
		id TEXT PRIMARY KEY,
		doc_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		permission TEXT NOT NULL CHECK(permission IN ('read', 'write')),
		created_at TEXT NOT NULL,
		created_by TEXT NOT NULL,
		UNIQUE(doc_id, user_id),
		FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_doc_shares_user ON doc_shares(user_id);
	CREATE INDEX IF NOT EXISTS idx_doc_shares_doc ON doc_shares(doc_id);

	CREATE TABLE IF NOT EXISTS doc_pins (
		user_id TEXT NOT NULL,
		doc_id TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY(user_id, doc_id),
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_doc_pins_user ON doc_pins(user_id);

	INSERT OR IGNORE INTO doc_pins (user_id, doc_id, created_at)
	SELECT user_id, id, updated_at FROM documents WHERE is_pinned = 1;

	CREATE TABLE IF NOT EXISTS tag_pages (
		user_id TEXT NOT NULL,
		tag TEXT NOT NULL,
		content TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL,
		PRIMARY KEY(user_id, tag)
	);

	CREATE TABLE IF NOT EXISTS lists (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		title TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '🛒',
		list_type TEXT NOT NULL DEFAULT 'shopping',
		updated_at TEXT NOT NULL,
		created_at TEXT NOT NULL,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id, updated_at DESC);

	CREATE TABLE IF NOT EXISTS list_shares (
		id TEXT PRIMARY KEY,
		list_id TEXT NOT NULL,
		target_type TEXT NOT NULL CHECK(target_type IN ('team', 'user')),
		target_id TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('editor', 'viewer')),
		created_by TEXT NOT NULL,
		created_at TEXT NOT NULL,
		UNIQUE(list_id, target_type, target_id),
		FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE,
		FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_list_shares_target ON list_shares(target_type, target_id);
	CREATE INDEX IF NOT EXISTS idx_list_shares_list ON list_shares(list_id);

	CREATE TABLE IF NOT EXISTS list_items (
		id TEXT PRIMARY KEY,
		list_id TEXT NOT NULL,
		content TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '',
		quantity TEXT NOT NULL DEFAULT '',
		is_completed INTEGER NOT NULL DEFAULT 0,
		completed_by TEXT NOT NULL DEFAULT '',
		completed_by_name TEXT NOT NULL DEFAULT '',
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		completed_at TEXT NOT NULL DEFAULT '',
		FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_list_items_sync ON list_items(list_id, is_completed, sort_order ASC);

	CREATE TABLE IF NOT EXISTS api_keys (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		name TEXT NOT NULL,
		key_prefix TEXT NOT NULL,
		key_hash TEXT UNIQUE NOT NULL,
		scopes TEXT NOT NULL DEFAULT 'ingest,read',
		last_used_at TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS system_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS revoked_tokens (
		token_hash TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		revoked_at TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
	CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens(user_id);

	-- Custom CSS themes uploaded or pasted by a user (stored in the volume, survive updates)
	CREATE TABLE IF NOT EXISTS user_themes (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		name TEXT NOT NULL,
		css_content TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_user_themes_user ON user_themes(user_id);
	`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}

	// Idempotent column migrations for existing databases
	columnMigrations := []string{
		"ALTER TABLE thoughts ADD COLUMN alarm_failures INTEGER NOT NULL DEFAULT 0;",
		"ALTER TABLE documents ADD COLUMN archived_at TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE documents ADD COLUMN archived_by TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT '';",
		"CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);",
		"ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';",
		"ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;",
		"ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;",
		"ALTER TABLE users ADD COLUMN alarm_channels TEXT NOT NULL DEFAULT 'discord';",
		"ALTER TABLE users ADD COLUMN alarm_email TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE users ADD COLUMN discord_webhook_url TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE users ADD COLUMN custom_webhook_url TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE users ADD COLUMN notify_before_minutes INTEGER NOT NULL DEFAULT 30;",
		"ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';",

		"ALTER TABLE thoughts ADD COLUMN task_list_id TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE thoughts ADD COLUMN kanban_status TEXT NOT NULL DEFAULT 'todo';",
		"ALTER TABLE thoughts ADD COLUMN notes TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE thoughts ADD COLUMN alarm_sent INTEGER NOT NULL DEFAULT 0;",
		"ALTER TABLE thoughts ADD COLUMN subtasks TEXT NOT NULL DEFAULT '[]';",
		"ALTER TABLE thoughts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;",
		"CREATE INDEX IF NOT EXISTS idx_thoughts_list_sort ON thoughts(task_list_id, sort_order ASC, created_at DESC);",

		"ALTER TABLE documents ADD COLUMN folder_path TEXT NOT NULL DEFAULT '';",

		"CREATE TABLE IF NOT EXISTS doc_shares (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, user_id TEXT NOT NULL, permission TEXT NOT NULL CHECK(permission IN ('read', 'write')), created_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE(doc_id, user_id));",
		"CREATE INDEX IF NOT EXISTS idx_doc_shares_user ON doc_shares(user_id);",
		"CREATE INDEX IF NOT EXISTS idx_doc_shares_doc ON doc_shares(doc_id);",

		"ALTER TABLE task_lists ADD COLUMN columns TEXT NOT NULL DEFAULT '[]';",
		"CREATE TABLE IF NOT EXISTS task_list_shares (id TEXT PRIMARY KEY, task_list_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN ('team', 'user')), target_id TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE(task_list_id, target_type, target_id));",
		"CREATE INDEX IF NOT EXISTS idx_task_list_shares_target ON task_list_shares(target_type, target_id);",
		"CREATE INDEX IF NOT EXISTS idx_task_list_shares_list ON task_list_shares(task_list_id);",
		"ALTER TABLE task_list_shares ADD COLUMN permission TEXT NOT NULL DEFAULT 'editor';",

		"CREATE TABLE IF NOT EXISTS doc_team_shares (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, team_id TEXT NOT NULL, permission TEXT NOT NULL CHECK(permission IN ('read', 'write')), created_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE(doc_id, team_id));",
		"CREATE INDEX IF NOT EXISTS idx_doc_team_shares_team ON doc_team_shares(team_id);",
		"CREATE INDEX IF NOT EXISTS idx_doc_team_shares_doc ON doc_team_shares(doc_id);",

		"ALTER TABLE lists ADD COLUMN user_id TEXT NOT NULL DEFAULT '';",
		"CREATE TABLE IF NOT EXISTS list_shares (id TEXT PRIMARY KEY, list_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN ('team', 'user')), target_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('editor', 'viewer')), created_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE(list_id, target_type, target_id));",
		"CREATE INDEX IF NOT EXISTS idx_list_shares_target ON list_shares(target_type, target_id);",
		"CREATE INDEX IF NOT EXISTS idx_list_shares_list ON list_shares(list_id);",

		// Workspace Shared Folders & User Folder Placements
		"ALTER TABLE documents ADD COLUMN shared_folder_id TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE documents ADD COLUMN sub_folder_path TEXT NOT NULL DEFAULT '';",
		"CREATE INDEX IF NOT EXISTS idx_documents_shared_folder ON documents(shared_folder_id);",

		"CREATE TABLE IF NOT EXISTS workspace_shared_folders (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
		"CREATE INDEX IF NOT EXISTS idx_workspace_shared_folders_owner ON workspace_shared_folders(owner_id);",

		"CREATE TABLE IF NOT EXISTS workspace_folder_shares (id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN ('team', 'user')), target_id TEXT NOT NULL, permission TEXT NOT NULL CHECK(permission IN ('read', 'write')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(folder_id, target_type, target_id));",
		"CREATE INDEX IF NOT EXISTS idx_workspace_folder_shares_folder ON workspace_folder_shares(folder_id);",
		"CREATE INDEX IF NOT EXISTS idx_workspace_folder_shares_target ON workspace_folder_shares(target_type, target_id);",

		"CREATE TABLE IF NOT EXISTS workspace_folder_mounts (user_id TEXT NOT NULL, folder_id TEXT NOT NULL, mount_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, folder_id));",
		"CREATE INDEX IF NOT EXISTS idx_workspace_folder_mounts_user ON workspace_folder_mounts(user_id);",

		"CREATE TABLE IF NOT EXISTS doc_user_folders (user_id TEXT NOT NULL, doc_id TEXT NOT NULL, folder_path TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, doc_id));",
		"CREATE INDEX IF NOT EXISTS idx_doc_user_folders_user ON doc_user_folders(user_id);",

		"CREATE TABLE IF NOT EXISTS workspace_folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, shared_folder_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, sub_path TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);",
		"CREATE INDEX IF NOT EXISTS idx_workspace_folders_user ON workspace_folders(user_id);",
		"CREATE INDEX IF NOT EXISTS idx_workspace_folders_sf ON workspace_folders(shared_folder_id);",

		"ALTER TABLE documents ADD COLUMN folder_id TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE documents ADD COLUMN markdown_cache TEXT NOT NULL DEFAULT '';",

		"CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', level INT NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'bullet', checked INTEGER NOT NULL DEFAULT 0, collapsed INTEGER NOT NULL DEFAULT 0, lang TEXT NOT NULL DEFAULT '', FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE);",
		"CREATE INDEX IF NOT EXISTS idx_blocks_doc_pos ON blocks(document_id, position ASC);",

		"CREATE TABLE IF NOT EXISTS block_tags (tag TEXT NOT NULL, document_id TEXT NOT NULL, block_id TEXT NOT NULL, PRIMARY KEY(tag, block_id), FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE, FOREIGN KEY(block_id) REFERENCES blocks(id) ON DELETE CASCADE);",
		"CREATE INDEX IF NOT EXISTS idx_block_tags_tag ON block_tags(tag);",
		"CREATE INDEX IF NOT EXISTS idx_block_tags_doc ON block_tags(document_id);",

		// Task assignments: who a task in a shared task list is assigned to
		"CREATE TABLE IF NOT EXISTS task_assignees (task_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(task_id, user_id), FOREIGN KEY(task_id) REFERENCES thoughts(id) ON DELETE CASCADE);",
		"CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);",

		// Who added an item to a (shopping) list
		"ALTER TABLE list_items ADD COLUMN created_by TEXT NOT NULL DEFAULT '';",

		// Repeating tasks: daily | weekly | monthly | yearly
		"ALTER TABLE thoughts ADD COLUMN recurrence TEXT NOT NULL DEFAULT '';",
		"ALTER TABLE thoughts ADD COLUMN recurrence_spawned INTEGER NOT NULL DEFAULT 0;",
	}
	for _, q := range columnMigrations {
		if err := s.execSchemaStatement(q); err != nil {
			return err
		}
	}

	// Clean up legacy space and old document block/crdt tables
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS spaces`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS space_members`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS space_team_shares`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS document_crdt_state`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS document_crdt_updates`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS document_blocks`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS doc_block_tags`); err != nil {
		return err
	}

	// Backfill username for existing accounts where username is empty
	if _, err := s.db.Exec(`UPDATE users SET username = LOWER(SUBSTR(email, 1, INSTR(email, '@') - 1)) WHERE (username IS NULL OR username = '') AND INSTR(email, '@') > 0`); err != nil {
		return err
	}

	// Default system settings (public registration disabled by default; invite or admin creation required)
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO system_settings (key, value) VALUES 
		('sharing_mode', 'organizations'),
		('allow_registration', 'false'),
		('instance_name', 'MindSift'),
		('smtp_host', ''),
		('smtp_port', '587'),
		('smtp_user', ''),
		('smtp_pass', ''),
		('smtp_from', ''),
		('smtp_tls', 'true'),
		('smtp_skip_verify', 'false'),
		('allow_private_webhooks', 'false')`); err != nil {
		return err
	}

	// Clean up legacy roles in team_members and users
	if _, err := s.db.Exec(`UPDATE team_members SET role = 'admin' WHERE role IN ('team_admin', 'owner')`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE team_members SET role = 'member' WHERE role NOT IN ('admin', 'member')`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE users SET role = 'member' WHERE role = 'team_admin'`); err != nil {
		return err
	}

	// Keys from before scopes existed ("ingest,read") may deliver into the inbox, as before
	if _, err := s.db.Exec(`UPDATE api_keys SET scopes = 'webhook:triage' WHERE scopes NOT LIKE '%webhook:%'`); err != nil {
		return err
	}

	// Block tree, operation log and idempotency tables for collaborative editing
	if err := s.migrateDocSync(); err != nil {
		return err
	}

	// Migrate workspace documents, blocks, folders, and strip legacy folder:* tags into pure DB tables
	s.migrateWorkspaceToPureDB()

	// Reindex block tags if table is newly added or empty
	var tagCount int
	logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM block_tags`).Scan(&tagCount))
	if tagCount == 0 {
		logDBErr(s.reindexAllDocBlockTags())
	}
	s.migrateAnchorTags()
	s.migrateSearchFTS()
	if err := s.migratePasswordReset(); err != nil {
		return err
	}

	return nil
}

// EnsureDefaultUser is retained strictly for unit test convenience
func (s *Store) EnsureDefaultUser() (*domain.User, error) {
	s.initMu.Lock()
	defer s.initMu.Unlock()

	count, err := s.CountUsers()
	if err != nil {
		return nil, err
	}
	if count > 0 {
		return s.GetFirstUser()
	}

	hash, err := auth.HashPassword("mindsift")
	if err != nil {
		return nil, err
	}
	user, err := s.CreateUser("test@mindsift.local", hash, "Admin", "admin")
	if err != nil {
		return s.GetFirstUser()
	}
	return user, nil
}

// --- DOCUMENTS (WORKSPACE - PURE DATABASE ARCHITECTURE) ---

func stripFolderTags(tags []string) []string {
	if len(tags) == 0 {
		return []string{}
	}
	cleaned := make([]string, 0, len(tags))
	for _, t := range tags {
		if !strings.HasPrefix(strings.TrimSpace(t), "folder:") {
			cleaned = append(cleaned, t)
		}
	}
	return cleaned
}

func (s *Store) migrateWorkspaceToPureDB() {
	now := domain.NowISO()

	// 1. Migrate documents.blocks_json into document_blocks for any doc without rows in document_blocks
	rows, err := s.db.Query(`
		SELECT d.id, d.user_id, d.blocks_json, d.tags, d.folder_path, d.updated_at
		FROM documents d
	`)
	if err == nil {
		type migDoc struct {
			id, userID, blocksJSON, tagsJSON, folderPath, updatedAt string
		}
		var docsToMigrate []migDoc
		for rows.Next() {
			var md migDoc
			if err := rows.Scan(&md.id, &md.userID, &md.blocksJSON, &md.tagsJSON, &md.folderPath, &md.updatedAt); !dbFailed(err) {
				docsToMigrate = append(docsToMigrate, md)
			}
		}
		logDBErr(rows.Err())
		_ = rows.Close()

		for _, md := range docsToMigrate {
			var count int
			logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE document_id = ?`, md.id).Scan(&count))
			if count == 0 && md.blocksJSON != "" && md.blocksJSON != "[]" {
				var blocks []domain.DocumentBlock
				if err := json.Unmarshal([]byte(md.blocksJSON), &blocks); err == nil && len(blocks) > 0 {
					ts := md.updatedAt
					if ts == "" {
						ts = now
					}
					s.replaceDocBlocksInDB(md.id, md.userID, blocks, ts)
				}
			}

			// Strip legacy folder:* tags from documents.tags
			if strings.Contains(md.tagsJSON, "folder:") {
				var tags []string
				if err := json.Unmarshal([]byte(md.tagsJSON), &tags); err == nil {
					cleaned := stripFolderTags(tags)
					cleanedBytes, _ := json.Marshal(cleaned)
					s.execLogged(`UPDATE documents SET tags = ? WHERE id = ?`, string(cleanedBytes), md.id)
				}
			}

			// Ensure personal folder exists in workspace_folders
			if md.folderPath != "" {
				var existsID string
				err := s.db.QueryRow(`SELECT id FROM workspace_folders WHERE user_id = ? AND path = ?`, md.userID, md.folderPath).Scan(&existsID)
				if err == sql.ErrNoRows {
					s.execLogged(`INSERT INTO workspace_folders (id, user_id, shared_folder_id, path, sub_path, created_at) VALUES (?, ?, '', ?, '', ?)`,
						domain.NewID("wfld"), md.userID, md.folderPath, now)
				}
			}
		}
	}

	// 2. Sync all existing shared folders so all docs/subfolders in their owner's mount path are linked
	sfRows, err := s.db.Query(`
		SELECT f.id, f.owner_id, COALESCE(m.mount_path, f.name)
		FROM workspace_shared_folders f
		LEFT JOIN workspace_folder_mounts m ON m.folder_id = f.id AND m.user_id = f.owner_id
	`)
	if err == nil {
		type sfInfo struct{ id, ownerID, mountPath string }
		var sfs []sfInfo
		for sfRows.Next() {
			var info sfInfo
			if err := sfRows.Scan(&info.id, &info.ownerID, &info.mountPath); !dbFailed(err) {
				sfs = append(sfs, info)
			}
		}
		logDBErr(sfRows.Err())
		_ = sfRows.Close()
		for _, info := range sfs {
			if err := s.syncSharedFolderContents(info.ownerID, info.id, info.mountPath); err != nil {
				slog.Error("Syncing shared folders failed", "folder", info.id, "error", err)
			}
		}
	}
}

// sqlStmt is one statement of a change with several steps (FLAW-14).
type sqlStmt struct {
	query string
	args  []any
}

func stmt(query string, args ...any) sqlStmt { return sqlStmt{query, args} }

// execInTx runs all statements in one transaction: either every step is stored or none, and the
// first error is returned instead of being ignored.
func (s *Store) execInTx(stmts ...sqlStmt) error {
	if len(stmts) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, st := range stmts {
		if _, err := tx.Exec(st.query, st.args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}
