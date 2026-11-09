package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

type centerView struct {
	Items  []storage.CenterEntry `json:"items"`
	Unread int                   `json:"unread"`
}

func getCenter(t *testing.T, srv *Server, token string) centerView {
	t.Helper()
	rec := sessionCall(srv.Router(), "GET", "/api/v1/notifications", token, "", "")
	var v centerView
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &v) != nil {
		t.Fatalf("center: %d %s", rec.Code, rec.Body.String())
	}
	return v
}

// The center gets everything, whatever the channels or a pause; watched tasks keep one entry each
func TestNotificationCenter(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	bob, bobToken := newTestUser(t, store, "bob@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	if _, err := store.AddTaskListShare(list.ID, "user", bob.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	// Bob paused everything and has no channel for assignments
	set := store.NotificationSettingsOf(bob.ID)
	set.Paused = true
	set.Events.Assigned = domain.ChannelChoice{}
	_ = store.SetNotificationSettings(bob.ID, set)

	task, _ := store.CreateThoughtWithDetails(owner.ID, "Keller aufräumen", "normal", "manual", "", list.ID, "todo", "")
	task, _ = store.UpdateThoughtTriage(owner.ID, task.ID, "keep", "task", "", "", list.ID)
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"assignees":["`+bob.ID+`"]}`, "")
	v := getCenter(t, srv, bobToken)
	if v.Unread != 1 || len(v.Items) != 1 || v.Items[0].Kind != "assigned" || v.Items[0].TargetType != "task" || v.Items[0].TargetID != task.ID {
		t.Fatalf("assignment should be in the center: %+v", v)
	}
	if len(getCenter(t, srv, ownerToken).Items) != 0 {
		t.Fatal("own actions stay out of one's own center")
	}
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if len(*sent) != 0 {
		t.Fatalf("paused: nothing sent by mail: %+v", *sent)
	}

	// Watched: two changes leave one entry; different changes merge into the short text
	_ = store.WatchTask(task.ID, bob.ID, true)
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"priority":"high"}`, "")
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"notes":"Erst die Regale"}`, "")
	v = getCenter(t, srv, bobToken)
	watched := 0
	for _, e := range v.Items {
		if e.Kind == "watched" {
			watched++
			if !strings.HasSuffix(e.Text, "hat „Keller aufräumen“ geändert") {
				t.Errorf("merged entry should say the task changed: %q", e.Text)
			}
		}
	}
	if watched != 1 {
		t.Fatalf("one entry per watched task, got %d: %+v", watched, v.Items)
	}

	// Due: once per due date, even with a pause
	due := "2026-01-02"
	_, _ = store.UpdateThoughtDetails(owner.ID, task.ID, nil, nil, &due, nil, nil, nil, nil, nil, nil)
	srv.checkAlarms(time.Date(2026, 1, 2, 12, 0, 0, 0, time.Local))
	srv.checkAlarms(time.Date(2026, 1, 2, 12, 1, 0, 0, time.Local))
	dues := 0
	for _, e := range getCenter(t, srv, bobToken).Items {
		if e.Kind == "due" {
			dues++
		}
	}
	if dues != 1 {
		t.Fatalf("one due entry for bob (assignee), got %d", dues)
	}

	// Read and clear
	if rec := sessionCall(router, "POST", "/api/v1/notifications/read", bobToken, "", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("read all: %d", rec.Code)
	}
	if v := getCenter(t, srv, bobToken); v.Unread != 0 || len(v.Items) == 0 {
		t.Fatalf("all read, entries kept: %+v", v)
	}
	if rec := sessionCall(router, "DELETE", "/api/v1/notifications", bobToken, "", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("clear: %d", rec.Code)
	}
	if v := getCenter(t, srv, bobToken); len(v.Items) != 0 {
		t.Fatalf("cleared: %+v", v)
	}
	// Old entries go by themselves
	_, _, _, _ = store.AddCenterEntry(bob.ID, storage.CenterEntry{Kind: "shared", Title: "x", Text: "x"}, "", storage.CenterReplace)
	store.PruneCenter(time.Now().Add(storage.CenterRetention + time.Hour))
	if v := getCenter(t, srv, bobToken); len(v.Items) != 0 {
		t.Fatalf("pruned after the retention: %+v", v)
	}
}

// A muted list stays out of the center too, an assignment there does not
func TestCenterRespectsMutedLists(t *testing.T) {
	srv, _ := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	bob, bobToken := newTestUser(t, store, "bob@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	if _, err := store.AddTaskListShare(list.ID, "user", bob.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	_ = store.SetTaskListMuted(bob.ID, list.ID, true)
	rec := sessionCall(router, "POST", "/api/v1/inbox", ownerToken, `{"content":"Fenster putzen","target":"task","taskListId":"`+list.ID+`"}`, "")
	var created domain.Thought
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if v := getCenter(t, srv, bobToken); len(v.Items) != 0 {
		t.Fatalf("muted list: no entry, got %+v", v.Items)
	}
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+created.ID, ownerToken, `{"assignees":["`+bob.ID+`"]}`, "")
	if v := getCenter(t, srv, bobToken); len(v.Items) != 1 || v.Items[0].Kind != "assigned" {
		t.Fatalf("assignment comes through: %+v", v.Items)
	}
}
