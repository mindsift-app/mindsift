package storage

import (
	"errors"
	"strconv"
	"testing"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// A note created whole (API, import, agents) keeps to the same limit as bullets added later
func TestCreateDocumentKeepsToTheNoteSizeLimit(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	blocks := make([]domain.DocumentBlock, collab.MaxNoteBlocks+1)
	for i := range blocks {
		blocks[i] = domain.DocumentBlock{ID: "blk_" + strconv.Itoa(i), Type: "bullet", Content: "x"}
	}
	if _, err := store.CreateDocument(alice.ID, "", "Zu groß", "", "", blocks, nil, false); !errors.Is(err, ErrNoteTooLarge) {
		t.Fatalf("want ErrNoteTooLarge, got %v", err)
	}
	if _, err := store.CreateDocument(alice.ID, "", "Gerade noch", "", "", blocks[:collab.MaxNoteBlocks], nil, false); err != nil {
		t.Fatalf("at the limit: %v", err)
	}
}
