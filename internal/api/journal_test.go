package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestJournalDayIsCreatedOnceAndListed(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	me, token := newTestUser(t, store, "journal@example.com")

	rec := sessionCall(router, "POST", "/api/v1/journal/2026-10-30", token, "", "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var doc struct {
		ID, Title, Icon string
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &doc)
	if doc.Title != "Freitag, 30. Oktober 2026" || doc.Icon != "📅" {
		t.Fatalf("unexpected note: %+v", doc)
	}

	// Opening the same day again returns the same note
	rec = sessionCall(router, "POST", "/api/v1/journal/2026-10-30", token, "", "")
	var again struct{ ID string }
	_ = json.Unmarshal(rec.Body.Bytes(), &again)
	if rec.Code != http.StatusOK || again.ID != doc.ID {
		t.Fatalf("second open: %d id %s want %s", rec.Code, again.ID, doc.ID)
	}

	rec = sessionCall(router, "GET", "/api/v1/journal", token, "", "")
	var list struct {
		Days []struct {
			Date, DocID string
			Empty       bool
		}
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Days) != 1 || list.Days[0].Date != "2026-10-30" || list.Days[0].DocID != doc.ID || !list.Days[0].Empty {
		t.Fatalf("list: %s", rec.Body.String())
	}

	// Other people have their own journal
	_, otherToken := newTestUser(t, store, "andere@example.com")
	rec = sessionCall(router, "GET", "/api/v1/journal", otherToken, "", "")
	if rec.Code != http.StatusOK || rec.Body.String() == "" {
		t.Fatalf("other list: %d", rec.Code)
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Days) != 0 {
		t.Fatalf("other user must not see my journal: %+v", list.Days)
	}

	// A day whose note went to the trash gets a fresh note
	if err := store.DeleteDocument(me.ID, doc.ID); err != nil {
		t.Fatalf("trash: %v", err)
	}
	rec = sessionCall(router, "POST", "/api/v1/journal/2026-10-30", token, "", "")
	_ = json.Unmarshal(rec.Body.Bytes(), &again)
	if rec.Code != http.StatusCreated || again.ID == doc.ID {
		t.Fatalf("after trash: %d id %s", rec.Code, again.ID)
	}

	if rec := sessionCall(router, "POST", "/api/v1/journal/30.10.2026", token, "", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad date: want 400, got %d", rec.Code)
	}
}

func TestJournalTitle(t *testing.T) {
	day := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	if got := journalTitle(day); got != "Sonntag, 1. März 2026" {
		t.Fatalf("got %q", got)
	}
}
