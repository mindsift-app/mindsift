package api

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// The server's time zone in the administration: shown with its source, an unknown name refused, a new
// one in effect at once, "" back to TZ or UTC.
func TestTimeZoneSetting(t *testing.T) {
	t.Setenv("TZ", "")
	clock.UseInTest(t, time.UTC) // whatever the test does to the zone is undone afterwards
	srv, _, token := setupTestServer(t)
	router := srv.Router()
	srv.ApplyTimeZone()

	serverTime := func(body map[string]any) (zone, source, now string) {
		st, _ := body["serverTime"].(map[string]any)
		if st == nil {
			t.Fatalf("no serverTime in %v", body)
		}
		zone, _ = st["zone"].(string)
		source, _ = st["source"].(string)
		now, _ = st["now"].(string)
		return
	}

	_, _, adm := oauthDo(t, router, http.MethodGet, "/api/v1/admin/settings", token, "", "")
	if adm["timeZone"] != "" {
		t.Fatalf("not set at first: %v", adm["timeZone"])
	}
	if zone, source, now := serverTime(adm); zone != "UTC" || source != clock.SourceDefault || !strings.HasSuffix(now, "Z") {
		t.Fatalf("default: %s %s %s", zone, source, now)
	}

	for _, bad := range []string{"Mars/Olympus", "Local", "Europe/../Berlin"} {
		rec := sessionCall(router, http.MethodPut, "/api/v1/admin/settings", token, `{"timeZone":"`+bad+`"}`, "")
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Unbekannte Zeitzone") {
			t.Fatalf("%q must be refused: %d %s", bad, rec.Code, rec.Body.String())
		}
	}
	if clock.Location() != time.UTC {
		t.Fatalf("a refused zone must not apply: %s", clock.Location())
	}

	code, _, saved := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", token, "application/json", `{"timeZone":"Asia/Tokyo"}`)
	if code != http.StatusOK || saved["timeZone"] != "Asia/Tokyo" {
		t.Fatalf("set: %d %v", code, saved["timeZone"])
	}
	if zone, source, now := serverTime(saved); zone != "Asia/Tokyo" || source != clock.SourceSetting || !strings.HasSuffix(now, "+09:00") {
		t.Fatalf("after saving: %s %s %s", zone, source, now)
	}
	if clock.Location().String() != "Asia/Tokyo" {
		t.Fatalf("not in effect at once: %s", clock.Location())
	}

	// Clients that leave the field out (older apps, scripts) keep the zone; the read-only part is ignored
	if code, _, _ := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", token, "application/json", `{"instanceName":"Zuhause","serverTime":{"zone":"Europe/Paris"}}`); code != http.StatusOK || clock.Location().String() != "Asia/Tokyo" {
		t.Fatalf("saving without timeZone: %d %s", code, clock.Location())
	}

	// Not set again: TZ of the environment, else UTC
	t.Setenv("TZ", "America/Los_Angeles")
	_, _, adm = oauthDo(t, router, http.MethodGet, "/api/v1/admin/settings", token, "", "")
	if st, _ := adm["serverTime"].(map[string]any); st["fallback"] != "America/Los_Angeles" || st["zone"] != "Asia/Tokyo" {
		t.Fatalf("fallback while set: %v", st)
	}
	_, _, saved = oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", token, "application/json", `{"timeZone":""}`)
	if zone, source, _ := serverTime(saved); saved["timeZone"] != "" || zone != "America/Los_Angeles" || source != clock.SourceEnv {
		t.Fatalf("reset with TZ: %v %s %s", saved["timeZone"], zone, source)
	}
	t.Setenv("TZ", "")
	srv.ApplyTimeZone()
	if z := clock.Current(); z.Name() != "UTC" || z.Source != clock.SourceDefault {
		t.Fatalf("reset without TZ: %s %s", z.Name(), z.Source)
	}
}

// One instant, two calendar days: 23:30 UTC on 13 November is 08:30 on the 14th in Tokyo. Everything
// that counts days or hours follows the zone as soon as it changes.
func TestTimeZoneChangeAppliesAtOnce(t *testing.T) {
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	clock.UseInTest(t, time.UTC)
	instant := time.Date(2026, 11, 13, 23, 30, 0, 0, time.UTC)
	inUTC, inTokyo := func() { clock.Set(clock.Zone{Loc: time.UTC}) }, func() { clock.Set(clock.Zone{Loc: tokyo, Source: clock.SourceSetting}) }

	// "today" of GET /tasks?due=today
	tasks := []domain.Thought{{ID: "a", DueDate: "2026-11-13"}, {ID: "b", DueDate: "2026-11-14T10:00"}}
	today := func() string {
		got, err := filterTasks(tasks, "", "today", instant)
		if err != nil || len(got) != 1 {
			t.Fatalf("filterTasks: %v %v", got, err)
		}
		return got[0].ID
	}
	inUTC()
	if today() != "a" {
		t.Fatal("UTC: the 13th is today")
	}
	inTokyo()
	if today() != "b" {
		t.Fatal("Tokyo: the 14th is today")
	}

	// Alarms: 08:00 on the 14th has passed in Tokyo, not in UTC
	inUTC()
	if alarmDue("2026-11-14T08:00", 0, instant) {
		t.Fatal("UTC: not due yet")
	}
	inTokyo()
	if !alarmDue("2026-11-14T08:00", 0, instant) {
		t.Fatal("Tokyo: due")
	}

	// Backups at 03:00, the last one on the 13th: the next day has begun only in Tokyo
	sys := &domain.SystemSettings{BackupEnabled: true, BackupTime: "03:00"}
	inUTC()
	if backupDue(sys, "2026-11-13", instant) {
		t.Fatal("UTC: already ran today")
	}
	inTokyo()
	if !backupDue(sys, "2026-11-13", instant) {
		t.Fatal("Tokyo: a new day, past 03:00")
	}

	// Greeting in mails by the hour of the server
	inUTC()
	if g := mailGreeting("de", instant, ""); g != "Guten Abend" {
		t.Fatalf("UTC: %s", g)
	}
	inTokyo()
	if g := mailGreeting("de", instant, ""); g != "Guten Morgen" {
		t.Fatalf("Tokyo: %s", g)
	}
}

// The daily summary at 08:30 goes out when it is 08:30 in the server's zone
func TestDailySummaryFollowsTimeZone(t *testing.T) {
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	clock.UseInTest(t, time.UTC)
	srv, sent := notifyServer(t)
	store := srv.store
	me, _ := newTestUser(t, store, "zeitzone@example.com")
	set := store.NotificationSettingsOf(me.ID)
	set.DailySummary = domain.DailySummary{Enabled: true, Time: "08:30", Email: true}
	_ = store.SetNotificationSettings(me.ID, set)
	th, _ := store.CreateThoughtWithDetails(me.ID, "Zahnarzt", "normal", "manual", "2026-11-14T10:00", "", "todo", "")
	if _, err := store.UpdateThoughtTriage(me.ID, th.ID, "keep", "task", "", "2026-11-14T10:00", ""); err != nil {
		t.Fatal(err)
	}

	instant := time.Date(2026, 11, 13, 23, 31, 0, 0, time.UTC)
	srv.sendDailySummaries(instant) // 23:31 in UTC
	if len(*sent) != 0 {
		t.Fatalf("UTC: not the time yet, got %d", len(*sent))
	}
	clock.Set(clock.Zone{Loc: tokyo, Source: clock.SourceSetting})
	srv.sendDailySummaries(instant) // 08:31 in Tokyo
	if len(*sent) != 1 || !strings.Contains((*sent)[0].text, "HEUTE\n• Zahnarzt (10:00 Uhr)") || !strings.Contains((*sent)[0].text, "Guten Morgen") {
		t.Fatalf("Tokyo: %+v", *sent)
	}
}
