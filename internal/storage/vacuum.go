package storage

import (
	"context"
	"fmt"
	"log/slog"
)

// The database file shrinks after deletes (incremental auto_vacuum). Without auto_vacuum SQLite keeps
// the pages freed by deletes for reuse and the file never gets smaller: a purged trash, an account
// deleted, the log compacted. With auto_vacuum=INCREMENTAL it keeps what it needs to move pages, and
// PRAGMA incremental_vacuum hands free pages at the end of the file back to the system.
//   - New databases: the connection string sets auto_vacuum(2) on every connection (NewStore); it takes
//     effect when the first table is created. On an existing database the setting only waits for the
//     next VACUUM (as VACUUM writes the file anew), so the demo's wipe and migration 44 switch it too.
//   - Existing databases: migration 49 runs VACUUM once to switch (migrateIncrementalVacuum), unless the
//     file is larger than autoVacuumSwitchMax or there is no room for VACUUM's copies; such a database
//     keeps auto_vacuum=NONE and can be switched by hand (see Doku/database.md).
//   - Every compaction run (six hours) calls ReclaimFreePages, which gives back free pages when there
//     are enough of them; on a database without incremental auto_vacuum it does nothing.

const (
	// autoVacuumSwitchMax: larger databases are not switched at the start (VACUUM takes about a second
	// per 50–100 MB and blocks the start that long)
	autoVacuumSwitchMax = 1 << 30
	// reclaimMinBytes and reclaimMinShare: ReclaimFreePages only acts when at least this much of the
	// file is free (4 MB and a tenth); free pages are reused by the next writes anyway, and giving back a
	// few only for the file to grow again costs writes for nothing
	reclaimMinBytes = 4 << 20
	reclaimMinShare = 10
	// reclaimMaxBytes: at most this much is given back per run, so the write lock is held briefly
	reclaimMaxBytes = 64 << 20
)

// autoVacuumMode is PRAGMA auto_vacuum: 0 none, 1 full, 2 incremental.
func (s *Store) autoVacuumMode() (int, error) {
	var mode int
	err := s.db.QueryRow(`PRAGMA auto_vacuum`).Scan(&mode)
	return mode, err
}

// migrateIncrementalVacuum is migration 49: an existing database is switched to incremental
// auto_vacuum with one VACUUM, when that is cheap enough (see above). Skipped or failed, the database
// keeps working as before (the start goes on), only the file does not shrink.
func (s *Store) migrateIncrementalVacuum() error {
	mode, err := s.autoVacuumMode()
	if err != nil || mode == 2 || s.dataDir == "" {
		return err
	}
	var pageSize, pages, free int64
	if dbFailed(s.db.QueryRow(`PRAGMA page_size`).Scan(&pageSize)) ||
		dbFailed(s.db.QueryRow(`PRAGMA page_count`).Scan(&pages)) ||
		dbFailed(s.db.QueryRow(`PRAGMA freelist_count`).Scan(&free)) {
		return nil
	}
	if pages*pageSize > autoVacuumSwitchMax {
		slog.Warn("Not switching the database to incremental auto_vacuum at the start: the file is large; it stays as it is (see Doku/database.md to switch by hand)",
			"size_mb", pages*pageSize>>20)
		return nil
	}
	if !s.vacuumHasRoom((pages - free) * pageSize) {
		return nil
	}
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	slog.Info("Switching the database to incremental auto_vacuum (VACUUM once)", "size_mb", pages*pageSize>>20)
	// Set on this connection as well: a connection string given from outside may not carry it
	_, err = conn.ExecContext(ctx, `PRAGMA auto_vacuum = INCREMENTAL`)
	if err == nil {
		_, err = conn.ExecContext(ctx, `VACUUM`)
	}
	if err != nil {
		slog.Warn("Switching to incremental auto_vacuum failed; the database stays as it is", "error", err)
		return nil
	}
	// VACUUM went through the WAL: write it back and empty it
	if _, err := conn.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		slog.Warn("Checkpoint after VACUUM failed", "error", err)
	}
	return nil
}

// ReclaimFreePages gives free pages back to the file system (PRAGMA incremental_vacuum) when the
// database has incremental auto_vacuum and at least reclaimMinBytes and a tenth of the file are free,
// at most reclaimMaxBytes per call. It returns the number of bytes given back. The file shrinks in the
// WAL first and on disk at the next checkpoint.
func (s *Store) ReclaimFreePages() (int64, error) {
	mode, err := s.autoVacuumMode()
	if err != nil || mode != 2 {
		return 0, err
	}
	var pageSize, pages, free int64
	if err := s.db.QueryRow(`PRAGMA page_size`).Scan(&pageSize); err != nil {
		return 0, err
	}
	if err := s.db.QueryRow(`PRAGMA page_count`).Scan(&pages); err != nil {
		return 0, err
	}
	if err := s.db.QueryRow(`PRAGMA freelist_count`).Scan(&free); err != nil {
		return 0, err
	}
	if free*pageSize < reclaimMinBytes || free*reclaimMinShare < pages {
		return 0, nil
	}
	// A PRAGMA takes no bound parameters; n is a number computed here
	if _, err := s.db.Exec(fmt.Sprintf(`PRAGMA incremental_vacuum(%d)`, min(free, reclaimMaxBytes/pageSize))); err != nil {
		return 0, err
	}
	var after int64
	if err := s.db.QueryRow(`PRAGMA page_count`).Scan(&after); err != nil {
		return 0, err
	}
	return (pages - after) * pageSize, nil
}
