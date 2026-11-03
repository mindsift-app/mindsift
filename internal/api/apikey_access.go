package api

import (
	"context"
	"net/http"
	"regexp"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// What an API key may do. The rights (scopes) hold the same over every access: the REST endpoints
// below (curl, smart home) and the MCP endpoint for AI agents (mcpToolAllowed). Notes, settings and
// everything else stay reserved for a login.

// apiKeyAuth: the key a request was made with
type apiKeyAuth struct {
	ID     string
	Scopes []string
	// OAuth: an access token of an OAuth connection (oauth.go), valid for the MCP endpoint only
	OAuth bool
}

// apiActor: an API key acting on entries; via is storage.OriginAPI or storage.OriginMCP. Recorded as
// the entry's origin (storage.RecordOrigin).
type apiActor struct {
	Via   string
	KeyID string
}

type apiKeyCtxKey struct{}

type apiKeyCtx struct {
	scopes []string
	actor  *apiActor
}

func withAPIKey(ctx context.Context, key *apiKeyAuth, via string) context.Context {
	return context.WithValue(ctx, apiKeyCtxKey{}, apiKeyCtx{scopes: key.Scopes, actor: &apiActor{Via: via, KeyID: key.ID}})
}

// keyScopes returns the scopes of the request's API key; isKey is false for login sessions.
func keyScopes(ctx context.Context) (scopes []string, isKey bool) {
	k, ok := ctx.Value(apiKeyCtxKey{}).(apiKeyCtx)
	return k.scopes, ok
}

// actorFrom: the API key behind the request, nil for login sessions.
func actorFrom(ctx context.Context) *apiActor {
	if k, ok := ctx.Value(apiKeyCtxKey{}).(apiKeyCtx); ok {
		return k.actor
	}
	return nil
}

func hasAnyScope(scopes []string, want ...string) bool {
	for _, have := range scopes {
		for _, w := range want {
			if have == w {
				return true
			}
		}
	}
	return false
}

// keyRoute: one REST endpoint an API key may call, with the scopes of which it needs one. nil scopes:
// the handler (or MCP tool) checks the exact right itself.
type keyRoute struct {
	method string
	path   *regexp.Regexp
	scopes []string
}

var keyRoutes = []keyRoute{
	{http.MethodPost, regexp.MustCompile(`^/api/v1/inbox$`), nil},
	{http.MethodPost, regexp.MustCompile(`^` + regexp.QuoteMeta(mcpPath) + `$`), nil},
	{http.MethodGet, regexp.MustCompile(`^/api/v1/task-lists$`), []string{storage.ScopeTasksRead}},
	{http.MethodGet, regexp.MustCompile(`^/api/v1/tasks$`), []string{storage.ScopeTasksRead}},
	{http.MethodPatch, regexp.MustCompile(`^/api/v1/thoughts/[^/]+$`), []string{storage.ScopeTasksWrite}},
	{http.MethodDelete, regexp.MustCompile(`^/api/v1/thoughts/[^/]+$`), []string{storage.ScopeTasksWrite}},
	{http.MethodGet, regexp.MustCompile(`^/api/v1/lists$`), []string{storage.ScopeListsRead}},
	{http.MethodGet, regexp.MustCompile(`^/api/v1/lists/[^/]+$`), []string{storage.ScopeListsRead}},
	{http.MethodPost, regexp.MustCompile(`^/api/v1/lists/[^/]+/items$`), []string{storage.ScopeListsWrite, storage.ScopeList}},
	{http.MethodPatch, regexp.MustCompile(`^/api/v1/lists/[^/]+/items/[^/]+$`), []string{storage.ScopeListsWrite}},
	{http.MethodPut, regexp.MustCompile(`^/api/v1/lists/[^/]+/items/[^/]+$`), []string{storage.ScopeListsWrite}},
}

// apiKeyRouteDenied returns why an API key may not make this request, or "" if it may.
// /webhooks/ingest is not listed: it authenticates on its own and checks requireDeliveryScope.
func apiKeyRouteDenied(r *http.Request, scopes []string) string {
	for _, kr := range keyRoutes {
		if r.Method != kr.method || !kr.path.MatchString(r.URL.Path) {
			continue
		}
		if kr.scopes == nil || hasAnyScope(scopes, kr.scopes...) {
			return ""
		}
		return "Dem API-Schlüssel fehlt die Berechtigung für diese Aktion"
	}
	return "Mit einem API-Schlüssel nicht erreichbar (nur Aufgaben, Listen, Inbox und MCP; Notizen und Einstellungen brauchen eine Anmeldung)"
}

// requireDeliveryScope: delivering into the inbox, a task list or a list (POST /inbox,
// /webhooks/ingest) needs the matching right; sessions may do all. target: "inbox"/"triage", "task",
// "list_item"; notes ("document") cannot be created with a key.
func requireDeliveryScope(w http.ResponseWriter, r *http.Request, target string) bool {
	scopes, isKey := keyScopes(r.Context())
	if !isKey {
		return true
	}
	var ok bool
	switch target {
	case "task":
		ok = hasAnyScope(scopes, storage.ScopeTask, storage.ScopeTasksWrite)
	case "list_item":
		ok = hasAnyScope(scopes, storage.ScopeList, storage.ScopeListsWrite)
	case "document":
		ok = false
	default:
		ok = hasAnyScope(scopes, storage.ScopeTriage)
	}
	if !ok {
		writeError(w, http.StatusForbidden, "API-Key besitzt keine Berechtigung für diese Aktion")
	}
	return ok
}

// recordThoughtOrigin stores that an API key created or changed a task (nothing for the app itself)
// and puts the result on t, so the broadcast and the response carry it.
func (s *Server) recordThoughtOrigin(t *domain.Thought, actor *apiActor, created bool) {
	if actor == nil || t == nil {
		return
	}
	t.Origin = s.store.RecordOrigin(storage.OriginTableThoughts, t.ID, actor.Via, actor.KeyID, created)
}

// recordListItemOrigin is recordThoughtOrigin for list items.
func (s *Server) recordListItemOrigin(it *domain.ListItem, actor *apiActor, created bool) {
	if actor == nil || it == nil {
		return
	}
	it.Origin = s.store.RecordOrigin(storage.OriginTableListItems, it.ID, actor.Via, actor.KeyID, created)
}
