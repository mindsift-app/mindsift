package storage

import (
	"fmt"
	"math/rand"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

var benchWords = strings.Fields("Projekt Planung Server Backup Einkauf Urlaub Garten Rechnung Termin Besprechung Kunde Angebot Notiz Idee Docker Netzwerk Router Kamera Familie Schule Auto Werkstatt Versicherung Steuer Arzt Training Rezept Kochen Buch Film Musik Konzert Reise Hotel Flug Bahn")

// BenchmarkSearch: 30 notes of 150 bullets and 200 tasks, a realistic workspace. Profile with
//
//	go test -run XXX -bench BenchmarkSearch -cpuprofile cpu.out ./internal/storage/
func BenchmarkSearch(b *testing.B) {
	store, _ := NewStore(filepath.Join(b.TempDir(), "bench.db"))
	defer store.Close()
	u, _ := store.CreateUser("a@example.com", "h", "A", "member")
	r := rand.New(rand.NewSource(1))
	for d := 0; d < 30; d++ {
		blocks := make([]domain.DocumentBlock, 150)
		for i := range blocks {
			var sb strings.Builder
			for w := 0; w < 8+r.Intn(10); w++ {
				sb.WriteString(benchWords[r.Intn(len(benchWords))] + " ")
			}
			blocks[i] = domain.DocumentBlock{ID: fmt.Sprintf("b%d_%d", d, i), Type: "bullet", Content: sb.String(), Level: r.Intn(3)}
		}
		_, _ = store.CreateDocument(u.ID, "", fmt.Sprintf("Notiz %d %s", d, benchWords[d%len(benchWords)]), "", "", blocks, nil, false)
	}
	for i := 0; i < 200; i++ {
		_, _ = store.CreateThought(u.ID, benchWords[r.Intn(len(benchWords))]+" "+benchWords[r.Intn(len(benchWords))], "normal", "manual", "")
	}
	b.ResetTimer()
	for _, q := range []string{"Server", "Se", "Projekt Planung"} {
		b.Run(q, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				if _, err := store.SearchGlobal(u.ID, q); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
