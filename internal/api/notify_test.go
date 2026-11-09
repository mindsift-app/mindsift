package api

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

type sentNote struct{ channel, to, subject, text, html string }

func notifyServer(t *testing.T) (*Server, *[]sentNote) {
	t.Helper()
	srv, _, _ := setupTestServer(t)
	srv.cfg.NotifyDigestMinutes = 5
	var sent []sentNote
	srv.notifyEmailHook = func(to, subject, text, html string) error {
		sent = append(sent, sentNote{channel: "email", to: to, subject: subject, text: text, html: html})
		return nil
	}
	srv.notifyDiscordHook = func(url, heading string, items []notifyItem) error {
		lines := make([]string, 0, len(items))
		for _, it := range items {
			lines = append(lines, it.text)
		}
		sent = append(sent, sentNote{channel: "discord", to: url, text: strings.Join(lines, "\n")})
		return nil
	}
	srv.notifyWebhookHook = func(url, heading string, items []notifyItem) error {
		lines := make([]string, 0, len(items))
		for _, it := range items {
			lines = append(lines, it.text)
		}
		sent = append(sent, sentNote{channel: "webhook", to: url, text: strings.Join(lines, "\n")})
		return nil
	}
	return srv, &sent
}

func TestWatchedTaskChangesAreBundled(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	watcher, watcherToken := newTestUser(t, store, "watcher@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	task, _ := store.CreateThoughtWithDetails(owner.ID, "Fenster putzen", "normal", "manual", "", list.ID, "todo", "")
	if _, err := store.AddTaskListShare(list.ID, "user", watcher.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	if rec := sessionCall(router, "POST", "/api/v1/tasks/"+task.ID+"/watch", watcherToken, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	_, strangerToken := newTestUser(t, store, "fremd@example.com")
	if rec := sessionCall(router, "POST", "/api/v1/tasks/"+task.ID+"/watch", strangerToken, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger watch: want 404, got %d", rec.Code)
	}

	// Two changes by the owner within the window → one bundled mail for the watcher, none for the owner
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"content":"Fenster putzen (innen)"}`, "")
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"isCompleted":true}`, "")
	srv.flushNotifications(time.Now())
	if len(*sent) != 0 {
		t.Fatalf("nothing may go out before the window ends: %+v", *sent)
	}
	srv.flushNotifications(time.Now().Add(6 * time.Minute))
	var mails []sentNote
	for _, n := range *sent {
		if n.channel == "email" {
			mails = append(mails, n)
		}
	}
	if len(mails) != 1 || mails[0].to != "watcher@example.com" || !strings.Contains(mails[0].text, "den Text von") ||
		!strings.Contains(mails[0].text, "erledigt") || !strings.Contains(mails[0].html, "<html") {
		t.Fatalf("expected one bundled HTML mail to the watcher, got %+v", *sent)
	}
	*sent = nil
	srv.flushNotifications(time.Now().Add(20 * time.Minute))
	if len(*sent) != 0 {
		t.Fatal("queue must be empty after sending")
	}
}

func TestOwnChangesPauseAndChannels(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	router := srv.Router()
	me, myToken := newTestUser(t, store, "me@example.com")
	task, _ := store.CreateThoughtWithDetails(me.ID, "Steuer", "normal", "manual", "", "", "todo", "")
	_ = store.WatchTask(task.ID, me.ID, true)

	// Own change on a watched task: nothing …
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, myToken, `{"priority":"high"}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if len(*sent) != 0 {
		t.Fatalf("own change must not notify: %+v", *sent)
	}
	// … unless asked for, then only over the chosen channel
	set := store.NotificationSettingsOf(me.ID)
	set.IncludeOwnWatched = true
	set.Events.Watched = domain.ChannelChoice{Discord: true}
	_ = store.SetNotificationSettings(me.ID, set)
	hook := "https://discord.com/api/webhooks/1/x"
	_, _ = store.UpdateUserFull(me.ID, nil, nil, nil, nil, nil, nil, &hook, nil, nil, nil)
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, myToken, `{"priority":"low"}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if len(*sent) != 1 || (*sent)[0].channel != "discord" {
		t.Fatalf("expected one Discord message, got %+v", *sent)
	}

	// Own webhook as a channel of its own
	*sent = nil
	set.Events.Watched = domain.ChannelChoice{Webhook: true}
	_ = store.SetNotificationSettings(me.ID, set)
	own := "https://hooks.example.com/mindsift"
	_, _ = store.UpdateUserFull(me.ID, nil, nil, nil, nil, nil, nil, nil, &own, nil, nil)
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, myToken, `{"priority":"normal"}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if len(*sent) != 1 || (*sent)[0].channel != "webhook" || (*sent)[0].to != own {
		t.Fatalf("expected one webhook message, got %+v", *sent)
	}

	// Paused: nothing at all
	*sent = nil
	set.Paused = true
	_ = store.SetNotificationSettings(me.ID, set)
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, myToken, `{"priority":"urgent"}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if len(*sent) != 0 {
		t.Fatalf("paused must send nothing: %+v", *sent)
	}

	// Settings round trip over the profile API
	rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", myToken, `{"notificationSettings":{"paused":false,"events":{"shared":{"email":false,"discord":true}},"dailySummary":{"enabled":true,"time":"6:5"}}}`, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"time":"07:00"`) || !strings.Contains(rec.Body.String(), `"shared":{"email":false,"discord":true,"webhook":false,"push":false}`) {
		t.Fatalf("settings: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDailySummary(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	me, _ := newTestUser(t, store, "summary@example.com")
	now := time.Date(2026, 10, 30, 7, 0, 30, 0, time.Local)
	set := store.NotificationSettingsOf(me.ID)
	set.DailySummary = domain.DailySummary{Enabled: true, Time: "07:00", Email: true}
	_ = store.SetNotificationSettings(me.ID, set)

	srv.sendDailySummaries(now)
	if len(*sent) != 0 {
		t.Fatal("nothing due → no summary")
	}
	for _, td := range [][2]string{{"Altlast", "2026-10-28"}, {"Zahnarzt", "2026-10-30T15:30"}, {"Müll raus", "2026-10-31"}, {"Später", "2026-11-04"}} {
		th, _ := store.CreateThoughtWithDetails(me.ID, td[0], "normal", "manual", td[1], "", "todo", "")
		if _, err := store.UpdateThoughtTriage(me.ID, th.ID, "keep", "task", "", td[1], ""); err != nil { // triaged into a task
			t.Fatal(err)
		}
	}

	srv.sendDailySummaries(now.Add(-2 * time.Minute)) // before the chosen time
	if len(*sent) != 0 {
		t.Fatal("no summary before the chosen time")
	}
	srv.sendDailySummaries(now)
	if len(*sent) != 1 {
		t.Fatalf("expected one summary, got %d", len(*sent))
	}
	// Grouped into sections, the same in text and HTML; the logo travels inside the mail
	text, htmlBody := (*sent)[0].text, (*sent)[0].html
	for _, want := range []string{"Guten Morgen", "ÜBERFÄLLIG\n• Altlast (seit ", "HEUTE\n• Zahnarzt (15:30 Uhr)", "MORGEN\n• Müll raus", "eine weitere Aufgabe"} {
		if !strings.Contains(text, want) {
			t.Fatalf("summary lacks %q:\n%s", want, text)
		}
	}
	for _, want := range []string{"cid:" + mailLogoCID, ">Überfällig<", ">Zahnarzt<", "15:30 Uhr"} {
		if !strings.Contains(htmlBody, want) {
			t.Fatalf("summary HTML lacks %q", want)
		}
	}
	srv.sendDailySummaries(now.Add(5 * time.Minute))
	if len(*sent) != 1 {
		t.Fatal("only one summary per day")
	}
}

func TestDailySummaryIncludesGroupSharedLists(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	owner, _ := newTestUser(t, store, "chef@example.com")
	me, _ := newTestUser(t, store, "team@example.com")
	team, err := store.CreateTeam("", "Arbeit", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, uid := range []string{owner.ID, me.ID} { // the owner must see the group to share with it
		if err := store.AddTeamMember(team.ID, uid, "member"); err != nil {
			t.Fatal(err)
		}
	}
	list, _ := store.CreateTaskList(owner.ID, "", "", "Projekt", "📋", "#000000")
	if _, err := store.AddTaskListShare(list.ID, "team", team.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	th, _ := store.CreateThoughtWithDetails(owner.ID, "Bericht abgeben", "normal", "manual", "2026-10-30T10:00", list.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(owner.ID, th.ID, "keep", "task", "", "2026-10-30T10:00", list.ID)

	set := store.NotificationSettingsOf(me.ID)
	set.DailySummary = domain.DailySummary{Enabled: true, Time: "07:00", Email: true}
	_ = store.SetNotificationSettings(me.ID, set)
	srv.sendDailySummaries(time.Date(2026, 10, 30, 7, 1, 0, 0, time.Local))
	if len(*sent) != 1 || !strings.Contains((*sent)[0].text, "Bericht abgeben (10:00 Uhr · Projekt)") {
		t.Fatalf("group-shared task missing: %+v", *sent)
	}
}

// mailsTo returns the texts of the mails sent to an address.
func mailsTo(sent []sentNote, to string) []string {
	var out []string
	for _, n := range sent {
		if n.channel == "email" && n.to == to {
			out = append(out, n.text)
		}
	}
	return out
}

func TestAssignedNotification(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	bob, bobToken := newTestUser(t, store, "bob@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	task, _ := store.CreateThoughtWithDetails(owner.ID, "Keller aufräumen", "normal", "manual", "", list.ID, "todo", "")
	if _, err := store.AddTaskListShare(list.ID, "user", bob.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}

	// Assigning someone else tells them (by default per mail); the one who assigned hears nothing
	if rec := sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"assignees":["`+bob.ID+`","`+owner.ID+`"]}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("assign: %d %s", rec.Code, rec.Body.String())
	}
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if got := mailsTo(*sent, "bob@example.com"); len(got) != 1 || !strings.Contains(got[0], "hat dir „Keller aufräumen“ zugewiesen") {
		t.Fatalf("bob should get one assignment mail, got %+v", *sent)
	}
	if got := mailsTo(*sent, "owner@example.com"); len(got) != 0 {
		t.Fatalf("assigning oneself must not notify: %+v", got)
	}

	// Taking a task oneself: nothing; still assigned: no second mail
	*sent = nil
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"assignees":["`+bob.ID+`"]}`, "")
	task2, _ := store.CreateThoughtWithDetails(owner.ID, "Rasen mähen", "normal", "manual", "", list.ID, "todo", "")
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task2.ID, bobToken, `{"assignees":["`+bob.ID+`"]}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if len(*sent) != 0 {
		t.Fatalf("no new assignment, nothing to send: %+v", *sent)
	}

	// Switched off in the settings: nothing
	set := store.NotificationSettingsOf(bob.ID)
	set.Events.Assigned = domain.ChannelChoice{}
	_ = store.SetNotificationSettings(bob.ID, set)
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"assignees":[]}`, "")
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"assignees":["`+bob.ID+`"]}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if len(*sent) != 0 {
		t.Fatalf("switched off, nothing to send: %+v", *sent)
	}
}

func TestTaskAddedToSharedList(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	bob, _ := newTestUser(t, store, "bob@example.com")
	carol, _ := newTestUser(t, store, "carol@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	for _, u := range []string{bob.ID, carol.ID} {
		if _, err := store.AddTaskListShare(list.ID, "user", u, "editor", owner.ID); err != nil {
			t.Fatal(err)
		}
	}
	// Bob asked for it, Carol keeps the default (off)
	set := store.NotificationSettingsOf(bob.ID)
	set.Events.TaskCreated = domain.ChannelChoice{Email: true}
	_ = store.SetNotificationSettings(bob.ID, set)

	if rec := sessionCall(router, "POST", "/api/v1/inbox", ownerToken, `{"content":"Fenster putzen","target":"task","taskListId":"`+list.ID+`"}`, ""); rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	// Moved from the personal tasks into the list: new there as well
	own, _ := store.CreateThoughtWithDetails(owner.ID, "Müll rausbringen", "normal", "manual", "", "", "todo", "")
	own, _ = store.UpdateThoughtTriage(owner.ID, own.ID, "keep", "task", "", "", "")
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+own.ID, ownerToken, `{"taskListId":"`+list.ID+`"}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	got := mailsTo(*sent, "bob@example.com")
	if len(got) != 1 || !strings.Contains(got[0], "hat „Fenster putzen“ zur Liste „Haushalt“ hinzugefügt") ||
		!strings.Contains(got[0], "hat „Müll rausbringen“ zur Liste „Haushalt“ hinzugefügt") {
		t.Fatalf("bob should get one mail with both tasks, got %+v", *sent)
	}
	if len(mailsTo(*sent, "carol@example.com")) != 0 || len(mailsTo(*sent, "owner@example.com")) != 0 {
		t.Fatalf("carol (off) and the owner (own change) get nothing: %+v", *sent)
	}
}

func TestWatchedTaskNamesEveryChange(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	watcher, _ := newTestUser(t, store, "watcher@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	task, _ := store.CreateThoughtWithDetails(owner.ID, "Keller aufräumen", "normal", "manual", "", list.ID, "todo", "")
	task, _ = store.UpdateThoughtTriage(owner.ID, task.ID, "keep", "task", "", "", list.ID)
	if _, err := store.AddTaskListShare(list.ID, "user", watcher.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	_ = store.WatchTask(task.ID, watcher.ID, true)

	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"priority":"high","kanbanStatus":"in_progress","notes":"Erst die Regale"}`, "")
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"kanbanStatus":"waiting"}`, "")
	// Completing moves it to the done column too: told as completed only
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"isCompleted":true}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	got := mailsTo(*sent, "watcher@example.com")
	if len(got) != 1 {
		t.Fatalf("one bundled mail expected, got %+v", *sent)
	}
	for _, want := range []string{
		"hat „Keller aufräumen“ geändert: Priorität: Wichtig, Status: In Bearbeitung, Beschreibung",
		"hat „Keller aufräumen“ nach „Wartet auf andere“ verschoben",
		"hat „Keller aufräumen“ erledigt",
	} {
		if !strings.Contains(got[0], want) {
			t.Errorf("mail should contain %q:\n%s", want, got[0])
		}
	}
	if strings.Contains(got[0], "Erledigt") {
		t.Errorf("completing must not also report the move to the done column:\n%s", got[0])
	}
}

func TestTaskTickedInNoteNotifiesWatchers(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	owner, _ := newTestUser(t, store, "owner@example.com")
	watcher, _ := newTestUser(t, store, "watcher@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	if _, err := store.AddTaskListShare(list.ID, "user", watcher.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	th, _ := store.CreateThoughtWithDetails(owner.ID, "Keller aufräumen", "normal", "manual", "", list.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(owner.ID, th.ID, "keep", "task", "", "", list.ID)
	// The task gets a note of its own, its checkbox is linked to it
	task, err := store.UpdateThoughtTriage(owner.ID, th.ID, "keep", "document", "", "", "")
	if err != nil || task.DocID == "" || task.BlockID == "" {
		t.Fatalf("deepen: %v %+v", err, task)
	}
	_ = store.WatchTask(task.ID, watcher.ID, true)

	yes := true
	if err := srv.applyNoteOps(owner.ID, nil, task.DocID, []collab.Op{{OpID: "tick", Kind: collab.OpSetProps, BlockID: task.BlockID, Patch: &collab.PropsPatch{Checked: &yes}}}); err != nil {
		t.Fatal(err)
	}
	// Typing in the title several times: told once, with the latest title
	for i, title := range []string{"Keller aufräumen und", "Keller aufräumen und fegen"} {
		snap, _ := store.GetDocSnapshot(task.DocID)
		version := 0
		for _, b := range snap.Blocks {
			if b.ID == task.BlockID {
				version = b.Version
			}
		}
		text := title
		if err := srv.applyNoteOps(owner.ID, nil, task.DocID, []collab.Op{{OpID: "t" + strconv.Itoa(i), Kind: collab.OpSetContent, BlockID: task.BlockID, BaseVersion: version, Content: &text}}); err != nil {
			t.Fatal(err)
		}
	}
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	got := mailsTo(*sent, "watcher@example.com")
	if len(got) != 1 || !strings.Contains(got[0], "hat „Keller aufräumen“ erledigt") ||
		strings.Count(got[0], "hat den Text von") != 1 || !strings.Contains(got[0], "„Keller aufräumen und fegen“") {
		t.Fatalf("watcher should hear about the tick and one text change, got %+v", *sent)
	}
}
