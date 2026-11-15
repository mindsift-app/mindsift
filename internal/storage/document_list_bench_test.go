package storage

import (
	"context"
	"fmt"
	"math/rand"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// BenchmarkDocumentList: the note list of a person with 136 notes (about 3,600 hashtag rows, some long
// bullets, notes shared with them directly, through a team and through a shared folder) on a server
// where 20 other people have 100 notes each. Run with
//
//	go test -run XXX -bench BenchmarkDocumentList ./internal/storage/
func BenchmarkDocumentList(b *testing.B) {
	store, me := seedListBench(b)
	ctx := context.Background()
	list, err := store.GetDocumentList(ctx, me.ID)
	if err != nil {
		b.Fatal(err)
	}
	if len(list) != 136 {
		b.Fatalf("list has %d notes, want 136", len(list))
	}

	b.ResetTimer()
	b.Run("list", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := store.GetDocumentList(ctx, me.ID); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("stats", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if err := attachListStats(store.db, list); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("docs", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := store.getDocuments(ctx, me.ID, false); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("item", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := store.GetDocumentListItem(me.ID, list[0].ID); err != nil {
				b.Fatal(err)
			}
		}
	})
}

// seedListBench builds the server of BenchmarkDocumentList and returns the person whose list it reads.
func seedListBench(b testing.TB) (*Store, *domain.User) {
	b.Helper()
	store, err := NewStore(filepath.Join(b.TempDir(), "bench.db"))
	if err != nil {
		b.Fatal(err)
	}
	sys, _ := store.GetSystemSettings()
	sys.SharingMode = SharingOpen
	_ = store.UpdateSystemSettings(sys)

	r := rand.New(rand.NewSource(1))
	words := func(n int) string {
		var sb strings.Builder
		for w := 0; w < n; w++ {
			sb.WriteString(benchWords[r.Intn(len(benchWords))] + " ")
		}
		return sb.String()
	}
	me, _ := store.CreateUser("ich@example.com", "h", "Ich", "member")
	for d := 0; d < 120; d++ {
		blocks := make([]domain.DocumentBlock, 40)
		for i := range blocks {
			bl := domain.DocumentBlock{ID: fmt.Sprintf("m%d_%d", d, i), Type: "bullet", Content: words(6 + r.Intn(8))}
			if i%3 == 0 {
				bl.Type, bl.Checked = "todo", r.Intn(2) == 0
			}
			if i < 30 {
				bl.Content += " #" + strings.ToLower(benchWords[r.Intn(10)])
			}
			if i%10 == 0 {
				bl.Content += strings.Repeat(words(20), 30) // about 5 KB
			}
			blocks[i] = bl
		}
		if _, err := store.CreateDocument(me.ID, "", fmt.Sprintf("Notiz %d", d), "", "", blocks, nil, false); err != nil {
			b.Fatal(err)
		}
	}
	team, _ := store.CreateTeam("", "Team", "")
	_ = store.AddTeamMember(team.ID, me.ID, "member")
	for u := 0; u < 20; u++ {
		other, _ := store.CreateUser(fmt.Sprintf("u%d@example.com", u), "h", fmt.Sprintf("U%d", u), "member")
		_ = store.AddTeamMember(team.ID, other.ID, "member")
		var folderPath string
		if u == 0 {
			sf, err := store.CreateSharedFolder(other.ID, "Geteilt", "Geteilt")
			if err != nil {
				b.Fatal(err)
			}
			if _, err := store.CreateFolderShare(other.ID, sf.ID, "user", me.ID, "read"); err != nil {
				b.Fatal(err)
			}
			folderPath = "Geteilt"
		}
		for d := 0; d < 100; d++ {
			blocks := make([]domain.DocumentBlock, 5)
			for i := range blocks {
				blocks[i] = domain.DocumentBlock{ID: fmt.Sprintf("o%d_%d_%d", u, d, i), Type: "bullet", Content: words(8) + " #x"}
			}
			fp := ""
			if d < 8 {
				fp = folderPath
			}
			doc, err := store.CreateDocument(other.ID, "", fmt.Sprintf("Fremd %d %d", u, d), "", fp, blocks, nil, false)
			if err != nil {
				b.Fatal(err)
			}
			switch {
			case u == 1 && d < 4:
				_, err = store.CreateDocShare(other.ID, doc.ID, me.ID, "write")
			case u == 2 && d < 4:
				_, err = store.CreateDocTeamShare(other.ID, doc.ID, team.ID, "read")
			}
			if err != nil {
				b.Fatal(err)
			}
		}
	}
	if err := store.Optimize(); err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = store.Close() })
	return store, me
}
