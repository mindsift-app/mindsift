package storage

import (
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// edit applies operations to a note like a client would.
func edit(t *testing.T, s *Store, userID, docID string, build func(d *collab.Doc) []collab.Op) {
	t.Helper()
	if _, _, err := s.applyDocChange(docID, collab.Actor{UserID: userID, ClientID: "test"}, nil, build); err != nil {
		t.Fatal(err)
	}
}

func lastChildKey(d *collab.Doc, parent string) string {
	key := ""
	for _, c := range d.Children(parent) {
		key = c.OrderKey
	}
	return key
}

// Linked tasks follow their note in both directions: tick, title and subtasks (1:1, wherever the
// checkbox goes); new checkboxes directly under the task become subtasks; deleting is not mirrored.
func TestLinkedTaskAndSubtasksFollowTheNote(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "sync.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	th, _ := s.CreateThoughtWithDetails(anna.ID, "Umzug planen", "normal", "manual", "", "", "todo", "")
	_, _ = s.UpdateThoughtTriage(anna.ID, th.ID, "keep", "task", "", "", "")
	subs := []domain.SubTask{{ID: "st1", Title: "Kartons besorgen"}, {ID: "st2", Title: "Helfer fragen"}}
	_, _ = s.UpdateThoughtDetails(anna.ID, th.ID, nil, nil, nil, nil, nil, nil, nil, &subs, nil)
	task, err := s.UpdateThoughtTriage(anna.ID, th.ID, "keep", "document", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	docID, mainID := task.DocID, task.BlockID
	if task.Subtasks[0].BlockID == "" || task.Subtasks[1].BlockID == "" {
		t.Fatalf("deepening should tie the subtasks to their checkboxes: %+v", task.Subtasks)
	}
	kartons := task.Subtasks[0].BlockID
	if _, subLinks := s.DocTaskLinks(docID); subLinks[kartons] != th.ID {
		t.Fatalf("subtask checkbox should be reported for the badge: %v", subLinks)
	}

	// Note → task: tick and title of a subtask, title of the main checkbox
	edit(t, s, anna.ID, docID, func(d *collab.Doc) []collab.Op {
		yes := true
		text := "Umzugskartons besorgen"
		main := "Umzug nach Leipzig planen"
		return []collab.Op{
			{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: kartons, Patch: &collab.PropsPatch{Checked: &yes}},
			{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: kartons, BaseVersion: d.Blocks[kartons].Version, Content: &text},
			{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: mainID, BaseVersion: d.Blocks[mainID].Version, Content: &main},
		}
	})
	if changed := s.ReconcileDocTaskLinks(docID); len(changed) != 1 {
		t.Fatalf("task should change: %v", changed)
	}
	got, _ := s.GetThoughtByID(anna.ID, th.ID)
	if got.Content != "Umzug nach Leipzig planen" || !got.Subtasks[0].IsCompleted || got.Subtasks[0].Title != "Umzugskartons besorgen" {
		t.Fatalf("note changes should reach the task: %+v", got)
	}

	// New checkbox directly under the main one → subtask; one level deeper → stays in the note only
	var direct, deeper string
	edit(t, s, anna.ID, docID, func(d *collab.Doc) []collab.Op {
		k1, _ := collab.KeyBetween(lastChildKey(d, mainID), "")
		direct, deeper = domain.NewID("blk"), domain.NewID("blk")
		p1, p2 := mainID, kartons
		t1, t2 := "Strom ummelden", "Zählerstand fotografieren"
		k2, _ := collab.KeyBetween("", "")
		return []collab.Op{
			{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: direct, ParentID: &p1, OrderKey: k1, Type: "todo", Content: &t1, Props: &collab.Props{}},
			{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: deeper, ParentID: &p2, OrderKey: k2, Type: "todo", Content: &t2, Props: &collab.Props{}},
		}
	})
	s.ReconcileDocTaskLinks(docID)
	got, _ = s.GetThoughtByID(anna.ID, th.ID)
	if len(got.Subtasks) != 3 || got.Subtasks[2].BlockID != direct || got.Subtasks[2].Title != "Strom ummelden" {
		t.Fatalf("checkbox right under the task should become a subtask (and only that one): %+v", got.Subtasks)
	}

	// Moving a subtask checkbox elsewhere in the note keeps the link
	edit(t, s, anna.ID, docID, func(d *collab.Doc) []collab.Op {
		top := ""
		k, _ := collab.KeyBetween(lastChildKey(d, ""), "")
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpMove, BlockID: direct, ParentID: &top, OrderKey: k}}
	})
	s.ReconcileDocTaskLinks(docID)
	got, _ = s.GetThoughtByID(anna.ID, th.ID)
	if got.Subtasks[2].BlockID != direct {
		t.Fatalf("a moved checkbox stays tied to its subtask: %+v", got.Subtasks)
	}

	// Task → note: tick and title of the main task and a subtask, a new subtask gets a checkbox
	done := true
	title := "Umzug nach Leipzig organisieren"
	subs = append(got.Subtasks, domain.SubTask{ID: "st9", Title: "Nachsendeauftrag stellen"})
	subs[1].IsCompleted = true
	// An app with an older state sends the subtasks without their links: the server keeps them
	for i := range subs {
		subs[i].BlockID = ""
	}
	_, _ = s.UpdateThoughtDetails(anna.ID, th.ID, &title, &done, nil, nil, nil, nil, nil, &subs, nil)
	if s.SyncTaskToDoc(anna.ID, th.ID) != docID {
		t.Fatal("the note should change")
	}
	d, _, _ := loadCollabDoc(s.db, docID)
	got, _ = s.GetThoughtByID(anna.ID, th.ID)
	if d.Blocks[mainID].Content != title || !d.Blocks[mainID].Props.Checked {
		t.Fatalf("main checkbox should follow the task: %+v", d.Blocks[mainID])
	}
	if !d.Blocks[got.Subtasks[1].BlockID].Props.Checked {
		t.Fatal("subtask tick should reach its checkbox")
	}
	added := got.Subtasks[3].BlockID
	if added == "" || d.Blocks[added].ParentID != mainID || d.Blocks[added].Content != "Nachsendeauftrag stellen" {
		t.Fatalf("new subtask should get a checkbox under the task: %+v", got.Subtasks)
	}
	if len(d.Children(mainID)) != 3 { // the two original subtasks and the new one ("Strom ummelden" moved away)
		t.Fatalf("no duplicate checkboxes expected: %d children", len(d.Children(mainID)))
	}

	// Deleting is not mirrored: a deleted checkbox only unlinks, a deleted subtask leaves its checkbox
	helfer := got.Subtasks[1].BlockID
	edit(t, s, anna.ID, docID, func(d *collab.Doc) []collab.Op {
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpDelete, BlockID: helfer}}
	})
	s.ReconcileDocTaskLinks(docID)
	got, _ = s.GetThoughtByID(anna.ID, th.ID)
	if len(got.Subtasks) != 4 || got.Subtasks[1].BlockID != "" {
		t.Fatalf("subtask should stay, only unlinked: %+v", got.Subtasks)
	}
	remaining := append([]domain.SubTask{}, got.Subtasks[0], got.Subtasks[2], got.Subtasks[3])
	_, _ = s.UpdateThoughtDetails(anna.ID, th.ID, nil, nil, nil, nil, nil, nil, nil, &remaining, nil)
	s.SyncTaskToDoc(anna.ID, th.ID)
	d, _, _ = loadCollabDoc(s.db, docID)
	if b := d.Blocks[kartons]; b == nil || b.Deleted {
		t.Fatal("deleting a subtask must not delete its checkbox")
	}
	// The unlinked "Helfer fragen" subtask was deleted in the task; nothing came back
	if n := len(got.Subtasks); n != 4 {
		t.Fatalf("unexpected subtasks: %d", n)
	}
}
