package storage

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
)

// emailColumnRe: the column definition of the users table as the base schema created it
var emailColumnRe = regexp.MustCompile(`(?i)\bemail\s+TEXT\s+UNIQUE\s+NOT\s+NULL`)

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
	if !emailColumnRe.MatchString(create) {
		// Already without the constraint (a fresh database of this version, or run before)
		_, err := conn.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email != ''`)
		return err
	}
	newCreate := emailColumnRe.ReplaceAllString(create, "email TEXT NOT NULL DEFAULT ''")
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
	steps := []string{newCreate, `INSERT INTO users_new SELECT * FROM users`, `DROP TABLE users`, `ALTER TABLE users_new RENAME TO users`}
	steps = append(steps, indexes...)
	steps = append(steps, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email != ''`)
	for _, q := range steps {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("%w (%s)", err, strings.SplitN(strings.TrimSpace(q), "\n", 2)[0])
		}
	}
	if err := foreignKeysIntact(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

// foreignKeysIntact: PRAGMA foreign_key_check finds nothing (the rebuild kept every reference).
func foreignKeysIntact(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return fmt.Errorf("foreign key check failed after rebuilding the users table")
	}
	return rows.Err()
}
