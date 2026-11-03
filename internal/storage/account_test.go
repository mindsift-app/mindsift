package storage

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestPurgeUserDataKeepsAccountAndOthersData(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "purge.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	blocks := []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "x"}}

	annaDoc, _ := store.CreateDocument(anna.ID, "", "Annas Notiz", "", "Ordner", blocks, nil, false)
	_, _ = store.CreateDocShare(anna.ID, annaDoc.ID, ben.ID, "write")
	benDoc, _ := store.CreateDocument(ben.ID, "", "Bens Notiz", "", "", blocks, nil, false)
	_, _ = store.CreateDocShare(ben.ID, benDoc.ID, anna.ID, "write")
	tl, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "", "")
	_, _ = store.AddTaskListShare(tl.ID, "user", ben.ID, "editor", anna.ID)
	bensTask, _ := store.CreateThoughtWithDetails(ben.ID, "Bens Aufgabe", "normal", "manual", "", tl.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(ben.ID, bensTask.ID, "keep", "task", "", "", tl.ID)
	_, _ = store.CreateThought(anna.ID, "Annas Gedanke", "normal", "manual", "")
	list, _ := store.CreateList(anna.ID, "Einkauf", "", "shopping")
	_, _ = store.CreateListItem(list.ID, "Milch", "", "", 0, anna.ID)
	_, _ = store.SaveUserTheme(anna.ID, "", "Wald", ":root{--accent-primary:#16a34a}")

	if err := store.PurgeUserData(anna.ID); err != nil {
		t.Fatalf("PurgeUserData: %v", err)
	}

	if docs, _ := store.GetDocuments(anna.ID); len(docs) != 1 || docs[0].ID != benDoc.ID {
		t.Errorf("Anna should only still see Ben's shared note, got %+v", docs)
	}
	if th, _ := store.GetThoughts(anna.ID, "all", 100); len(th) != 0 {
		t.Errorf("Anna's thoughts must be gone, got %d", len(th))
	}
	if tls, _ := store.GetTaskLists(anna.ID); len(tls) != 0 {
		t.Errorf("Anna's task lists must be gone")
	}
	if l, _ := store.GetAllListsForUser(anna.ID); len(l) != 0 {
		t.Errorf("Anna's lists must be gone")
	}
	if u, err := store.GetUserByID(anna.ID); err != nil || u == nil {
		t.Errorf("the account must stay")
	}
	if th, _ := store.GetUserThemes(anna.ID); len(th) != 1 {
		t.Errorf("settings such as themes must stay")
	}
	// Ben keeps his task (now without list) and no longer sees Anna's note
	task, err := store.GetThoughtByID(ben.ID, bensTask.ID)
	if err != nil || task.TaskListID != "" {
		t.Errorf("Ben's task must survive as personal task, got %+v (%v)", task, err)
	}
	if docs, _ := store.GetDocuments(ben.ID); len(docs) != 1 {
		t.Errorf("Ben should only see his own note, got %d", len(docs))
	}
}

func TestDeleteOwnAccountProtectsLastAdmin(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "account.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	admin, _ := store.CreateUser("admin@example.com", "hash", "Admin", "admin")
	member, _ := store.CreateUser("member@example.com", "hash", "Mitglied", "member")

	if err := store.DeleteOwnAccount(admin.ID); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("last admin must not delete the account, got %v", err)
	}
	if err := store.DeleteOwnAccount(member.ID); err != nil {
		t.Fatalf("member deletes own account: %v", err)
	}
	if _, err := store.GetUserByID(member.ID); err == nil {
		t.Errorf("member account should be gone")
	}
	second, _ := store.CreateUser("admin2@example.com", "hash", "Admin 2", "admin")
	if err := store.DeleteOwnAccount(admin.ID); err != nil {
		t.Fatalf("with a second admin the first may leave: %v", err)
	}
	if !store.IsLastAdmin(second.ID) {
		t.Errorf("the remaining admin is now the last one")
	}
}
