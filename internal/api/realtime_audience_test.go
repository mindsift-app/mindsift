package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A team's task list created over REST reaches the team's apps at once (as MCP create_task_list did),
// not only after a reload; nobody outside the team hears of it.
func TestCreateTaskListReachesTheTeam(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	member, memberToken := newTestUser(t, store, "mitglied@example.com")
	_, outsiderToken := newTestUser(t, store, "fremd@example.com")
	team, err := store.CreateTeam("", "WG", "")
	if err != nil {
		t.Fatal(err)
	}
	_ = store.AddTeamMember(team.ID, owner.ID, "admin")
	_ = store.AddTeamMember(team.ID, member.ID, "member")

	ownerStream := openSSE(t, ts, ownerToken)
	memberStream := openSSE(t, ts, memberToken)
	outsiderStream := openSSE(t, ts, outsiderToken)

	resp := doJSON(t, ts, http.MethodPost, "/api/v1/task-lists", ownerToken, map[string]string{"title": "Putzplan", "teamId": team.ID})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create task list: status %d", resp.StatusCode)
	}
	var tl domain.TaskList
	if err := json.NewDecoder(resp.Body).Decode(&tl); err != nil {
		t.Fatal(err)
	}
	for name, st := range map[string]*sseStream{"team member": memberStream, "creator's other devices": ownerStream} {
		msg := st.waitFor(t, eventTaskListCreated, 10*time.Second)
		if msg == nil {
			t.Fatalf("%s: no TASK_LIST_CREATED", name)
		}
		var p struct{ ID string }
		if json.Unmarshal(msg.Payload, &p); p.ID != tl.ID {
			t.Errorf("%s: TASK_LIST_CREATED carries %s, want {id: %s}", name, msg.Payload, tl.ID)
		}
	}
	if outsiderStream.waitFor(t, eventTaskListCreated, 500*time.Millisecond) != nil {
		t.Error("someone outside the team got TASK_LIST_CREATED")
	}
}

// Deleting a shared list or taking someone off it reaches everyone who saw it, also without the list
// open (its room): their list overview drops it.
func TestListDeleteAndUnshareReachTheOverview(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	member, memberToken := newTestUser(t, store, "mitglied@example.com")
	_, outsiderToken := newTestUser(t, store, "fremd@example.com")
	list, err := store.CreateList(owner.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	share, err := store.AddListShare(owner.ID, list.ID, "user", member.ID, "editor")
	if err != nil {
		t.Fatal(err)
	}
	// Neither stream joins the list's room
	memberStream := openSSE(t, ts, memberToken)
	outsiderStream := openSSE(t, ts, outsiderToken)

	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/lists/"+list.ID+"/shares/"+share.ID, ownerToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("unshare: status %d", r.StatusCode)
	}
	if memberStream.waitFor(t, eventListUnshared, 10*time.Second) == nil {
		t.Fatal("the person taken off the list got no LIST_UNSHARED")
	}

	if _, err := store.AddListShare(owner.ID, list.ID, "user", member.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/lists/"+list.ID, ownerToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("delete: status %d", r.StatusCode)
	}
	msg := memberStream.waitFor(t, eventListDeleted, 10*time.Second)
	if msg == nil {
		t.Fatal("a member without the list open got no LIST_DELETED")
	}
	var p struct {
		ListID string `json:"listId"`
	}
	if json.Unmarshal(msg.Payload, &p); p.ListID != list.ID {
		t.Errorf("LIST_DELETED payload %s, want listId %s", msg.Payload, list.ID)
	}
	if outsiderStream.waitFor(t, eventListDeleted, 500*time.Millisecond) != nil {
		t.Error("someone who never saw the list got LIST_DELETED")
	}
}
