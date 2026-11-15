package storage

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Suggestions while typing a new list item: the entries added to a list before. "Clear completed" deletes
// ticked items, so the items themselves are no history; list_item_history keeps one row per list and
// name (lower case, spaces collapsed, hashtags removed) with the spelling and category of its last use,
// how often it was added and when last. It belongs to the list, so everyone who shares the list shares
// it, and it goes when the list is deleted (foreign key). At most listHistoryMax rows per list stay, the
// least used and longest unused go first.

const (
	listHistoryMax          = 500
	listSuggestionsDefault  = 500
	listSuggestionsMaxLimit = 500
)

var listHashtagRe = regexp.MustCompile(`#([\p{L}\p{N}_-]+)`)

// listHistoryName is an item's text as the history keeps it (hashtags removed unless that leaves nothing)
// and its key.
func listHistoryName(content string) (display, key string) {
	display = strings.Join(strings.Fields(content), " ")
	if strings.Contains(display, "#") {
		if cleaned := strings.Join(strings.Fields(listHashtagRe.ReplaceAllString(display, "")), " "); cleaned != "" {
			display = cleaned
		}
	}
	return display, strings.ToLower(display)
}

func (s *Store) migrateListItemHistory() error {
	if err := s.execSchemaStatement(`CREATE TABLE IF NOT EXISTS list_item_history (
		list_id TEXT NOT NULL,
		name_key TEXT NOT NULL,
		content TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '',
		use_count INTEGER NOT NULL DEFAULT 1,
		last_used TEXT NOT NULL,
		PRIMARY KEY (list_id, name_key),
		FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE
	)`); err != nil {
		return err
	}
	// The items still there (open and ticked, not yet cleared) are the history so far
	type entry struct {
		content, category, lastUsed string
		count                       int
	}
	byList := map[string]map[string]*entry{}
	rows, err := s.db.Query(`SELECT list_id, content, category, created_at FROM list_items ORDER BY created_at ASC`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var listID, content, category, createdAt string
		if err := rows.Scan(&listID, &content, &category, &createdAt); err != nil {
			_ = rows.Close()
			return err
		}
		display, key := listHistoryName(content)
		if key == "" {
			continue
		}
		m := byList[listID]
		if m == nil {
			m = map[string]*entry{}
			byList[listID] = m
		}
		e := m[key]
		if e == nil {
			e = &entry{}
			m[key] = e
		}
		e.count++
		e.content, e.lastUsed = display, createdAt
		if c := strings.TrimPrefix(strings.TrimSpace(category), "#"); c != "" {
			e.category = c
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()
	var stmts []sqlStmt
	for listID, m := range byList {
		for key, e := range m {
			stmts = append(stmts, stmt(`INSERT OR IGNORE INTO list_item_history (list_id, name_key, content, category, use_count, last_used)
				VALUES (?, ?, ?, ?, ?, ?)`, listID, key, e.content, e.category, e.count, e.lastUsed))
		}
		stmts = append(stmts, trimListHistory(listID))
	}
	return s.execInTx(stmts...)
}

func trimListHistory(listID string) sqlStmt {
	return stmt(`DELETE FROM list_item_history WHERE list_id = ?1 AND name_key IN (
		SELECT name_key FROM list_item_history WHERE list_id = ?1
		ORDER BY use_count DESC, last_used DESC LIMIT -1 OFFSET ?2)`, listID, listHistoryMax)
}

// recordListItemUse counts one more addition of the item to the list. An empty category keeps the one
// of earlier uses. Failures are logged: the item itself is stored already.
func (s *Store) recordListItemUse(listID, content, category, at string) {
	display, key := listHistoryName(content)
	if key == "" {
		return
	}
	category = strings.TrimPrefix(strings.TrimSpace(category), "#")
	logDBErr(s.execInTx(
		stmt(`INSERT INTO list_item_history (list_id, name_key, content, category, use_count, last_used) VALUES (?, ?, ?, ?, 1, ?)
			ON CONFLICT(list_id, name_key) DO UPDATE SET content = excluded.content,
				category = CASE WHEN excluded.category <> '' THEN excluded.category ELSE list_item_history.category END,
				use_count = list_item_history.use_count + 1, last_used = excluded.last_used`,
			listID, key, display, category, at),
		trimListHistory(listID),
	))
}

// renameListItemUse moves one use from an item's old name to its new one (a typo fixed after adding).
func (s *Store) renameListItemUse(listID, oldContent, newContent, category string) {
	_, oldKey := listHistoryName(oldContent)
	_, newKey := listHistoryName(newContent)
	if oldKey == newKey || newKey == "" {
		return
	}
	logDBErr(s.execInTx(
		stmt(`UPDATE list_item_history SET use_count = use_count - 1 WHERE list_id = ? AND name_key = ?`, listID, oldKey),
		stmt(`DELETE FROM list_item_history WHERE list_id = ? AND name_key = ? AND use_count <= 0`, listID, oldKey),
	))
	s.recordListItemUse(listID, newContent, category, domain.NowISO())
}

// setListItemUseCategory: the category an item was given later (edited, dragged into another group) is
// the one suggested next time.
func (s *Store) setListItemUseCategory(listID, content, category string) {
	_, key := listHistoryName(content)
	s.execLogged(`UPDATE list_item_history SET category = ? WHERE list_id = ? AND name_key = ?`,
		strings.TrimPrefix(strings.TrimSpace(category), "#"), listID, key)
}

// ListItemSuggestion is one entry of a list's history.
type ListItemSuggestion struct {
	Content  string `json:"content"`
	Category string `json:"category"`
	Count    int    `json:"count"`
	LastUsed string `json:"lastUsed"`
}

// listSuggestionScore: how often, weighted by how long ago (halved after 60 days without use), so a
// staple of last year does not stay ahead of this month's items. The frontend ranks the same way
// (features/lists/itemSuggestions.ts).
func listSuggestionScore(count int, lastUsed string, now time.Time) float64 {
	days := 0.0
	if t, err := time.Parse(time.RFC3339Nano, lastUsed); err == nil {
		days = math.Max(0, now.Sub(t).Hours()/24)
	}
	return float64(count) / (1 + days/60)
}

// ListItemSuggestions returns the list's history ranked for the typed text q: entries starting with it
// first, then those with a word starting with it, then those containing it; within each by
// listSuggestionScore. Without q all entries by score. Access is checked by the caller.
func (s *Store) ListItemSuggestions(listID, q string, limit int, now time.Time) ([]ListItemSuggestion, error) {
	if limit <= 0 || limit > listSuggestionsMaxLimit {
		limit = listSuggestionsDefault
	}
	rows, err := s.db.Query(`SELECT name_key, content, category, use_count, last_used FROM list_item_history WHERE list_id = ?`, listID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type ranked struct {
		ListItemSuggestion
		key   string
		tier  int
		score float64
	}
	_, query := listHistoryName(q)
	var all []ranked
	for rows.Next() {
		var r ranked
		if err := rows.Scan(&r.key, &r.Content, &r.Category, &r.Count, &r.LastUsed); err != nil {
			return nil, err
		}
		r.tier = listSuggestionTier(r.key, query)
		if r.tier < 0 {
			continue
		}
		r.score = listSuggestionScore(r.Count, r.LastUsed, now)
		all = append(all, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if a.tier != b.tier {
			return a.tier < b.tier
		}
		if a.score != b.score {
			return a.score > b.score
		}
		return a.key < b.key
	})
	out := make([]ListItemSuggestion, 0, min(limit, len(all)))
	for i := 0; i < len(all) && i < limit; i++ {
		out = append(out, all[i].ListItemSuggestion)
	}
	return out, nil
}

// listSuggestionTier: 0 the name starts with q, 1 a word in it does, 2 it contains q, -1 no match.
func listSuggestionTier(key, q string) int {
	switch {
	case q == "" || strings.HasPrefix(key, q):
		return 0
	case strings.Contains(" "+strings.Map(func(r rune) rune {
		if strings.ContainsRune("()-/,.", r) {
			return ' '
		}
		return r
	}, key), " "+q):
		return 1
	case strings.Contains(key, q):
		return 2
	}
	return -1
}
