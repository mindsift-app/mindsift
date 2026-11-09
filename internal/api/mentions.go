package api

import (
	"net/http"
	"sort"
	"strings"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// @-mentions: the people the picker offers for a place (a note, a task, a task list) and the notification
// for someone newly mentioned there. Mentioning someone again notifies again; keeping a mention does not.

const mentionedText = "{name} hat dich in „{title}“ erwähnt"

// mentionAudience: who can see the place, and whether the requester is one of them.
func (s *Server) mentionAudience(userID string, r *http.Request) ([]string, bool) {
	q := r.URL.Query()
	var ids []string
	switch {
	case q.Get("docId") != "":
		docID := q.Get("docId")
		if s.store.DocRole(userID, docID) == "" {
			return nil, false
		}
		ids, _ = s.store.GetAuthorizedDocUsers(docID)
	case q.Get("taskId") != "":
		t, err := s.store.GetThoughtByID(userID, q.Get("taskId"))
		if err != nil || t == nil {
			return nil, false
		}
		ids = s.taskAudience(t)
	case q.Get("taskListId") != "":
		listID := q.Get("taskListId")
		if s.store.GetTaskListPermission(userID, listID) == "" {
			return nil, false
		}
		ids = s.store.GetTaskListUserIDs(listID)
	default:
		return []string{userID}, true
	}
	return ids, true
}

// handleMentionCandidates: the people one may mention, those without access to the place marked (shown
// greyed out in the picker). Everyone one can see per the organisation's rules, plus everyone with access.
func (s *Server) handleMentionCandidates(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	audience, ok := s.mentionAudience(userID, r)
	if !ok {
		writeError(w, http.StatusNotFound, "Nicht gefunden oder kein Zugriff")
		return
	}
	access := map[string]bool{}
	for _, id := range audience {
		access[id] = true
	}
	seen := map[string]bool{userID: true}
	out := make([]storage.MentionCandidate, 0)
	add := func(u domain.PublicUser) {
		if seen[u.ID] {
			return
		}
		seen[u.ID] = true
		out = append(out, storage.MentionCandidate{ID: u.ID, DisplayName: u.DisplayName, Username: u.Username, AvatarURL: u.AvatarURL, HasAccess: access[u.ID]})
	}
	if dir, err := s.store.GetDirectory(userID, s.peopleSearchEnabled()); err == nil {
		for _, u := range dir {
			add(u)
		}
	}
	for _, id := range audience {
		if seen[id] {
			continue
		}
		if u, err := s.store.GetUserByID(id); err == nil && u != nil && u.IsActive {
			add(domain.PublicUser{ID: u.ID, DisplayName: u.DisplayName, Username: u.Username, AvatarURL: u.AvatarURL})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].HasAccess != out[j].HasAccess {
			return out[i].HasAccess
		}
		return strings.ToLower(out[i].DisplayName) < strings.ToLower(out[j].DisplayName)
	})
	writeJSON(w, http.StatusOK, out)
}

// notifyMentioned tells the newly mentioned people who can see the place (the center links to it: a task,
// or a note and its bullet).
func (s *Server) notifyMentioned(actorID string, newly []string, audience []string, title, targetType, targetID, blockID string) {
	if len(newly) == 0 {
		return
	}
	can := map[string]bool{}
	for _, id := range audience {
		can[id] = true
	}
	var to []string
	for _, id := range newly {
		if can[id] {
			to = append(to, id)
		}
	}
	s.notify("mentioned", actorID, to, func(lang string) map[string]string {
		return map[string]string{
			"title":      title,
			"text":       i18n.T(lang, mentionedText, "name", s.actorName(lang, actorID), "title", title),
			centerTarget: targetType,
			centerID:     targetID,
			centerBlock:  blockID,
		}
	})
}

// taskMentionCounts: the mentions in a task's description and subtasks.
func taskMentionCounts(t *domain.Thought) map[string]int {
	if t == nil {
		return map[string]int{}
	}
	texts := []string{t.Notes}
	for _, st := range t.Subtasks {
		texts = append(texts, st.Title)
	}
	return storage.MentionCounts(texts...)
}

// notifyTaskMentions: people newly mentioned in a task's description or subtasks (before nil: a new task).
func (s *Server) notifyTaskMentions(actorID string, before, after *domain.Thought) {
	if after == nil {
		return
	}
	newly := storage.NewlyMentioned(taskMentionCounts(before), taskMentionCounts(after))
	s.notifyMentioned(actorID, newly, s.taskAudience(after), taskTitle(after), "task", after.ID, "")
}

// notifyNoteMentions: people newly mentioned in the bullets an edit wrote (each bullet remembers its
// mentions, so typing around a mention does not notify again).
func (s *Server) notifyNoteMentions(actorID, docID string, ops []collab.Op, results []collab.Result) {
	var audience []string
	title := ""
	for i, op := range ops {
		if i >= len(results) || results[i].Seq <= 0 || op.Content == nil || op.BlockID == "" {
			continue
		}
		if op.Kind != collab.OpInsert && op.Kind != collab.OpSetContent {
			continue
		}
		now := storage.MentionCounts(*op.Content)
		before, err := s.store.SwapBlockMentions(docID, op.BlockID, now)
		if err != nil {
			continue
		}
		newly := storage.NewlyMentioned(before, now)
		if len(newly) == 0 {
			continue
		}
		if title == "" {
			audience, _ = s.store.GetAuthorizedDocUsers(docID)
			title = s.docTitle(actorID, docID)
		}
		s.notifyMentioned(actorID, newly, audience, title, "note", docID, op.BlockID)
	}
}
