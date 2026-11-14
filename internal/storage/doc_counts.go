package storage

import (
	"context"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// DocCounts: what the note list shows of one note besides its metadata. The same for everyone who sees
// the note, so a change is worked out once and sent to all of them (DOC_COUNTS).
type DocCounts struct {
	ID           string         `json:"id"`
	OpenTodos    int            `json:"openTodos"`
	TagCounts    map[string]int `json:"tagCounts"`
	TagOpenTodos map[string]int `json:"tagOpenTodos"`
}

// GetDocCounts returns the counts of one note with the grouped queries of the note list (attachListStats),
// without loading the note or its bullets.
func (s *Store) GetDocCounts(ctx context.Context, docID string) (DocCounts, error) {
	one := []domain.Document{{ID: docID}}
	if err := s.attachListStats(ctx, one); err != nil {
		return DocCounts{}, err
	}
	c := DocCounts{ID: docID, OpenTodos: one[0].OpenTodos, TagCounts: one[0].TagCounts, TagOpenTodos: one[0].TagOpenTodos}
	if c.TagCounts == nil {
		c.TagCounts = map[string]int{}
		c.TagOpenTodos = map[string]int{}
	}
	return c, nil
}
