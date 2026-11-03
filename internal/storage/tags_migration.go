package storage

import (
	"encoding/json"
	"log/slog"

	"github.com/mindsift-app/mindsift/internal/domain"
)

const tagsAnchorMigrationKey = "migration_tags_without_anchors"

// migrateAnchorTags removes tags that only came from URL fragments (example.com/blog#ueberschrift) since the
// hashtag rule now requires whitespace or "(" before "#". Runs once. Only such tags are removed from
// thoughts and notes, so tags users added by hand stay; block_tags is rebuilt from the blocks.
func (s *Store) migrateAnchorTags() {
	var done string
	if s.db.QueryRow(`SELECT value FROM system_settings WHERE key = ?`, tagsAnchorMigrationKey).Scan(&done) == nil {
		return
	}
	cleaned := 0
	for _, table := range []struct{ name, text string }{{"thoughts", "content"}, {"documents", "content"}} {
		rows, err := s.db.Query(`SELECT id, ` + table.text + `, tags FROM ` + table.name + ` WHERE ` + table.text + ` LIKE '%#%'`)
		if err != nil {
			slog.Error("Cleaning up hashtags failed", "table", table.name, "error", err)
			return
		}
		type row struct{ id, text, tags string }
		var list []row
		for rows.Next() {
			var r row
			if rows.Scan(&r.id, &r.text, &r.tags) == nil {
				list = append(list, r)
			}
		}
		rows.Close()
		for _, r := range list {
			stale := domain.StaleAnchorTags(r.text)
			if len(stale) == 0 {
				continue
			}
			drop := map[string]bool{}
			for _, t := range stale {
				drop[t] = true
			}
			var tags []string
			if json.Unmarshal([]byte(r.tags), &tags) != nil {
				continue
			}
			kept := make([]string, 0, len(tags))
			for _, t := range tags {
				if !drop[t] {
					kept = append(kept, t)
				}
			}
			if len(kept) != len(tags) {
				out, _ := json.Marshal(kept)
				if _, err := s.db.Exec(`UPDATE `+table.name+` SET tags = ? WHERE id = ?`, string(out), r.id); err == nil {
					cleaned++
				}
			}
		}
	}
	if err := s.reindexAllDocBlockTags(); err != nil {
		slog.Error("Rebuilding the block hashtags failed", "error", err)
		return
	}
	_, _ = s.db.Exec(`INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, 'done')`, tagsAnchorMigrationKey)
	if cleaned > 0 {
		slog.Info("Hashtags from URL anchors removed", "entries", cleaned)
	}
}
