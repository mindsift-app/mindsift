package storage

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
)

var (
	// emailColumnRe: the definition of the email column in CREATE TABLE users, up to the next column
	emailColumnRe = regexp.MustCompile(`(?i)(\bemail\s+TEXT\b)([^,]*)`)
	// emailTableUniqueRe: a table constraint UNIQUE(email)
	emailTableUniqueRe = regexp.MustCompile(`(?i),\s*UNIQUE\s*\(\s*["\[` + "`" + `]?email["\]` + "`" + `]?\s*\)`)
	uniqueWordRe       = regexp.MustCompile(`(?i)\s*\bUNIQUE\b`)
	defaultWordRe      = regexp.MustCompile(`(?i)\bDEFAULT\b`)
)

// emailUnique: the users table has a UNIQUE constraint on email alone (an index of origin 'u', which the
// schema keeps however the definition spells it).
func emailUnique(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (bool, error) {
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_index_list('users') l
		WHERE l.origin = 'u' AND (SELECT group_concat(name) FROM pragma_index_info(l.name)) = 'email'`).Scan(&n)
	return n > 0, err
}

// withoutEmailUnique returns the definition of the users table without the UNIQUE of the email column
// (in any position among its constraints, or as a table constraint); the column gets an empty default.
func withoutEmailUnique(create string) string {
	out := emailTableUniqueRe.ReplaceAllString(create, "")
	return emailColumnRe.ReplaceAllStringFunc(out, func(def string) string {
		m := emailColumnRe.FindStringSubmatch(def)
		rest := uniqueWordRe.ReplaceAllString(m[2], "")
		if !defaultWordRe.MatchString(rest) {
			rest = strings.TrimRight(rest, " \t\r\n") + " DEFAULT ''"
		}
		return m[1] + rest
	})
}

// migrateEmailOptional is migration 40: an account may have no e-mail address (an account created at a
// first sign-in through a provider whose address is not confirmed yet or belongs to another account), and
// several may. The column was UNIQUE, so two empty addresses clashed; now only addresses that are there
// are unique (a partial index). SQLite cannot drop a column constraint, so the table is rebuilt as its
// documentation describes: with foreign keys off, a new table from the current definition, the rows
// copied, the old one dropped, the new one renamed, the indexes made again, the foreign keys checked.
func (s *Store) migrateEmailOptional() error {
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var create string
	if err := conn.QueryRowContext(ctx, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`).Scan(&create); err != nil {
		return err
	}
	unique, err := emailUnique(ctx, conn)
	if err != nil {
		return err
	}
	if !unique {
		// Already without the constraint (run before)
		_, err := conn.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email != ''`)
		return err
	}
	newCreate := withoutEmailUnique(create)
	newCreate = regexp.MustCompile(`(?i)^\s*CREATE\s+TABLE\s+("?users"?|\[users\])`).ReplaceAllString(newCreate, "CREATE TABLE users_new")
	if !strings.Contains(newCreate, "users_new") {
		return fmt.Errorf("unexpected definition of the users table")
	}
	var indexes []string
	rows, err := conn.QueryContext(ctx, `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' AND sql IS NOT NULL`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var q string
		if err := rows.Scan(&q); err != nil {
			_ = rows.Close()
			return err
		}
		indexes = append(indexes, q)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()

	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer func() { _, _ = conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`) }()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Broken references the database had before (orphans of old versions, unrelated to users) do not
	// stop the migration; only ones the rebuild would add do
	before, err := foreignKeyViolations(ctx, tx)
	if err != nil {
		return err
	}
	for k, n := range before {
		slog.Warn("The database already had broken references before rebuilding the users table; they are left as they are",
			"table", k.table, "parent", k.parent, "rows", n)
	}
	steps := []string{newCreate, `INSERT INTO users_new SELECT * FROM users`, `DROP TABLE users`, `ALTER TABLE users_new RENAME TO users`}
	steps = append(steps, indexes...)
	steps = append(steps, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email != ''`)
	for _, q := range steps {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("%w (%s)", err, strings.SplitN(strings.TrimSpace(q), "\n", 2)[0])
		}
	}
	if unique, err := emailUnique(ctx, tx); err != nil {
		return err
	} else if unique {
		return fmt.Errorf("unexpected definition of the users table: the rebuilt one keeps UNIQUE on email")
	}
	after, err := foreignKeyViolations(ctx, tx)
	if err != nil {
		return err
	}
	for k, n := range after {
		if n > before[k] {
			return fmt.Errorf("foreign key check failed after rebuilding the users table (%s -> %s)", k.table, k.parent)
		}
	}
	return tx.Commit()
}

// fkViolation groups the rows PRAGMA foreign_key_check reports: by table, parent table and constraint,
// not by row, because the rows of users get new rowids in the rebuild.
type fkViolation struct {
	table, parent string
	fkid          int
}

// foreignKeyViolations counts the broken references in the whole database.
func foreignKeyViolations(ctx context.Context, tx *sql.Tx) (map[fkViolation]int, error) {
	rows, err := tx.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[fkViolation]int{}
	for rows.Next() {
		var k fkViolation
		var rowid sql.NullInt64
		if err := rows.Scan(&k.table, &rowid, &k.parent, &k.fkid); err != nil {
			return nil, err
		}
		out[k]++
	}
	return out, rows.Err()
}
