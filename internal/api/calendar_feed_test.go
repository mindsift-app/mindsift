package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/ical"
	"github.com/mindsift-app/mindsift/internal/storage"
)

type calendarFeedState struct {
	Enabled bool    `json:"enabled"`
	Active  bool    `json:"active"`
	Token   *string `json:"token"`
}

func calendarTask(t *testing.T, store *storage.Store, userID, content, due, listID, notes string) *domain.Thought {
	t.Helper()
	th, err := store.CreateThoughtWithDetails(userID, content, "normal", "manual", due, listID, "todo", notes)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	th, err = store.UpdateThoughtTriage(userID, th.ID, "keep", "task", "", due, listID)
	if err != nil {
		t.Fatalf("file task: %v", err)
	}
	return th
}

func fetchFeed(t *testing.T, url, etag string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, string(body)
}

func switchFeedOn(t *testing.T, do func(method string) *http.Response) string {
	t.Helper()
	resp := do(http.MethodPut)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("switch on: status %d", resp.StatusCode)
	}
	var st calendarFeedState
	_ = json.NewDecoder(resp.Body).Decode(&st)
	if !st.Active || st.Token == nil || len(*st.Token) < 40 {
		t.Fatalf("no usable token: %+v", st)
	}
	return *st.Token
}

// eventsBySummary parses the feed strictly and returns its events by their title.
func eventsBySummary(t *testing.T, body string) (*ical.Component, map[string]*ical.Component) {
	t.Helper()
	cal, err := ical.Parse(body)
	if err != nil {
		t.Fatalf("the feed is not valid iCalendar: %v\n%s", err, body)
	}
	out := map[string]*ical.Component{}
	for _, ev := range cal.All("VEVENT") {
		out[ev.Text("SUMMARY")] = ev
	}
	return cal, out
}

func TestCalendarFeed(t *testing.T) {
	// A zone far from UTC: all-day events must keep their day, timed ones go out in UTC
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	clock.UseInTest(t, tokyo)
	srv, store, ts, owner, ownerToken := startRealtimeServer(t)
	bob, _ := newTestUser(t, store, "bob@example.com")
	do := func(method string) *http.Response { return doJSON(t, ts, method, "/api/v1/calendar-feed", ownerToken, nil) }

	// Off until switched on
	var st calendarFeedState
	_ = json.NewDecoder(do(http.MethodGet).Body).Decode(&st)
	if !st.Enabled || st.Active || st.Token != nil {
		t.Fatalf("a new account has no feed: %+v", st)
	}
	token := switchFeedOn(t, do)
	url := ts.URL + "/calendar/" + token + ".ics"

	today := clock.In(time.Now())
	day := func(n int) string { return today.AddDate(0, 0, n).Format("2006-01-02") }

	office, _ := store.CreateTaskList(owner.ID, "", "", "Büro", "", "")
	longNotes := "Belege: Rechnung, Quittung; Kontoauszug\nZweite Zeile mit Umlauten äöü " + strings.Repeat("Größe ", 150)
	calendarTask(t, store, owner.ID, "Steuer, Rente; Abgabe \\ #finanzen", day(2), office.ID, longNotes)
	timed := calendarTask(t, store, owner.ID, "Zahnarzt", day(3)+"T09:30", "", "")
	if _, err := store.SetTaskReminders(owner.ID, timed.ID, []int{60, 24 * 60}); err != nil {
		t.Fatal(err)
	}
	calendarTask(t, store, owner.ID, "Ohne Datum", "", "", "")
	calendarTask(t, store, owner.ID, "Zu weit weg", day(800), "", "")
	calendarTask(t, store, owner.ID, "Lange überfällig", day(-60), "", "")
	done := calendarTask(t, store, owner.ID, "Schon erledigt", day(1), "", "")
	if resp := doJSON(t, ts, http.MethodPatch, "/api/v1/thoughts/"+done.ID, ownerToken, map[string]any{"isCompleted": true}); resp.StatusCode != http.StatusOK {
		t.Fatalf("complete: %d", resp.StatusCode)
	}
	gone := calendarTask(t, store, owner.ID, "Gelöscht", day(1), "", "")
	if resp := doJSON(t, ts, http.MethodDelete, "/api/v1/thoughts/"+gone.ID, ownerToken, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	// Repeating: completing it leaves only the next occurrence
	weekly := calendarTask(t, store, owner.ID, "Müll rausbringen", day(0), "", "")
	if resp := doJSON(t, ts, http.MethodPatch, "/api/v1/thoughts/"+weekly.ID, ownerToken, map[string]any{"recurrence": "weekly"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("recurrence: %d", resp.StatusCode)
	}
	if resp := doJSON(t, ts, http.MethodPatch, "/api/v1/thoughts/"+weekly.ID, ownerToken, map[string]any{"isCompleted": true}); resp.StatusCode != http.StatusOK {
		t.Fatalf("complete weekly: %d", resp.StatusCode)
	}
	// Bob's list shared with the owner, and one he keeps to himself
	shared, _ := store.CreateTaskList(bob.ID, "", "", "Verein", "", "")
	if _, err := store.AddTaskListShare(shared.ID, "user", owner.ID, "viewer", bob.ID); err != nil {
		t.Fatal(err)
	}
	calendarTask(t, store, bob.ID, "Vereinssitzung", day(5), shared.ID, "")
	private, _ := store.CreateTaskList(bob.ID, "", "", "Privat", "", "")
	calendarTask(t, store, bob.ID, "Bobs Geheimnis", day(5), private.ID, "")

	resp, body := fetchFeed(t, url, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("feed: status %d: %s", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/calendar") {
		t.Errorf("Content-Type %q", ct)
	}
	if !strings.Contains(resp.Header.Get("Cache-Control"), "max-age") || resp.Header.Get("ETag") == "" {
		t.Errorf("caching headers missing: %v", resp.Header)
	}
	cal, events := eventsBySummary(t, body)
	if got := cal.Text("X-WR-CALNAME"); got != "MindSift – Aufgaben" {
		t.Errorf("calendar name %q", got)
	}
	if p, _ := cal.Get("REFRESH-INTERVAL"); p.Value != "PT1H" {
		t.Errorf("REFRESH-INTERVAL %q", p.Value)
	}
	for _, absent := range []string{"Ohne Datum", "Zu weit weg", "Lange überfällig", "Schon erledigt", "Gelöscht", "Bobs Geheimnis"} {
		if events[absent] != nil {
			t.Errorf("%q must not be in the feed", absent)
		}
	}
	// The account starts with the sample tasks; every event must be one of its open tasks
	for _, ev := range cal.All("VEVENT") {
		id := strings.TrimSuffix(ev.Text("UID"), "@mindsift")
		if th, err := store.GetThoughtByID(owner.ID, id); err != nil || th.IsCompleted || th.DueDate == "" {
			t.Errorf("event %q is not an open task of the person with a due date", ev.Text("SUMMARY"))
		}
	}

	// All day: DATE values, the day after as the end, never shifted by the zone
	tax := events["Steuer, Rente; Abgabe \\ #finanzen"]
	if tax == nil {
		t.Fatalf("all-day task missing:\n%s", body)
	}
	start, _ := tax.Get("DTSTART")
	end, _ := tax.Get("DTEND")
	if start.Params["VALUE"] != "DATE" || start.Value != strings.ReplaceAll(day(2), "-", "") || end.Value != strings.ReplaceAll(day(3), "-", "") {
		t.Errorf("all-day dates: %+v / %+v", start, end)
	}
	if !strings.Contains(body, `SUMMARY:Steuer\, Rente\; Abgabe \\ #finanzen`) {
		t.Errorf("SUMMARY not escaped:\n%s", body)
	}
	desc := tax.Text("DESCRIPTION")
	if !strings.HasPrefix(desc, "Liste: Büro\n\nBelege: Rechnung, Quittung; Kontoauszug\nZweite Zeile") || !strings.HasSuffix(desc, "…") {
		t.Errorf("description: %q", desc)
	}
	if uid := tax.Text("UID"); !strings.HasSuffix(uid, "@mindsift") {
		t.Errorf("UID %q", uid)
	}

	// Timed: UTC, 30 minutes, alarms at the moments MindSift itself alarms
	dentist := events["Zahnarzt"]
	dueAt, _ := time.ParseInLocation("2006-01-02T15:04", day(3)+"T09:30", tokyo)
	if p, _ := dentist.Get("DTSTART"); p.Value != ical.UTC(dueAt) {
		t.Errorf("DTSTART %q, want %q", p.Value, ical.UTC(dueAt))
	}
	if p, _ := dentist.Get("DTEND"); p.Value != ical.UTC(dueAt.Add(30*time.Minute)) {
		t.Errorf("DTEND %q", p.Value)
	}
	alarms := dentist.All("VALARM")
	if len(alarms) != 2 {
		t.Fatalf("want 2 alarms, got %d", len(alarms))
	}
	wantTriggers := map[string]bool{ical.UTC(dueAt.Add(-time.Hour)): true, ical.UTC(dueAt.AddDate(0, 0, -1)): true}
	for _, a := range alarms {
		if p, _ := a.Get("TRIGGER"); !wantTriggers[p.Value] || p.Params["VALUE"] != "DATE-TIME" {
			t.Errorf("alarm trigger %+v", p)
		}
	}

	if ev := events["Müll rausbringen"]; ev == nil {
		t.Error("the next occurrence of the repeating task is missing")
	} else if p, _ := ev.Get("DTSTART"); p.Value != strings.ReplaceAll(day(7), "-", "") || strings.HasPrefix(ev.Text("UID"), weekly.ID) {
		t.Errorf("repeating task: want the next occurrence a week later, got %s (%s)", p.Value, ev.Text("UID"))
	}
	if events["Vereinssitzung"] == nil {
		t.Error("tasks of a list shared with the person belong in the feed")
	}

	// Unchanged: 304 with the ETag
	if resp, _ := fetchFeed(t, url, resp.Header.Get("ETag")); resp.StatusCode != http.StatusNotModified {
		t.Errorf("If-None-Match: status %d, want 304", resp.StatusCode)
	}

	// Sharing revoked: Bob's task leaves the feed
	if err := store.RemoveTaskListShare(shared.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	_, body = fetchFeed(t, url, "")
	if _, events := eventsBySummary(t, body); events["Vereinssitzung"] != nil {
		t.Error("after revoking the share the task must leave the feed")
	}

	// Wrong tokens: plain 404, nothing about the feed
	for _, bad := range []string{"/calendar/" + token, "/calendar/" + token + "x.ics", "/calendar/.ics", "/calendar/nope.ics"} {
		if resp, body := fetchFeed(t, ts.URL+bad, ""); resp.StatusCode != http.StatusNotFound || strings.Contains(body, "VCALENDAR") {
			t.Errorf("%s: status %d", bad, resp.StatusCode)
		}
	}

	// API keys cannot read or create the address
	key, _ := store.CreateAPIKey(owner.ID, "Skript", []string{storage.ScopeTasksRead})
	if resp := doJSON(t, ts, http.MethodGet, "/api/v1/calendar-feed", key.RawKey, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("API key reached the calendar settings: %d", resp.StatusCode)
	}

	// A new link invalidates the old one
	newToken := switchFeedOn(t, do)
	if newToken == token {
		t.Fatal("a new link must have a new token")
	}
	if resp, _ := fetchFeed(t, url, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("old link after renewing: status %d", resp.StatusCode)
	}
	newURL := ts.URL + "/calendar/" + newToken + ".ics"
	if resp, _ := fetchFeed(t, newURL, ""); resp.StatusCode != http.StatusOK {
		t.Errorf("new link: status %d", resp.StatusCode)
	}

	// The admin's switch closes every feed and refuses new ones
	off := false
	sys, _ := store.GetSystemSettings()
	sys.CalendarFeeds = &off
	_ = store.UpdateSystemSettings(sys)
	if resp, _ := fetchFeed(t, newURL, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("switched off on the server: status %d", resp.StatusCode)
	}
	if resp := do(http.MethodPut); resp.StatusCode != http.StatusForbidden {
		t.Errorf("new feed while switched off: status %d", resp.StatusCode)
	}
	on := true
	sys.CalendarFeeds = &on
	_ = store.UpdateSystemSettings(sys)

	// Switched off by the person: gone at once
	if resp := do(http.MethodDelete); resp.StatusCode != http.StatusOK {
		t.Fatalf("switch off: %d", resp.StatusCode)
	}
	if resp, _ := fetchFeed(t, newURL, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("after switching off: status %d", resp.StatusCode)
	}
	_ = srv
}

// Unknown tokens from one address are refused after a while; the lookups stay cheap.
func TestCalendarFeedMissesThrottled(t *testing.T) {
	_, _, ts, _, _ := startRealtimeServer(t)
	var last int
	for i := 0; i < calendarFeedMissesPerIP+1; i++ {
		resp, _ := fetchFeed(t, ts.URL+"/calendar/unknown"+string(rune('a'+i%26))+".ics", "")
		last = resp.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("after %d unknown tokens: status %d, want 429", calendarFeedMissesPerIP+1, last)
	}
}

// The same tasks in three zones: all-day events keep their calendar day (also on the day daylight saving
// time starts), timed events are the right instant in UTC, alarms of all-day tasks fire at 09:00 local.
func TestRenderCalendarFeedTimeZones(t *testing.T) {
	tasks := []storage.CalendarTask{
		{ID: "th_a", Content: "Ganztägig", DueDate: "2026-03-29", Reminders: []int{24 * 60}, CreatedAt: "2026-03-01T10:00:00Z"},
		{ID: "th_b", Content: "Mit Zeit", DueDate: "2026-03-29T09:30", CreatedAt: "2026-03-01T10:00:00Z", ChangedAt: "2026-03-02T11:00:00Z"},
	}
	cases := []struct {
		zone, timedUTC, alarmUTC string
	}{
		{"Europe/Berlin", "20260329T073000Z", "20260328T080000Z"},       // CEST from 29 March, CET the day before
		{"America/Los_Angeles", "20260329T163000Z", "20260328T160000Z"}, // PDT
		{"Asia/Tokyo", "20260329T003000Z", "20260328T000000Z"},
	}
	now := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)
	for _, c := range cases {
		loc, err := time.LoadLocation(c.zone)
		if err != nil {
			t.Fatal(err)
		}
		body := renderCalendarFeed(tasks, calendarFeedOptions{Lang: "en", Loc: loc, Link: func(id string) string { return "https://mindsift.example/?task=" + id }}, now)
		cal, events := eventsBySummary(t, body)
		if got := cal.Text("X-WR-CALNAME"); got != "MindSift – Tasks" {
			t.Errorf("%s: calendar name %q", c.zone, got)
		}
		allDay := events["Ganztägig"]
		if p, _ := allDay.Get("DTSTART"); p.Value != "20260329" {
			t.Errorf("%s: all-day start %q", c.zone, p.Value)
		}
		if p, _ := allDay.Get("DTEND"); p.Value != "20260330" {
			t.Errorf("%s: all-day end %q", c.zone, p.Value)
		}
		if p, _ := allDay.All("VALARM")[0].Get("TRIGGER"); p.Value != c.alarmUTC {
			t.Errorf("%s: all-day alarm %q, want %q", c.zone, p.Value, c.alarmUTC)
		}
		timed := events["Mit Zeit"]
		if p, _ := timed.Get("DTSTART"); p.Value != c.timedUTC {
			t.Errorf("%s: timed start %q, want %q", c.zone, p.Value, c.timedUTC)
		}
		if p, _ := timed.Get("LAST-MODIFIED"); p.Value != "20260302T110000Z" {
			t.Errorf("%s: LAST-MODIFIED %q", c.zone, p.Value)
		}
		if p, _ := timed.Get("URL"); p.Value != "https://mindsift.example/?task=th_b" {
			t.Errorf("%s: URL %q", c.zone, p.Value)
		}
		if strings.Contains(body, "\n") && strings.Count(body, "\r\n") != strings.Count(body, "\n") {
			t.Errorf("%s: bare LF in the feed", c.zone)
		}
	}
	// Same input, same output: the ETag stays the same until a task changes
	loc, _ := time.LoadLocation("Europe/Berlin")
	a := renderCalendarFeed(tasks, calendarFeedOptions{Loc: loc}, now)
	b := renderCalendarFeed(tasks, calendarFeedOptions{Loc: loc}, now.Add(3*time.Hour))
	if a != b {
		t.Error("the feed must not depend on the time of the request")
	}
}
