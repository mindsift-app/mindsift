package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
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
	return role == domain.TeamRoleAdmin
}

func (s *Server) handleCreateTeamDirect(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Name           string `json:"name"`
		Description    string `json:"description"`
		OrganizationID string `json:"organizationId"`
	}
	if !decodeJSON(w, r, &req) {
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
	// A group belongs to one of its creator's organizations; members can only come from there. With
	// several the creator picks one, with one it is that one.
	orgs := s.store.UserOrganizationIDs(userID)
	orgID := ""
	switch {
	case req.OrganizationID != "":
		if !s.store.IsOrganizationMember(req.OrganizationID, userID) {
			writeError(w, http.StatusBadRequest, storage.ErrOrganizationNotFound.Error())
			return
		}
		orgID = req.OrganizationID
	case len(orgs) == 1:
		orgID = orgs[0]
	case len(orgs) > 1 && s.store.SharingMode() == storage.SharingOrganizations:
		writeError(w, http.StatusBadRequest, "Bitte wähle die Organisation der Gruppe")
		return
	case len(orgs) > 1:
		orgID = orgs[0]
	}
	team, err := s.store.CreateTeam(orgID, name, req.Description)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	// Automatically add creator to team as group admin
	if err := s.store.AddTeamMember(team.ID, userID, domain.TeamRoleAdmin); err != nil {
		writeInternal(w, err)
		return
	}
	team.Members, err = s.store.GetTeamMembers(team.ID)
	logFailed("Loading the members of the new group", err, "team_id", team.ID)
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
	if !decodeJSON(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "Name für das Team / die Gruppe ist erforderlich")
		return
	}
	updated, err := s.store.UpdateTeam(teamID, name, req.Description)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
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
	before := s.teamAccessBefore(teamID)
	if err := s.store.DeleteTeam(teamID); err != nil {
		writeInternal(w, err)
		return
	}
	s.afterTeamChange(teamID, before, false)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleGetUserTeams(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	teams, err := s.store.GetTeamsForUser(userID)
	if err != nil {
		writeInternal(w, err)
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
	if !decodeJSON(w, r, &req) {
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
	// Only people the group admin can see, and with organizations only from the group's one; unknown
	// and invisible look the same
	if targetUserID == "" || !s.store.CanShareWith(userID, "user", targetUserID) || !s.store.FitsTeamOrganization(teamID, targetUserID) {
		writeError(w, http.StatusNotFound, storage.ErrTargetNotFound.Error())
		return
	}
	role := strings.ToLower(strings.TrimSpace(req.Role))
	if !domain.ValidTeamRole(role) {
		role = domain.TeamRoleMember
	}
	// Adding a member again only changes the role: no events, no notification
	wasMember, _ := s.store.GetTeamMemberRole(teamID, targetUserID)
	before := s.teamAccessBefore(teamID)
	if err := s.store.AddTeamMember(teamID, targetUserID, role); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	if wasMember == "" {
		s.afterTeamChange(teamID, before, true)
		s.notifyTeamAdded(userID, targetUserID, teamID)
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
	if !decodeJSON(w, r, &req) {
		return
	}
	role := strings.ToLower(strings.TrimSpace(req.Role))
	if !domain.ValidTeamRole(role) {
		writeError(w, http.StatusBadRequest, "Ungültige Rolle (erlaubt sind: admin, member)")
		return
	}
	if err := s.store.UpdateTeamMemberRole(teamID, memberUserID, role); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
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

	wasMember, _ := s.store.GetTeamMemberRole(teamID, memberUserID)
	before := s.teamAccessBefore(teamID)
	if err := s.store.RemoveTeamMember(teamID, memberUserID); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	if wasMember != "" {
		s.afterTeamChange(teamID, before, false)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}

// teamAccess is what a group gives its members, read before a change of its members: the members, what
// is shared with the group, and who saw each of those before.
type teamAccess struct {
	members                         []string
	shares                          storage.TeamShares
	taskLists, lists, docs, folders map[string][]string
}

func (s *Server) teamAccessBefore(teamID string) teamAccess {
	a := teamAccess{shares: s.store.GetTeamShares(teamID), taskLists: map[string][]string{}, lists: map[string][]string{},
		docs: map[string][]string{}, folders: map[string][]string{}}
	members, _ := s.store.GetTeamMembers(teamID)
	for _, m := range members {
		a.members = append(a.members, m.UserID)
	}
	for _, id := range a.shares.TaskLists {
		a.taskLists[id] = s.store.GetTaskListUserIDs(id)
	}
	for id := range a.shares.Lists {
		a.lists[id] = s.store.GetListUserIDs(id)
	}
	for _, id := range a.shares.Docs {
		a.docs[id], _ = s.store.GetAuthorizedDocUsers(id)
	}
	for _, id := range a.shares.Folders {
		a.folders[id] = s.store.GetSharedFolderUserIDs(id)
	}
	return a
}

// afterTeamChange tells everyone who saw something through the group before or sees it now (someone
// added or removed, the group deleted), as sharing or unsharing each of them would: their task lists,
// lists, notes and shared folders appear or go without a reload. What was shared with the group before
// or is now counts (removing someone also removes the shares they had made with the group). Whoever may
// have lost something leaves its realtime rooms (dropLostRooms).
func (s *Server) afterTeamChange(teamID string, before teamAccess, added bool) {
	now := s.store.GetTeamShares(teamID)

	taskLists := unionIDs(before.shares.TaskLists, now.TaskLists)
	for _, id := range taskLists {
		s.broadcastTaskListChange(id, before.taskLists[id], eventTaskListUpdated)
	}

	listShares := map[string]string{}
	for id, share := range before.shares.Lists {
		listShares[id] = share
	}
	for id, share := range now.Lists {
		listShares[id] = share
	}
	for listID, shareID := range listShares {
		audience := before.lists[listID]
		if audience == nil {
			audience = []string{}
		}
		if added {
			var payload any = map[string]string{"listId": listID, "id": shareID}
			if shares, err := s.store.GetListShares(listID); err == nil {
				for _, sh := range shares {
					if sh.ID == shareID {
						payload = sh
					}
				}
			}
			s.broadcastListAudience(listID, audience, eventListShared, payload)
		} else {
			s.broadcastListAudience(listID, audience, eventListUnshared, map[string]string{"listId": listID, "shareId": shareID})
		}
	}

	for _, docID := range unionIDs(before.shares.Docs, now.Docs) {
		after, _ := s.store.GetAuthorizedDocUsers(docID)
		for _, uid := range lostUsers(before.docs[docID], after) {
			s.wsHub.BroadcastToUser(uid, eventDocDeleted, map[string]string{"id": docID})
		}
		for _, uid := range lostUsers(after, before.docs[docID]) {
			if doc, err := s.store.GetDocumentListItem(uid, docID); err == nil && doc != nil {
				s.wsHub.BroadcastToUser(uid, eventDocCreated, doc)
			}
		}
	}

	for _, folderID := range unionIDs(before.shares.Folders, now.Folders) {
		users := append(before.folders[folderID], s.store.GetSharedFolderUserIDs(folderID)...)
		s.wsHub.BroadcastToUsers(users, eventFoldersUpdated, map[string]string{"type": folderEventShared, "folderId": folderID})
	}

	if !added {
		s.dropLostRooms(before.members)
	}
}

// unionIDs: the ids of a and b, each once, in order.
func unionIDs(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	for _, id := range append(append([]string{}, a...), b...) {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
