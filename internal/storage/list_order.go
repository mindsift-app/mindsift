package storage

import (
	"errors"
	"sort"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Order of the task lists and shared lists per person (tabs sorted by drag and drop). Lists can be shared,
// so the order belongs to the person, not to the list. Lists without a position (never sorted, or new
// since) keep the old order, most recently changed first, after the sorted ones.

const (
	ListOrderTaskLists = "task_lists"
	ListOrderLists     = "lists"
)

func (s *Store) migrateListOrder() error {
	return s.execSchemaStatement(`CREATE TABLE IF NOT EXISTS list_order (
		user_id TEXT NOT NULL,
		kind TEXT NOT NULL,
		list_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (user_id, kind, list_id)
	)`)
}

// listOrder: position per list id of one person and kind
func (s *Store) listOrder(userID, kind string) map[string]int {
	out := map[string]int{}
	rows, err := s.db.Query(`SELECT list_id, position FROM list_order WHERE user_id = ? AND kind = ?`, userID, kind)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var pos int
		if rows.Scan(&id, &pos) == nil {
			out[id] = pos
		}
	}
	return out
}

// SetListOrder stores the order of the given list ids for the person; it replaces the old one.
func (s *Store) SetListOrder(userID, kind string, ids []string) error {
	if kind != ListOrderTaskLists && kind != ListOrderLists {
		return errors.New("Ungültige Anfrage")
	}
	stmts := []sqlStmt{stmt(`DELETE FROM list_order WHERE user_id = ? AND kind = ?`, userID, kind)}
	seen := map[string]bool{}
	for i, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		stmts = append(stmts, stmt(`INSERT INTO list_order (user_id, kind, list_id, position) VALUES (?, ?, ?, ?)`, userID, kind, id, i))
	}
	return s.execInTx(stmts...)
}

// sortByListOrder puts the lists with a position first, in that order; the rest keep their order.
func sortByListOrder[T any](items []T, order map[string]int, id func(T) string) {
	if len(order) == 0 {
		return
	}
	sort.SliceStable(items, func(i, j int) bool {
		pi, iok := order[id(items[i])]
		pj, jok := order[id(items[j])]
		if iok != jok {
			return iok
		}
		return iok && pi < pj
	})
}

func taskListID(l domain.TaskList) string { return l.ID }

func sharedListID(l domain.SharedList) string { return l.ID }
