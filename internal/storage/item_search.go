package storage

import "fmt"

// Migration 47: the search indexes of tasks (thoughts_fts) and list items (list_items_fts) keep no copy
// of the text and find their rows by key, the way documents_fts does since migration 44. Before, both
// stored the id of their row in an UNINDEXED column and every change deleted by that column
// (DELETE … WHERE thought_id = old.id), which FTS5 can only answer by reading the whole index: each
// change to a task or list item (ticking it, moving it on the board) read all of it, and each index
// held a copy of the text besides. Now:
//   - thoughts.fts_rowid and list_items.fts_rowid hold the key of the row in the index (1, 2, …), stored
//     so that it does not depend on rowids (VACUUM may renumber those of tables without an INTEGER
//     PRIMARY KEY);
//   - the indexes read their text from the tables (FTS5 external content), only for snippets;
//   - the triggers hand the index each change with the values it was given before (FTS5 needs exactly
//     those to take a row out) and skip changes that do not touch the searched columns.
// Search results stay as they were: the same columns are searched, and the weights bm25 gave the old
// indexes (the first of them went to the id column, which never matches) were 1 for every searched one.

func (s *Store) migrateItemSearch() error {
	for _, q := range []string{
		"ALTER TABLE thoughts ADD COLUMN fts_rowid INTEGER;",
		"ALTER TABLE list_items ADD COLUMN fts_rowid INTEGER;",
	} {
		if err := s.execSchemaStatement(q); err != nil {
			return err
		}
	}
	return s.rebuildItemSearch()
}

// itemSearchIndex describes one of the two indexes: table, its searched columns and the old triggers.
type itemSearchIndex struct {
	table, fts, triggerPrefix string
	columns                   []string
}

var itemSearchIndexes = []itemSearchIndex{
	{table: "thoughts", fts: "thoughts_fts", triggerPrefix: "trg_thoughts", columns: []string{"content", "notes", "subtasks"}},
	{table: "list_items", fts: "list_items_fts", triggerPrefix: "trg_list_items", columns: []string{"content", "category"}},
}

// itemSearchSQL creates the index of tasks and of list items as FTS5 tables with external content (the
// table itself, key fts_rowid) and their triggers, and fills them. A change to the indexed columns needs
// the index rebuilt (INSERT INTO <fts>(<fts>) VALUES('rebuild')).
func itemSearchSQL() []string {
	var out []string
	for _, ix := range itemSearchIndexes {
		cols, oldCols, newCols, changed := "", "", "", ""
		for i, c := range ix.columns {
			if i > 0 {
				cols += ", "
				oldCols += ", "
				newCols += ", "
				changed += " OR "
			}
			cols += c
			oldCols += "old." + c
			newCols += "new." + c
			changed += "old." + c + " IS NOT new." + c
		}
		del := `INSERT INTO ` + ix.fts + `(` + ix.fts + `, rowid, ` + cols + `)
			SELECT 'delete', old.fts_rowid, ` + oldCols + ` WHERE old.fts_rowid IS NOT NULL;`
		out = append(out,
			`DROP TRIGGER IF EXISTS `+ix.triggerPrefix+`_ai`,
			`DROP TRIGGER IF EXISTS `+ix.triggerPrefix+`_au`,
			`DROP TRIGGER IF EXISTS `+ix.triggerPrefix+`_ad`,
			`DROP TABLE IF EXISTS `+ix.fts,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_`+ix.table+`_fts_rowid ON `+ix.table+`(fts_rowid)`,
			// Beyond keys given already (an earlier attempt), so none repeats
			`UPDATE `+ix.table+` SET fts_rowid = rowid + (SELECT COALESCE(MAX(fts_rowid), 0) FROM `+ix.table+`) WHERE fts_rowid IS NULL`,
			`CREATE VIRTUAL TABLE `+ix.fts+` USING fts5(
				`+cols+`,
				content='`+ix.table+`',
				content_rowid='fts_rowid',
				tokenize='unicode61'
			)`,
			// A new row gets the next free key (a restored task brings none, see RestoreTrashedTask)
			`CREATE TRIGGER `+ix.triggerPrefix+`_ai AFTER INSERT ON `+ix.table+` BEGIN
				UPDATE `+ix.table+` SET fts_rowid = (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM `+ix.table+`)
				WHERE rowid = new.rowid AND fts_rowid IS NULL;
				INSERT INTO `+ix.fts+`(rowid, `+cols+`)
				SELECT fts_rowid, `+cols+` FROM `+ix.table+` WHERE rowid = new.rowid;
			END`,
			// Only when a searched column changes (not for ticking, sorting, moving on the board)
			`CREATE TRIGGER `+ix.triggerPrefix+`_au AFTER UPDATE OF `+cols+` ON `+ix.table+`
			WHEN `+changed+` BEGIN
				`+del+`
				INSERT INTO `+ix.fts+`(rowid, `+cols+`)
				SELECT new.fts_rowid, `+newCols+` WHERE new.fts_rowid IS NOT NULL;
			END`,
			`CREATE TRIGGER `+ix.triggerPrefix+`_ad AFTER DELETE ON `+ix.table+` BEGIN
				`+del+`
			END`,
			`INSERT INTO `+ix.fts+`(`+ix.fts+`) VALUES('rebuild')`,
		)
	}
	return out
}

// rebuildItemSearch replaces both indexes by those of itemSearchSQL and fills them, in one transaction.
func (s *Store) rebuildItemSearch() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range itemSearchSQL() {
		if _, err := tx.Exec(q); err != nil {
			return fmt.Errorf("%w (%.80s)", err, q)
		}
	}
	return tx.Commit()
}
