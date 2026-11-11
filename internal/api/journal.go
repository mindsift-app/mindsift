package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Journal: one ordinary note per day, opened (and created on first use) by date. The web app shows the
// days below each other with a calendar; the notes can be shared and searched like any other.

var journalMu sync.Mutex // one creation at a time, so a day never gets two notes

// journalTitle: "Freitag, 30. Oktober 2026" in the person's language
func journalTitle(lang string, day time.Time) string {
	return i18n.LongDate(lang, day)
}

func (s *Server) handleGetJournal(w http.ResponseWriter, r *http.Request) {
	days, err := s.store.JournalDays(auth.GetUserID(r.Context()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Journal konnte nicht geladen werden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"days": days})
}

// handleOpenJournalDay returns the note of a day and creates it when there is none yet.
func (s *Server) handleOpenJournalDay(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	date := chi.URLParam(r, "date")
	day, err := time.Parse("2006-01-02", date)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges Datum (erwartet JJJJ-MM-TT)")
		return
	}
	journalMu.Lock()
	defer journalMu.Unlock()
	docID, err := s.store.JournalDocID(userID, date)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Journal konnte nicht geladen werden")
		return
	}
	if docID != "" {
		if doc, err := s.store.GetDocumentByID(userID, docID); err == nil {
			writeJSON(w, http.StatusOK, doc)
			return
		}
	}
	doc, err := s.store.CreateDocument(userID, "", journalTitle(s.userLanguage(userID), day), "📅", "", nil, nil, false)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Journal-Tag konnte nicht angelegt werden")
		return
	}
	if err := s.store.SetJournalDay(userID, date, doc.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "Journal-Tag konnte nicht angelegt werden")
		return
	}
	s.broadcastDocToAuthorizedUsers(doc.ID, "DOC_CREATED")
	writeJSON(w, http.StatusCreated, doc)
}
