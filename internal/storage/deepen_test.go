package storage

import (
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// "Als Notiz vertiefen": a task stays in its list, linked to the note's first checkbox; a thought from
// the inbox still turns into the note.
func TestDeepenTaskIntoNoteKeepsTheTask(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "deepen.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	tl, _ := store.CreateTaskList(anna.ID, "", "", "Homelab", "", "")

	th, _ := store.CreateThoughtWithDetails(anna.ID, "Backup-Konzept", "high", "manual", "", tl.ID, "todo", "Restic oder Borg?")
	if _, err := store.UpdateThoughtTriage(anna.ID, th.ID, "keep", "task", "", "", tl.ID); err != nil {
		t.Fatal(err)
	}
	deepened, err := store.UpdateThoughtTriage(anna.ID, th.ID, "keep", "document", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if deepened.Status != domain.StatusKept || deepened.ConvertedType != "document_block" || deepened.DocID == "" || deepened.TaskListID != tl.ID {
		t.Fatalf("task should stay in its list, linked to the note: %+v", deepened)
	}
	tasks, _ := store.GetTasks(anna.ID, tl.ID)
	if len(tasks) != 1 || tasks[0].ID != th.ID {
		t.Fatalf("task missing from its list: %+v", tasks)
	}
	doc, err := store.GetDocumentByID(anna.ID, deepened.DocID)
	if err != nil || doc == nil || len(doc.Blocks) == 0 || doc.Blocks[0].ID != deepened.BlockID || doc.Blocks[0].Type != "todo" {
		t.Fatalf("first block should be the linked checkbox: %+v %v", doc, err)
	}
	// Due date and priority come right under the checkbox, before the description
	if len(doc.Blocks) < 3 || doc.Blocks[1].Content != "Priorität: Wichtig" || doc.Blocks[2].Content != "Restic oder Borg?" {
		t.Fatalf("priority line should follow the checkbox, then the description: %+v", doc.Blocks)
	}
	// Completing the task ticks the checkbox in the note
	if store.SyncDocBlockAndTask(anna.ID, th.ID, true) != deepened.DocID {
		t.Fatal("completing the task should tick its block")
	}

	// A thought from the inbox becomes the note as before
	inbox, _ := store.CreateThought(anna.ID, "Idee für Blogartikel", "normal", "manual", "")
	asNote, err := store.UpdateThoughtTriage(anna.ID, inbox.ID, "keep", "document", "", "", "")
	if err != nil || asNote.Status != domain.StatusConverted || asNote.ConvertedType != "document" {
		t.Fatalf("inbox thought should turn into a note: %+v %v", asNote, err)
	}
}
