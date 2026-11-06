package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Who may find whom when sharing (docs: Doku/sharing-and-permissions.md). The sharing mode decides with
// whom one may share at all; people search only decides whether names are suggested while typing.

// peopleSearchEnabled: PEOPLE_SEARCH if set, else the admin's switch (default on).
func (s *Server) peopleSearchEnabled() bool {
	if s.cfg.PeopleSearch != nil {
		return *s.cfg.PeopleSearch
	}
	sys, _ := s.store.GetSystemSettings()
	return sys == nil || sys.PeopleSearch == nil || *sys.PeopleSearch
}

// publicLinksEnabled: never in demo mode; PUBLIC_LINKS if set, else the admin's switch (default on).
func (s *Server) publicLinksEnabled() bool {
	if s.cfg.DemoMode {
		return false
	}
	if s.cfg.PublicLinks != nil {
		return *s.cfg.PublicLinks
	}
	sys, _ := s.store.GetSystemSettings()
	return sys == nil || sys.PublicLinks == nil || *sys.PublicLinks
}

// publicLinkMaxDays: PUBLIC_LINKS_MAX_DAYS if set, else the admin's limit; never above 14 days.
func (s *Server) publicLinkMaxDays() int {
	if s.cfg.PublicLinkMaxDays > 0 {
		return s.cfg.PublicLinkMaxDays
	}
	if sys, _ := s.store.GetSystemSettings(); sys != nil && sys.PublicLinkMaxDays > 0 {
		return sys.PublicLinkMaxDays
	}
	return storage.MaxPublicLinkDays
}

// handleGetUsersDirectory lists the people whose names the viewer may see: everyone they may share
// with (findable, only while people search is on) and everyone they work on something together with.
func (s *Server) handleGetUsersDirectory(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	users, err := s.store.GetDirectory(userID, s.peopleSearchEnabled())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}

// handleLookupUser finds one person by exact e-mail address or username, for sharing without people
// search. Unknown people and people one may not share with get the same answer.
func (s *Server) handleLookupUser(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	if wait := s.loginGuard.throttle("lookup:"+userID, clientIPFrom(r), 30); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	var req struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	login := strings.TrimSpace(req.Login)
	u, err := s.store.GetUserByLogin(login)
	if login == "" || err != nil || u == nil || u.ID == userID || !u.IsActive || !s.store.CanShareWith(userID, "user", u.ID) {
		writeError(w, http.StatusNotFound, storage.ErrTargetNotFound.Error())
		return
	}
	p := domain.ToPublicUser(*u)
	p.Findable = true
	writeJSON(w, http.StatusOK, p)
}
