package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The audit log of the administration (storage/audit.go): the admin handlers record what they changed
// with audit…, the administration reads it with GET /admin/audit, the command line with `mindsift audit`.

// auditChange is one changed field in the details of account.updated, settings.changed and
// setup.finished: old and new value, or only Changed for secrets (passwords, webhook addresses).
type auditChange struct {
	Key     string `json:"key"`
	From    any    `json:"from,omitempty"`
	To      any    `json:"to,omitempty"`
	Changed bool   `json:"changed,omitempty"`
}

// auditChanges is the details object holding the changes.
type auditChanges struct {
	Changes []auditChange `json:"changes"`
}

// auditUserTarget: an account as the target of a row.
func auditUserTarget(u *domain.User) storage.AuditEntry {
	if u == nil {
		return storage.AuditEntry{TargetKind: storage.AuditTargetUser}
	}
	return storage.AuditEntry{TargetKind: storage.AuditTargetUser, TargetID: u.ID, TargetName: auditName(u)}
}

// auditName: the username, else the display name (accounts from before usernames).
func auditName(u *domain.User) string {
	if u.Username != "" {
		return u.Username
	}
	return u.DisplayName
}

// audit records a change made by the signed-in account of the request. target carries TargetKind,
// TargetID and TargetName; a failure is logged, the change itself stands.
func (s *Server) audit(r *http.Request, action string, target storage.AuditEntry, details any) {
	id := auth.GetUserID(r.Context())
	actor, _ := s.store.GetUserByID(id)
	if actor == nil {
		actor = &domain.User{ID: id}
	}
	s.auditAs(actor, action, target, details)
}

// auditAs records a change made in the app by actor, where the request carries no session yet (the
// first account of the setup wizard).
func (s *Server) auditAs(actor *domain.User, action string, target storage.AuditEntry, details any) {
	e := target
	e.Action = action
	e.ActorKind, e.Source = storage.AuditActorUser, storage.AuditSourceWeb
	e.ActorID, e.ActorName = actor.ID, auditName(actor)
	s.recordAudit(e, details)
}

// auditBy records a change made without a request: the sign-in provider or the server itself.
func (s *Server) auditBy(actorKind, source, action string, target storage.AuditEntry, details any) {
	e := target
	e.Action, e.ActorKind, e.Source = action, actorKind, source
	s.recordAudit(e, details)
}

func (s *Server) recordAudit(e storage.AuditEntry, details any) {
	if err := s.store.RecordAudit(e, details); err != nil {
		slog.Warn("Writing the audit log failed", "action", e.Action, "target", e.TargetID, "error", err)
	}
}

// secretSettings are recorded as changed, never with their values.
var secretSettings = map[string]bool{"smtpPass": true}

// ignoredSettings are not settings of their own: read-only state, mirrors of another key, or what the
// environment fixes.
var ignoredSettings = map[string]bool{
	"allowRegistration": true, // mirrors registrationMode
	"smtpPassSet":       true, "smtpPassUnreadable": true, "smtpPassViaEnv": true,
	"smtpPassEnvHost": true, "smtpPassEnvUser": true, "smtpConfiguredViaEnv": true,
	"emailLinksAvailable": true, "oidc": true, "serverTime": true,
}

// settingsChanges compares the stored settings before and after a save, key by key (the JSON names the
// administration uses), sorted by key.
func settingsChanges(before, after *domain.SystemSettings) []auditChange {
	if before == nil || after == nil {
		return nil
	}
	b, a := settingsMap(before), settingsMap(after)
	keys := map[string]bool{}
	for k := range b {
		keys[k] = true
	}
	for k := range a {
		keys[k] = true
	}
	var out []auditChange
	for k := range keys {
		if ignoredSettings[k] || strings.HasSuffix(k, "ViaEnv") {
			continue
		}
		from, to := b[k], a[k]
		if reflect.DeepEqual(from, to) {
			continue
		}
		if secretSettings[k] {
			out = append(out, auditChange{Key: k, Changed: true})
			continue
		}
		out = append(out, auditChange{Key: k, From: auditValue(from), To: auditValue(to)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

func settingsMap(s *domain.SystemSettings) map[string]any {
	m := map[string]any{}
	if b, err := json.Marshal(s); err == nil {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

// auditValue: a missing value is recorded as an empty string, so "from" or "to" is never left out.
func auditValue(v any) any {
	if v == nil {
		return ""
	}
	return v
}

// handleAdminAudit: GET /admin/audit?action=&user=&before=&limit= – newest first; action is a key or a
// category ending in a dot ("account."), user an account id (rows it did or that concern it), before
// the id of the last row of the previous page. Answers {entries, nextBefore} (0: no older rows).
func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := storage.AuditFilter{Action: q.Get("action"), UserID: q.Get("user")}
	f.BeforeID, _ = strconv.ParseInt(q.Get("before"), 10, 64)
	f.Limit, _ = strconv.Atoi(q.Get("limit"))
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	// One more than asked for tells whether there is a next page
	want := f.Limit
	f.Limit++
	entries, err := s.store.AuditEntries(f)
	if err != nil {
		writeInternal(w, err)
		return
	}
	var next int64
	if len(entries) > want {
		entries = entries[:want]
		next = entries[want-1].ID
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "nextBefore": next})
}

// runAuditCleanup removes rows past storage.AuditKeep (hourly, with the other retention work).
func (s *Server) runAuditCleanup(now time.Time) {
	n, err := s.store.PruneAudit(now)
	if err != nil {
		slog.Warn("Cleaning up the audit log failed", "error", err)
		return
	}
	if n > 0 {
		slog.Info("Old entries of the audit log removed", "count", n)
	}
}

func auditOrgTarget(id, name string) storage.AuditEntry {
	return storage.AuditEntry{TargetKind: storage.AuditTargetOrganization, TargetID: id, TargetName: name}
}

// auditInviteTarget: an invite is named by the address it is bound to (empty for open links).
func auditInviteTarget(inv *domain.UserInvite) storage.AuditEntry {
	return storage.AuditEntry{TargetKind: storage.AuditTargetInvite, TargetID: inv.ID, TargetName: inv.Email}
}

// organizationName: "" when there is no such organization.
func (s *Server) organizationName(id string) string {
	names := s.organizationNames([]string{id})
	if len(names) == 0 {
		return ""
	}
	return names[0]
}

// organizationNames: the names of the organizations with these ids, in the order given.
func (s *Server) organizationNames(ids []string) []string {
	if len(ids) == 0 {
		return nil
	}
	orgs, err := s.store.GetOrganizations()
	if err != nil {
		return nil
	}
	byID := make(map[string]string, len(orgs))
	for _, o := range orgs {
		byID[o.ID] = o.Name
	}
	var out []string
	for _, id := range ids {
		if n, ok := byID[id]; ok {
			out = append(out, n)
		}
	}
	return out
}

// auditOrgMember: the person is the target (so the account filter finds it), the organization a detail.
func (s *Server) auditOrgMember(r *http.Request, action, orgID, userID string) {
	u, _ := s.store.GetUserByID(userID)
	if u == nil {
		return
	}
	s.audit(r, action, auditUserTarget(u), map[string]string{"organization": s.organizationName(orgID), "organizationId": orgID})
}

// auditUserUpdate records what PATCH /admin/users/{id} changed: the role, enabled or disabled, and
// name, username, address and Discord webhook (the webhook only as changed: it lets anybody post).
func (s *Server) auditUserUpdate(r *http.Request, before, after *domain.User) {
	if before == nil || after == nil {
		return
	}
	target := auditUserTarget(after)
	if before.Role != after.Role {
		s.audit(r, storage.AuditAccountRoleChanged, target, map[string]string{"from": before.Role, "to": after.Role})
	}
	if before.IsActive != after.IsActive {
		action := storage.AuditAccountDisabled
		if after.IsActive {
			action = storage.AuditAccountEnabled
		}
		s.audit(r, action, target, nil)
	}
	var changes []auditChange
	for _, f := range []struct{ key, from, to string }{
		{"displayName", before.DisplayName, after.DisplayName},
		{"username", before.Username, after.Username},
		{"email", before.Email, after.Email},
	} {
		if f.from != f.to {
			changes = append(changes, auditChange{Key: f.key, From: f.from, To: f.to})
		}
	}
	if before.DiscordWebhookURL != after.DiscordWebhookURL {
		changes = append(changes, auditChange{Key: "discordWebhookUrl", Changed: true})
	}
	if len(changes) > 0 {
		s.audit(r, storage.AuditAccountUpdated, target, auditChanges{Changes: changes})
	}
}
