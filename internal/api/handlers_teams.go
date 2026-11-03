package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func (s *Server) isTeamAdmin(userID, teamID string) bool {
	if userID == "" || teamID == "" {
		return false
	}
	role, err := s.store.GetTeamMemberRole(teamID, userID)
	if err != nil {
		return false
	}
	return role == "admin"
}

func (s *Server) handleCreateTeamDirect(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	if s.store.SharingMode() == storage.SharingPrivate {
		writeError(w, http.StatusForbidden, storage.ErrSharingDisabled.Error())
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "Name für die Gruppe ist erforderlich")
		return
	}
	// A group belongs to its creator's organization; members can only come from there
	creator, _ := s.store.GetUserByID(userID)
	orgID := ""
	if creator != nil {
		orgID = creator.OrganizationID
	}
	team, err := s.store.CreateTeam(orgID, name, req.Description)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Automatically add creator to team as group admin
	if err := s.store.AddTeamMember(team.ID, userID, "admin"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	team.Members, _ = s.store.GetTeamMembers(team.ID)
	writeJSON(w, http.StatusCreated, team)
}

func (s *Server) handleUpdateTeam(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	teamID := chi.URLParam(r, "id")
	if !s.isTeamAdmin(userID, teamID) {
		writeError(w, http.StatusForbidden, "Nur Gruppen-Administratoren können die Gruppe bearbeiten")
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "Name für das Team / die Gruppe ist erforderlich")
		return
	}
	updated, err := s.store.UpdateTeam(teamID, name, req.Description)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteTeam(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	teamID := chi.URLParam(r, "id")
	if !s.isTeamAdmin(userID, teamID) {
		writeError(w, http.StatusForbidden, "Nur Gruppen-Administratoren können die Gruppe löschen")
		return
	}
	if err := s.store.DeleteTeam(teamID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleGetUserTeams(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	teams, err := s.store.GetTeamsForUser(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, teams)
}

func (s *Server) handleAddTeamMember(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	teamID := chi.URLParam(r, "id")
	if !s.isTeamAdmin(userID, teamID) {
		writeError(w, http.StatusForbidden, "Nur Gruppen-Administratoren können Mitglieder hinzufügen")
		return
	}
	var req struct {
		UserID string `json:"userId"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	targetUserID := strings.TrimSpace(req.UserID)
	if targetUserID == "" && strings.TrimSpace(req.Email) != "" {
		if u, err := s.store.GetUserByEmail(req.Email); err == nil && u != nil {
			targetUserID = u.ID
		}
	}
	if targetUserID == "" && strings.TrimSpace(req.Email) == "" {
		writeError(w, http.StatusBadRequest, "Benutzer-ID oder E-Mail erforderlich")
		return
	}
	// Only people the group admin can see; unknown and invisible look the same
	if targetUserID == "" || !s.store.CanShareWith(userID, "user", targetUserID) {
		writeError(w, http.StatusNotFound, storage.ErrTargetNotFound.Error())
		return
	}
	role := strings.ToLower(strings.TrimSpace(req.Role))
	if role != "admin" && role != "member" {
		role = "member"
	}
	if err := s.store.AddTeamMember(teamID, targetUserID, role); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	members, _ := s.store.GetTeamMembers(teamID)
	writeJSON(w, http.StatusOK, members)
}

func (s *Server) handleUpdateTeamMemberRole(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	teamID := chi.URLParam(r, "id")
	memberUserID := chi.URLParam(r, "userId")
	if !s.isTeamAdmin(userID, teamID) {
		writeError(w, http.StatusForbidden, "Nur Gruppen-Administratoren können Mitgliedsrollen ändern")
		return
	}
	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	role := strings.ToLower(strings.TrimSpace(req.Role))
	if role != "admin" && role != "member" {
		writeError(w, http.StatusBadRequest, "Ungültige Rolle (erlaubt sind: admin, member)")
		return
	}
	if err := s.store.UpdateTeamMemberRole(teamID, memberUserID, role); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	members, _ := s.store.GetTeamMembers(teamID)
	writeJSON(w, http.StatusOK, members)
}

func (s *Server) handleRemoveTeamMember(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	teamID := chi.URLParam(r, "id")
	memberUserID := chi.URLParam(r, "userId")

	isSelf := userID == memberUserID
	isAdmin := s.isTeamAdmin(userID, teamID)

	if !isSelf && !isAdmin {
		writeError(w, http.StatusForbidden, "Nicht berechtigt, dieses Mitglied zu entfernen")
		return
	}

	if err := s.store.RemoveTeamMember(teamID, memberUserID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}
