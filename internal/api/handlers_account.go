package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- CUSTOM THEMES ---

func (s *Server) handleGetThemes(w http.ResponseWriter, r *http.Request) {
	themes, err := s.store.GetUserThemes(auth.GetUserID(r.Context()))
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, themes)
}

// handleSaveTheme creates a theme, or updates it when an id of the caller's theme is given.
func (s *Server) handleSaveTheme(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		CSS  string `json:"css"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, storage.MaxThemeCSSBytes+16*1024)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage oder Theme zu groß")
		return
	}
	theme, err := s.store.SaveUserTheme(auth.GetUserID(r.Context()), strings.TrimSpace(req.ID), req.Name, req.CSS)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	status := http.StatusCreated
	if req.ID != "" {
		status = http.StatusOK
	}
	writeJSON(w, status, theme)
}

func (s *Server) handleDeleteTheme(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteUserTheme(auth.GetUserID(r.Context()), chi.URLParam(r, "id")); err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// confirmPassword checks the current password sent as {"password": "…"} (and a second factor when the
// account has one: code, or passkeyToken + passkey) before destructive actions;
// failed guesses count like failed logins, so a stolen session cannot try passwords endlessly.
func (s *Server) confirmPassword(w http.ResponseWriter, r *http.Request) (*domain.User, bool) {
	var req struct {
		Password string `json:"password"`
		secondFactor
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, err := s.store.GetUserByID(auth.GetUserID(r.Context()))
	if err != nil || user == nil {
		writeError(w, http.StatusUnauthorized, "Nicht autorisiert")
		return nil, false
	}
	if !s.confirmWithSecondFactor(w, r, user, req.Password, req.secondFactor) {
		return nil, false
	}
	return user, true
}

// runImport answers a preview (?preview=1) with what would be created, otherwise imports.
func (s *Server) runImport(w http.ResponseWriter, r *http.Request, plan *storage.ImportPlan, err error) {
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	// sections=notes,tasks,…: only these parts of a MindSift backup (all when not given)
	sections := storage.NormalizeSections(strings.Split(r.URL.Query().Get("sections"), ","))
	plan = plan.Only(sections)
	if r.URL.Query().Get("preview") == "1" {
		s.previewImport(w, auth.GetUserID(r.Context()), plan)
		return
	}
	s.applyImport(w, auth.GetUserID(r.Context()), plan, sections, r.URL.Query().Get("mode") == "restore" && strings.HasSuffix(r.URL.Path, "/mindsift"))
}

// previewImport answers with what the plan would create and skip, including references to files the
// person may not read (they are dropped when the plan is applied).
func (s *Server) previewImport(w http.ResponseWriter, userID string, plan *storage.ImportPlan) {
	s.store.CheckImportMedia(userID, plan)
	writeJSON(w, http.StatusOK, trSummary(w, plan.Summary(false)))
}

// applyImport adds the plan to the user's data; with restore the chosen sections are emptied first.
// The plan is fully read and validated at this point, so a broken file never wipes anything.
func (s *Server) applyImport(w http.ResponseWriter, userID string, plan *storage.ImportPlan, sections map[string]bool, restore bool) {
	if restore {
		if err := s.store.PurgeUserSections(userID, sections); err != nil {
			writeError(w, http.StatusInternalServerError, "Wiederherstellen abgebrochen: "+clientMessage(err))
			return
		}
	}
	sum, err := s.store.ApplyImport(userID, plan)
	if err != nil {
		slog.Error("Import aborted", "user_id", userID, "error", err)
		writeError(w, http.StatusInternalServerError, "Import abgebrochen: "+clientMessage(err))
		return
	}
	writeJSON(w, http.StatusOK, trSummary(w, sum))
}

// trSummary translates why files of an import were skipped ("Theme: …" part by part).
func trSummary(w http.ResponseWriter, sum storage.ImportSummary) storage.ImportSummary {
	for i := range sum.Skipped {
		sum.Skipped[i].Reason = tr(w, sum.Skipped[i].Reason)
	}
	return sum
}

// handleImportMindSift restores MindSift's own data: the JSON backup or the Markdown archive (ZIP).
func (s *Server) handleImportMindSift(w http.ResponseWriter, r *http.Request) {
	file, size, name, err := importUpload(w, r)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	defer file.Close()
	done, ok := s.startImport(w, r)
	if !ok {
		return
	}
	defer done()
	plan, err := storage.PlanMindSiftImport(file, size, name)
	s.runImport(w, r, plan, err)
}

// handleImportObsidian imports an Obsidian vault (ZIP) into a folder named after the vault.
func (s *Server) handleImportObsidian(w http.ResponseWriter, r *http.Request) {
	file, size, name, err := importUpload(w, r)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	defer file.Close()
	done, ok := s.startImport(w, r)
	if !ok {
		return
	}
	defer done()
	plan, err := storage.PlanObsidianImport(file, size, name)
	s.runImport(w, r, plan, err)
}

// abortDownload ends a download that failed half way: the status is sent already, so the connection is
// cut instead. The browser then reports a failed download rather than saving a broken archive.
func abortDownload(what, userID string, err error) {
	slog.Error(what, "user_id", userID, "error", err)
	panic(http.ErrAbortHandler)
}

// handleExportMarkdown streams an Obsidian-compatible ZIP of the user's workspace (no temp files).
func (s *Server) handleExportMarkdown(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	allowLongTransfer(w)
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="mindsift-vault-%s.zip"`, clock.Today()))
	if err := s.store.WriteMarkdownVault(userID, w); err != nil {
		abortDownload("Markdown export failed", userID, err)
	}
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	allowLongTransfer(w)
	exportData, err := s.store.ExportUserData(userID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	// ?format=zip: the same JSON compressed (backups grow quickly with notes); plain JSON stays the API default
	if r.URL.Query().Get("format") == "zip" {
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="mindsift-backup-%s.zip"`, clock.Today()))
		if err := s.store.WriteBackupZip(userID, exportData, w); err != nil {
			abortDownload("Backup export failed", userID, err)
		}
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=mindsift-export.json")
	writeJSON(w, http.StatusOK, exportData)
}
