package storage

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// tagDetailsReference is GetTagDetails as it was before it read only the matched bullets: every matching
// note loaded whole (loadDocBlocks) and the matches cut out of it. The tests compare the two.
func tagDetailsReference(s *Store, userID, tag string) (*domain.TagDetails, error) {
	cleanTag := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(tag), "#"))
	var noteContent, noteUpdatedAt string
	_ = s.db.QueryRow(`SELECT content, updated_at FROM tag_pages WHERE user_id = ? AND tag = ?`, userID, cleanTag).Scan(&noteContent, &noteUpdatedAt)
	rows, err := s.db.Query(
		`WITH visible(id) AS (`+sqlVisibleDocIDs+`)
		 SELECT t.block_id, d.id, d.title, d.icon, d.folder_path, d.blocks_json, d.updated_at, COALESCE(u.display_name, '')
		 FROM visible
		 CROSS JOIN documents d ON d.id = visible.id
		 CROSS JOIN block_tags t ON t.document_id = d.id AND t.tag = ?2
		 LEFT JOIN users u ON d.user_id = u.id
		 WHERE d.is_archived = 0
		 ORDER BY d.updated_at DESC, d.rowid`, userID, cleanTag)
	if err != nil {
		return nil, err
	}
	type rawMatch struct{ blockID, docID, title, icon, folderPath, blocksJSON, updatedAt, ownerName string }
	var raw []rawMatch
	for rows.Next() {
		var rm rawMatch
		if err := rows.Scan(&rm.blockID, &rm.docID, &rm.title, &rm.icon, &rm.folderPath, &rm.blocksJSON, &rm.updatedAt, &rm.ownerName); err != nil {
			_ = rows.Close()
			return nil, err
		}
		raw = append(raw, rm)
	}
	_ = rows.Close()
	docMap := map[string][]rawMatch{}
	var order []string
	for _, rm := range raw {
		if _, ok := docMap[rm.docID]; !ok {
			order = append(order, rm.docID)
		}
		docMap[rm.docID] = append(docMap[rm.docID], rm)
	}
	total := 0
	groups := make([]domain.TagDocumentGroup, 0)
	for _, docID := range order {
		matches := docMap[docID]
		first := matches[0]
		blocks := s.loadDocBlocks(first.docID, first.blocksJSON)
		idx := map[string]int{}
		for i, b := range blocks {
			idx[b.ID] = i
		}
		matched := make([]domain.MatchedTagBlock, 0)
		done := map[string]bool{}
		sort.SliceStable(matches, func(i, j int) bool {
			a, okA := idx[matches[i].blockID]
			b, okB := idx[matches[j].blockID]
			return okA && (!okB || a < b)
		})
		for _, m := range matches {
			if done[m.blockID] {
				continue
			}
			i, ok := idx[m.blockID]
			if !ok {
				continue
			}
			root := blocks[i]
			done[root.ID] = true
			children := make([]domain.DocumentBlock, 0)
			for j := i + 1; j < len(blocks) && blocks[j].Level > root.Level; j++ {
				children = append(children, blocks[j])
				done[blocks[j].ID] = true
			}
			matched = append(matched, domain.MatchedTagBlock{RootBlock: root, Children: children})
			total++
		}
		if len(matched) == 0 {
			continue
		}
		role := s.DocRole(userID, first.docID)
		if role == "" {
			continue
		}
		permission := map[string]string{DocRoleOwner: "owner", DocRoleEditor: "write"}[role]
		if permission == "" {
			permission = "read"
		}
		groups = append(groups, domain.TagDocumentGroup{DocID: first.docID, Title: first.title, Icon: first.icon, FolderPath: first.folderPath,
			UpdatedAt: first.updatedAt, IsOwner: role == DocRoleOwner, Permission: permission, OwnerName: first.ownerName, MatchedBlocks: matched})
	}
	return &domain.TagDetails{Tag: cleanTag, NoteContent: noteContent, NoteUpdatedAt: noteUpdatedAt, Documents: groups, TotalMatches: total}, nil
}

func sameTagDetails(t *testing.T, s *Store, userID, tag string) *domain.TagDetails {
	t.Helper()
	got, err := s.GetTagDetails(userID, tag)
	if err != nil {
		t.Fatal(err)
	}
	want, err := tagDetailsReference(s, userID, tag)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		g, _ := json.MarshalIndent(got, "", " ")
		w, _ := json.MarshalIndent(want, "", " ")
		t.Fatalf("#%s differs from loading whole notes:\ngot  %s\nwant %s", tag, g, w)
	}
	return got
}

// GetTagDetails reads only the matched bullets and their subtrees, and answers exactly as cutting them out
// of whole notes did: nesting levels, positions, order in the note, tagged bullets under tagged ones,
// bullets under a deleted parent, task links and subtask links, shared notes.
func TestTagDetailsSameAsWholeNotes(t *testing.T) {
	s, owner := newSyncTestStore(t)
	reader, err := s.CreateUser("leser@example.com", "h", "Leser", "member")
	if err != nil {
		t.Fatal(err)
	}
	// A note with nesting: a tagged bullet with children, a tagged child below it, a tagged bullet
	// deeper down, a tagged bullet whose parent is deleted later
	blocks := []domain.DocumentBlock{
		{ID: "a", Type: "h1", Content: "Kopf"},
		{ID: "b", Type: "bullet", Content: "Projekt #thema", Level: 1, Collapsed: true},
		{ID: "c", Type: "todo", Content: "Erste Aufgabe", Level: 2, Checked: true},
		{ID: "d", Type: "bullet", Content: "Unterpunkt #thema", Level: 2},
		{ID: "e", Type: "code", Content: "x := 1", Level: 3, Lang: "go"},
		{ID: "f", Type: "bullet", Content: "Daneben", Level: 1},
		{ID: "g", Type: "bullet", Content: "Tiefer #thema", Level: 2},
		{ID: "h", Type: "bullet", Content: "Eltern weg", Level: 0},
		{ID: "i", Type: "bullet", Content: "Unter gelöschtem #thema", Level: 1},
		{ID: "j", Type: "todo", Content: "Mit Aufgabe #thema", Level: 0},
		{ID: "k", Type: "bullet", Content: "Zuletzt #thema", Level: 0},
	}
	doc, err := s.CreateDocument(owner.ID, "", "Verschachtelt", "📁", "Ordner", blocks, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	// A task from the checkbox, with a subtask that becomes a checkbox under it
	task, err := s.CreateTaskFromDocBlock(owner.ID, doc.ID, "j", "Mit Aufgabe #thema", false)
	if err != nil {
		t.Fatal(err)
	}
	subs := []domain.SubTask{{Title: "Teilschritt"}}
	if _, err := s.UpdateThoughtDetails(owner.ID, task.ID, nil, nil, nil, nil, nil, nil, nil, &subs, nil); err != nil {
		t.Fatal(err)
	}
	s.SyncTaskToDoc(owner.ID, task.ID)
	if _, err := s.db.Exec(`UPDATE blocks SET deleted = 1, deleted_at = ? WHERE document_id = ? AND id = 'h'`, domain.NowISO(), doc.ID); err != nil {
		t.Fatal(err)
	}

	// More notes, some shared for reading, with random nesting
	r := rand.New(rand.NewSource(7))
	for n := 0; n < 12; n++ {
		var bl []domain.DocumentBlock
		level := 0
		for i := 0; i < 30; i++ {
			level = max(0, min(level+r.Intn(3)-1, 4))
			c := fmt.Sprintf("Punkt %d", i)
			if r.Intn(4) == 0 {
				c += " #thema"
			}
			bl = append(bl, domain.DocumentBlock{ID: fmt.Sprintf("n%d_%d", n, i), Type: []string{"bullet", "todo", "paragraph"}[r.Intn(3)], Content: c, Level: level, Checked: r.Intn(2) == 0})
		}
		d, err := s.CreateDocument(owner.ID, "", fmt.Sprintf("Notiz %d", n), "", "", bl, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		if n%3 == 0 {
			if _, err := s.CreateDocShare(owner.ID, d.ID, reader.ID, "read"); err != nil {
				t.Fatal(err)
			}
		}
		time.Sleep(2 * time.Millisecond) // distinct updated_at, the order of the groups
	}

	got := sameTagDetails(t, s, owner.ID, "thema")
	if got.TotalMatches == 0 || len(got.Documents) < 10 {
		t.Fatalf("too few matches to compare: %d in %d notes", got.TotalMatches, len(got.Documents))
	}
	// The nested note as the page shows it: b with its children (d is under it, not on its own), g,
	// j with the task and the subtask's checkbox, k; i is under a deleted bullet
	var nested *domain.TagDocumentGroup
	for i := range got.Documents {
		if got.Documents[i].DocID == doc.ID {
			nested = &got.Documents[i]
		}
	}
	if nested == nil {
		t.Fatal("the nested note is missing")
	}
	var roots []string
	for _, m := range nested.MatchedBlocks {
		roots = append(roots, m.RootBlock.ID)
	}
	if strings.Join(roots, ",") != "b,g,j,k" || len(nested.MatchedBlocks[0].Children) != 3 || nested.MatchedBlocks[2].RootBlock.TaskID != task.ID ||
		len(nested.MatchedBlocks[2].Children) != 1 || nested.MatchedBlocks[2].Children[0].SubtaskOf != task.ID {
		b, _ := json.MarshalIndent(nested, "", " ")
		t.Fatalf("nested note: %s", b)
	}
	sameTagDetails(t, s, reader.ID, "thema")
	sameTagDetails(t, s, owner.ID, "gibtsnicht")
}
