package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A move that names a task deleted in the meantime goes through for the others and says what it applied
func TestReorderWithDeletedTaskSucceeds(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	viewer, viewerToken := newTestUser(t, store, "viewer@example.com")
	tl, err := store.CreateTaskList(owner.ID, "", "", "Board", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddTaskListShare(tl.ID, "user", viewer.ID, "viewer", owner.ID); err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, title := range []string{"Eins", "Zwei", "Drei"} {
		th, _ := store.CreateThoughtWithDetails(owner.ID, title, "normal", "manual", "", tl.ID, "todo", "")
		_, _ = store.UpdateThoughtTriage(owner.ID, th.ID, "keep", "task", "", "", tl.ID)
		ids = append(ids, th.ID)
	}
	if err := store.DeleteThought(owner.ID, ids[1]); err != nil {
		t.Fatal(err)
	}
	done, todo := "done", "todo"
	items := []domain.ThoughtReorderItem{
		{ID: ids[2], SortOrder: 0, KanbanStatus: &todo},
		{ID: ids[1], SortOrder: 1, KanbanStatus: &todo},
		{ID: ids[0], SortOrder: 2, KanbanStatus: &done},
	}
	path := "/api/v1/task-lists/" + tl.ID + "/tasks/reorder"

	if resp := doJSON(t, ts, http.MethodPost, path, viewerToken, map[string]any{"items": items}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("viewer: want 403, got %d", resp.StatusCode)
	}

	resp := doJSON(t, ts, http.MethodPost, path, ownerToken, map[string]any{"items": items})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("move with a deleted task: want 200, got %d", resp.StatusCode)
	}
	var body struct {
		Items   []domain.TaskOrder `json:"items"`
		Skipped []string           `json:"skipped"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if !slices.Equal(body.Skipped, []string{ids[1]}) {
		t.Errorf("skipped = %v, want the deleted task", body.Skipped)
	}
	if len(body.Items) != 2 || body.Items[0].ID != ids[2] || body.Items[1].ID != ids[0] || !body.Items[1].IsCompleted {
		t.Errorf("items = %+v", body.Items)
	}
	if th, _ := store.GetThoughtByID(owner.ID, ids[0]); th.SortOrder != 2 || !th.IsCompleted {
		t.Errorf("Eins: sortOrder %d completed %v", th.SortOrder, th.IsCompleted)
	}
}

func TestToggleDeletedListItemAnswers404(t *testing.T) {
	_, store, ts, owner, token := startRealtimeServer(t)
	list, _ := store.CreateList(owner.ID, "Einkauf", "", "shopping")
	item, _ := store.CreateListItem(list.ID, "Milch", "", "", 0, owner.ID)
	if _, err := store.DeleteListItem(item.ID); err != nil {
		t.Fatal(err)
	}
	resp := doJSON(t, ts, http.MethodPatch, "/api/v1/lists/"+list.ID+"/items/"+item.ID, token, map[string]bool{"isCompleted": true})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("want 404, got %d", resp.StatusCode)
	}
}
