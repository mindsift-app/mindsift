package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// Databases from elsewhere: the desktop app opens a server's snapshot the person uploads
// (api/desktop_restore.go) as a store of its own. The file could be damaged or made up, so before it is
// opened as a store CheckUntrustedDatabase looks at it with schema code distrusted and a time limit, and
// the store then opens every connection the same way (WithUntrustedFile).

// untrustedPragmas: functions in the schema (triggers, views, defaults, indexes on expressions) may only
// call functions SQLite marks harmless, and every cell is checked for a sane size while it is read, so a
// damaged page is an error instead of a crash or an endless loop.
const untrustedPragmas = "&_pragma=trusted_schema(0)&_pragma=cell_size_check(1)"

var (
	// ErrDamagedDatabase: PRAGMA quick_check found the file damaged
	ErrDamagedDatabase = errors.New("database file is damaged")
	// ErrForeignSchema: the file has triggers or views MindSift's schema never created
	ErrForeignSchema = errors.New("database has triggers or views MindSift does not create")
)

// WithUntrustedFile opens the database as a file from elsewhere (untrustedPragmas on every connection).
func WithUntrustedFile() StoreOption {
	return func(s *Store) { s.untrusted = true }
}

// legacySchemaObjects: triggers and views older versions created that later migrations drop or replace,
// so a snapshot of an older server may still have them.
var legacySchemaObjects = []string{
	"task_alarm_rearm", "documents_fts_source",
	"trg_documents_ai", "trg_documents_au", "trg_documents_ad",
	"trg_blocks_ai", "trg_blocks_au", "trg_blocks_ad", "trg_blocks_refs_ad",
	"trg_thoughts_ai", "trg_thoughts_au", "trg_thoughts_ad",
	"trg_thoughts_completed", "trg_thoughts_completed_insert", "trg_thoughts_status_changed", "trg_thoughts_updated",
	"trg_list_items_ai", "trg_list_items_au", "trg_list_items_ad",
	"trg_task_assignees_added", "trg_task_assignees_removed",
}

// SchemaObjects: the names of the triggers and views in this store's database (a store migrated by this
// binary has exactly those of MindSift's schema).
func (s *Store) SchemaObjects() (map[string]bool, error) {
	return schemaObjects(context.Background(), s.db)
}

type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func schemaObjects(ctx context.Context, q queryer) (map[string]bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT name FROM sqlite_master WHERE type IN ('trigger', 'view')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out[name] = true
	}
	return out, rows.Err()
}

// CheckUntrustedDatabase looks at the SQLite file at path before it is opened as a store: schema code
// distrusted (untrustedPragmas), PRAGMA quick_check, and no trigger or view outside known (the names of
// MindSift's schema, SchemaObjects of a migrated store) and the ones older versions had. Everything runs
// within ctx: a file built to make the checks run for hours is stopped there. Nothing is written.
func CheckUntrustedDatabase(ctx context.Context, path string, known map[string]bool) error {
	db, err := sql.Open("sqlite", path+"?_pragma=query_only(1)"+untrustedPragmas)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx, `PRAGMA quick_check`)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrDamagedDatabase, err)
	}
	var problems []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			_ = rows.Close()
			return fmt.Errorf("%w: %v", ErrDamagedDatabase, err)
		}
		if line != "ok" {
			problems = append(problems, line)
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return fmt.Errorf("%w: %v", ErrDamagedDatabase, err)
	}
	if len(problems) > 0 {
		return fmt.Errorf("%w: %s", ErrDamagedDatabase, strings.Join(problems[:min(len(problems), 5)], "; "))
	}

	found, err := schemaObjects(ctx, conn)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrDamagedDatabase, err)
	}
	allowed := map[string]bool{}
	for name := range known {
		allowed[name] = true
	}
	for _, name := range legacySchemaObjects {
		allowed[name] = true
	}
	var foreign []string
	for name := range found {
		if !allowed[name] {
			foreign = append(foreign, name)
		}
	}
	if len(foreign) > 0 {
		sort.Strings(foreign)
		return fmt.Errorf("%w: %s", ErrForeignSchema, strings.Join(foreign, ", "))
	}
	return nil
}

// SnapshotAccountsContext is SnapshotAccounts within ctx (a database from elsewhere, see above).
func (s *Store) SnapshotAccountsContext(ctx context.Context) ([]SnapshotAccount, error) {
	return s.snapshotAccounts(ctx)
}
