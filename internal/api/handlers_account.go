package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- CUSTOM THEMES ---

func (s *Server) handleGetThemes(w http.ResponseWriter, r *http.Request) {
	themes, err := s.store.GetUserThemes(auth.GetUserID(r.Context()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
		writeError(w, http.StatusBadRequest, err.Error())
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
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// confirmPassword checks the current password sent as {"password": "…"} before destructive actions.
func (s *Server) confirmPassword(w http.ResponseWriter, r *http.Request) (*domain.User, bool) {
	var req struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, err := s.store.GetUserByID(auth.GetUserID(r.Context()))
	if err != nil || user == nil {
		writeError(w, http.StatusUnauthorized, "Nicht autorisiert")
		return nil, false
	}
	if req.Password == "" || !auth.CheckPassword(req.Password, user.PasswordHash) {
		writeError(w, http.StatusForbidden, "Passwort ist falsch")
		return nil, false
	}
	return user, true
}

// runImport answers a preview (?preview=1) with what would be created, otherwise imports.
func (s *Server) runImport(w http.ResponseWriter, r *http.Request, plan *storage.ImportPlan, err error) {
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// sections=notes,tasks,…: only these parts of a MindSift backup (all when not given)
	sections := storage.NormalizeSections(strings.Split(r.URL.Query().Get("sections"), ","))
	plan = plan.Only(sections)
	if r.URL.Query().Get("preview") == "1" {
		writeJSON(w, http.StatusOK, trSummary(w, plan.Summary(false)))
		return
	}
	s.applyImport(w, auth.GetUserID(r.Context()), plan, sections, r.URL.Query().Get("mode") == "restore" && strings.HasSuffix(r.URL.Path, "/mindsift"))
}

// applyImport adds the plan to the user's data; with restore the chosen sections are emptied first.
// The plan is fully read and validated at this point, so a broken file never wipes anything.
func (s *Server) applyImport(w http.ResponseWriter, userID string, plan *storage.ImportPlan, sections map[string]bool, restore bool) {
	if restore {
		if err := s.store.PurgeUserSections(userID, sections); err != nil {
			writeError(w, http.StatusInternalServerError, "Wiederherstellen abgebrochen: "+err.Error())
			return
		}
	}
	sum, err := s.store.ApplyImport(userID, plan)
	if err != nil {
		slog.Error("Import abgebrochen", "user_id", userID, "error", err)
		writeError(w, http.StatusInternalServerError, "Import abgebrochen: "+err.Error())
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
	data, name, err := importUpload(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	plan, err := storage.PlanMindSiftImport(data, name)
	s.runImport(w, r, plan, err)
}

// handleImportObsidian imports an Obsidian vault (ZIP) into a folder named after the vault.
func (s *Server) handleImportObsidian(w http.ResponseWriter, r *http.Request) {
	data, name, err := importUpload(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	plan, err := storage.PlanObsidianImport(bytes.NewReader(data), int64(len(data)), name)
	s.runImport(w, r, plan, err)
}

// handleExportMarkdown streams an Obsidian-compatible ZIP of the user's workspace (no temp files).
func (s *Server) handleExportMarkdown(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	allowLongTransfer(w)
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="mindsift-vault-%s.zip"`, time.Now().Format("2006-01-02")))
	if err := s.store.WriteMarkdownVault(userID, w); err != nil {
		// Headers are already sent; the client gets a truncated archive
		slog.Error("Markdown-Export fehlgeschlagen", "user_id", userID, "error", err)
	}
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	allowLongTransfer(w)
	exportData, err := s.store.ExportUserData(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// ?format=zip: the same JSON compressed (backups grow quickly with notes); plain JSON stays the API default
	if r.URL.Query().Get("format") == "zip" {
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="mindsift-backup-%s.zip"`, time.Now().Format("2006-01-02")))
		if err := s.store.WriteBackupZip(userID, exportData, w); err != nil {
			slog.Error("Backup-Export fehlgeschlagen", "user_id", userID, "error", err)
		}
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=mindsift-export.json")
	writeJSON(w, http.StatusOK, exportData)
}
