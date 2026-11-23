package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// Adding someone to a group shows them what is shared with the group at once (task lists, lists, notes,
// shared folders) and tells them in the notification center; removing them takes it away again,
// without a notification, and out of the list's room.
func TestTeamMembershipChangesAreLive(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	member, memberToken := newTestUser(t, store, "neu@example.com")
	team, err := store.CreateTeam("", "Familie", "")
	if err != nil {
		t.Fatal(err)
	}
	_ = store.AddTeamMember(team.ID, owner.ID, "admin")

	tl, err := store.CreateTaskList(owner.ID, "", "", "Putzplan", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddTaskListShare(tl.ID, "team", team.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	list, err := store.CreateList(owner.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "team", team.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	doc, err := store.CreateDocument(owner.ID, "", "Urlaub", "", "", nil, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocTeamShare(owner.ID, doc.ID, team.ID, "read"); err != nil {
		t.Fatal(err)
	}
	folder, err := store.CreateSharedFolder(owner.ID, "Familie", "Familie")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateFolderShare(owner.ID, folder.ID, "team", team.ID, "read"); err != nil {
		t.Fatal(err)
	}

	stream := openSSE(t, ts, memberToken)
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/teams/"+team.ID+"/members", ownerToken, map[string]string{"userId": member.ID}); r.StatusCode != http.StatusOK {
		t.Fatalf("add member: status %d", r.StatusCode)
	}
	expect := func(event string) *sseMsg {
		t.Helper()
		msg := stream.waitFor(t, event, 10*time.Second)
		if msg == nil {
			t.Fatalf("the member got no %s", event)
		}
		return msg
	}
	// In the order the server sends them
	expect(eventTaskListUpdated)
	expect(eventListShared)
	if created := expect(eventDocCreated); !json.Valid(created.Payload) {
		t.Fatalf("DOC_CREATED payload %s", created.Payload)
	}
	expect(eventFoldersUpdated)
	note := expect(eventNotification)
	var entry struct {
		Kind, Text, TargetType, TargetID string
	}
	_ = json.Unmarshal(note.Payload, &entry)
	if entry.Kind != "shared" || entry.TargetType != "team" || entry.TargetID != team.ID || entry.Text == "" {
		t.Errorf("notification %s", note.Payload)
	}

	// Adding again only changes the role: nothing new
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/teams/"+team.ID+"/members", ownerToken, map[string]string{"userId": member.ID, "role": "member"}); r.StatusCode != http.StatusOK {
		t.Fatalf("add member again: status %d", r.StatusCode)
	}
	if stream.waitFor(t, eventNotification, 500*time.Millisecond) != nil {
		t.Error("adding a member again notified them again")
	}

	conn := dialWS(t, ts, memberToken)
	joinWSRoom(t, conn, list.ID)
	stream2 := openSSE(t, ts, memberToken)
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/teams/"+team.ID+"/members/"+member.ID, ownerToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("remove member: status %d", r.StatusCode)
	}
	for _, event := range []string{eventTaskListUpdated, eventListUnshared, eventDocDeleted, eventFoldersUpdated} {
		if stream2.waitFor(t, event, 10*time.Second) == nil {
			t.Fatalf("the removed member got no %s", event)
		}
	}
	if stream2.waitFor(t, eventNotification, 500*time.Millisecond) != nil {
		t.Error("removing a member notified them")
	}
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/lists/"+list.ID+"/items", ownerToken, map[string]string{"content": "Geschenk"}); r.StatusCode != http.StatusCreated && r.StatusCode != http.StatusOK {
		t.Fatalf("add item: status %d", r.StatusCode)
	}
	if m := readWSEvent(conn, eventItemCreated, time.Second); m != nil {
		t.Fatalf("ITEM_CREATED still reached the removed member: %s", m.Payload)
	}
}

// Deleting a group takes what was shared with it away from its members, live.
func TestDeletingATeamIsLive(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	member, memberToken := newTestUser(t, store, "mitglied@example.com")
	team, err := store.CreateTeam("", "WG", "")
	if err != nil {
		t.Fatal(err)
	}
	_ = store.AddTeamMember(team.ID, owner.ID, "admin")
	_ = store.AddTeamMember(team.ID, member.ID, "member")
	list, err := store.CreateList(owner.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "team", team.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	stream := openSSE(t, ts, memberToken)
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/teams/"+team.ID, ownerToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("delete team: status %d", r.StatusCode)
	}
	if stream.waitFor(t, eventListUnshared, 10*time.Second) == nil {
		t.Fatal("a member of the deleted group got no LIST_UNSHARED")
	}
}
