package storage

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// BenchmarkBacklinks: the backlinks of one note among 300 notes of 30 bullets, every third note linking
// to it (the app asks for them on each opened note).
func BenchmarkBacklinks(b *testing.B) {
	store, err := NewStore(filepath.Join(b.TempDir(), "bench.db"))
	if err != nil {
		b.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	user, _ := store.CreateUser("bench@example.com", "hash", "Bench", "member")
	target, _ := store.CreateDocument(user.ID, "", "Ziel", "", "", []domain.DocumentBlock{{ID: "t0", Type: "bullet", Content: "Ziel"}}, nil, false)
	for n := 0; n < 300; n++ {
		blocks := make([]domain.DocumentBlock, 30)
		for i := range blocks {
			content := fmt.Sprintf("Punkt %d mit etwas Text, damit er nicht leer ist", i)
			if i == 0 && n%3 == 0 {
				content = fmt.Sprintf("siehe [[Ziel#%s]]", target.ID)
			} else if i == 1 {
				content = "[[Woanders]] verlinkt"
			}
			blocks[i] = domain.DocumentBlock{ID: fmt.Sprintf("b%d_%d", n, i), Type: "bullet", Content: content}
		}
		if _, err := store.CreateDocument(user.ID, "", fmt.Sprintf("Notiz %d", n), "", "", blocks, nil, false); err != nil {
			b.Fatalf("create: %v", err)
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		links, err := store.GetBacklinks(user.ID, target.ID)
		if err != nil || len(links) != 100 {
			b.Fatalf("GetBacklinks: %d %v", len(links), err)
		}
	}
}
