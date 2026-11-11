package storage

import "fmt"

// Columns that hold folder paths. Paths stored before cleanFolderPath could carry spaces around the
// slashes ("Rancher / Kubernetes"), whose parent "Rancher " showed up as a second "Rancher".
var folderPathColumns = []struct{ table, key, column string }{
	{"documents", "id", "folder_path"},
	{"documents", "id", "sub_folder_path"},
	{"doc_user_folders", "rowid", "folder_path"},
	{"workspace_folder_mounts", "rowid", "mount_path"},
	{"workspace_folders", "id", "path"},
	{"workspace_folders", "id", "sub_path"},
	{"trashed_folders", "id", "path"},
}

// migrateFolderPaths cleans the stored folder paths and drops folder entries that became duplicates.
func (s *Store) migrateFolderPaths() error {
	var stmts []sqlStmt
	for _, c := range folderPathColumns {
		rows, err := s.db.Query(fmt.Sprintf(`SELECT %s, %s FROM %s WHERE %s LIKE '%% %%' OR %s LIKE '%%/' OR %s LIKE '/%%' OR %s LIKE '%%//%%'`,
			c.key, c.column, c.table, c.column, c.column, c.column, c.column))
		if err != nil {
			return err
		}
		for rows.Next() {
			var key any
			var path string
			if err := rows.Scan(&key, &path); err != nil {
				_ = rows.Close()
				return err
			}
			if clean := cleanFolderPath(path); clean != path {
				stmts = append(stmts, stmt(fmt.Sprintf(`UPDATE %s SET %s = ? WHERE %s = ?`, c.table, c.column, c.key), clean, key))
			}
		}
		logDBErr(rows.Err())
		if err := rows.Close(); err != nil {
			return err
		}
	}
	stmts = append(stmts, stmt(`DELETE FROM workspace_folders WHERE rowid NOT IN (
		SELECT MIN(rowid) FROM workspace_folders GROUP BY user_id, shared_folder_id, path, sub_path)`))
	return s.execInTx(stmts...)
}
