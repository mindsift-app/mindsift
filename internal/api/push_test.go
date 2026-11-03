package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestPushSubscribeKeyAndChannel(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	srv.cfg.NotifyDigestMinutes = 5
	router := srv.Router()
	me, token := newTestUser(t, store, "push@example.com")

	// The key is generated once and stays the same
	var k1, k2 struct {
		Enabled   bool
		PublicKey string
	}
	_ = json.Unmarshal(sessionCall(router, "GET", "/api/v1/push/key", token, "", "").Body.Bytes(), &k1)
	_ = json.Unmarshal(sessionCall(router, "GET", "/api/v1/push/key", token, "", "").Body.Bytes(), &k2)
	if !k1.Enabled || len(k1.PublicKey) < 80 || k1.PublicKey != k2.PublicKey {
		t.Fatalf("key: %+v / %+v", k1, k2)
	}

	if rec := sessionCall(router, "POST", "/api/v1/push/subscribe", token, `{"endpoint":"http://intern/x","keys":{"p256dh":"a","auth":"b"}}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("http endpoint must be refused, got %d", rec.Code)
	}
	body := `{"endpoint":"https://push.example.com/abc","keys":{"p256dh":"BAAA","auth":"CCCC"},"device":"Firefox auf Linux"}`
	if rec := sessionCall(router, "POST", "/api/v1/push/subscribe", token, body, ""); rec.Code != http.StatusOK {
		t.Fatalf("subscribe: %d %s", rec.Code, rec.Body.String())
	}
	rec := sessionCall(router, "GET", "/api/v1/push/devices", token, "", "")
	if !strings.Contains(rec.Body.String(), "Firefox auf Linux") || strings.Contains(rec.Body.String(), "CCCC") {
		t.Fatalf("devices must list the device without its keys: %s", rec.Body.String())
	}

	// Push as a channel for watched tasks
	var pushed []pushMessage
	srv.notifyPushHook = func(userID string, msg pushMessage) error {
		if userID == me.ID {
			pushed = append(pushed, msg)
		}
		return nil
	}
	task, _ := store.CreateThoughtWithDetails(me.ID, "Reifen wechseln", "normal", "manual", "", "", "todo", "")
	_ = store.WatchTask(task.ID, me.ID, true)
	set := store.NotificationSettingsOf(me.ID)
	set.IncludeOwnWatched = true
	set.Events.Watched = domain.ChannelChoice{Push: true}
	_ = store.SetNotificationSettings(me.ID, set)
	sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, token, `{"priority":"high"}`, "")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if len(pushed) != 1 || !strings.Contains(pushed[0].Body, "Reifen wechseln") {
		t.Fatalf("expected one push, got %+v", pushed)
	}

	if rec := sessionCall(router, "POST", "/api/v1/push/unsubscribe", token, `{"endpoint":"https://push.example.com/abc"}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("unsubscribe: %d", rec.Code)
	}
	if rec := sessionCall(router, "POST", "/api/v1/push/test", token, "", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("test without devices: want 400, got %d", rec.Code)
	}
}

func TestPushDigestText(t *testing.T) {
	one := pushDigest("de", "Neuigkeiten", []notifyItem{{text: "Anna hat „Einkauf“ erledigt"}}, "")
	if one.Body != "Anna hat „Einkauf“ erledigt" || one.URL != "/" {
		t.Fatalf("single: %+v", one)
	}
	many := pushDigest("de", "Neuigkeiten", []notifyItem{{text: "a"}, {text: "b"}, {text: "c"}, {text: "d"}, {text: "e"}, {text: "f"}}, "https://x/")
	if many.Title != "MindSift: Neuigkeiten" || !strings.HasSuffix(many.Body, "… und 2 weitere") {
		t.Fatalf("many: %+v", many)
	}
}

// A reinstalled app registers a new subscription and names the old one: it is dropped, not counted twice
func TestPushResubscribeReplacesOldDevice(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	me, token := newTestUser(t, store, "reinstall@example.com")
	sub := func(endpoint, replaces string) int {
		body := `{"endpoint":"` + endpoint + `","keys":{"p256dh":"k","auth":"a"},"device":"Chrome auf Android","replaces":"` + replaces + `"}`
		return sessionCall(router, http.MethodPost, "/api/v1/push/subscribe", token, body, "").Code
	}
	if code := sub("https://fcm.googleapis.com/fcm/send/alt", ""); code != http.StatusOK {
		t.Fatalf("subscribe: %d", code)
	}
	if code := sub("https://fcm.googleapis.com/fcm/send/neu", "https://fcm.googleapis.com/fcm/send/alt"); code != http.StatusOK {
		t.Fatalf("resubscribe: %d", code)
	}
	subs, _ := store.PushSubscriptions(me.ID)
	if len(subs) != 1 || subs[0].Endpoint != "https://fcm.googleapis.com/fcm/send/neu" {
		t.Fatalf("old installation must be replaced, got %+v", subs)
	}
}
