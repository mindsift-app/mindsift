package api

import (
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

const openAPIFile = "../../Doku/api/openapi.json"

// routerRoutes lists every route of the server as "METHOD /path"; a trailing wildcard becomes {path}
// (OpenAPI has no wildcards). The app's own pages ("/*") are not part of the API.
func routerRoutes(t *testing.T) map[string]bool {
	t.Helper()
	srv, _, _ := setupTestServer(t)
	routes, ok := srv.Router().(chi.Routes)
	if !ok {
		t.Fatal("the router does not list its routes")
	}
	out := map[string]bool{}
	err := chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if route == "/*" {
			return nil
		}
		route = strings.TrimSuffix(route, "/*") + map[bool]string{true: "/{path}", false: ""}[strings.HasSuffix(route, "/*")]
		out[method+" "+route] = true
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	return out
}

// The route list in Doku/api/openapi.json and the router agree: no route without an entry and no entry
// without a route, each with a short description.
func TestOpenAPIListsEveryRoute(t *testing.T) {
	raw, err := os.ReadFile(openAPIFile)
	if err != nil {
		t.Fatalf("read %s: %v", openAPIFile, err)
	}
	var spec struct {
		OpenAPI string                                         `json:"openapi"`
		Paths   map[string]map[string]struct{ Summary string } `json:"paths"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("%s is not valid JSON: %v", openAPIFile, err)
	}
	if !strings.HasPrefix(spec.OpenAPI, "3.") {
		t.Errorf("openapi version: %q", spec.OpenAPI)
	}
	documented := map[string]bool{}
	for path, methods := range spec.Paths {
		for method, op := range methods {
			key := strings.ToUpper(method) + " " + path
			documented[key] = true
			if strings.TrimSpace(op.Summary) == "" {
				t.Errorf("%s has no summary", key)
			}
		}
	}
	served := routerRoutes(t)
	var missing, stale []string
	for r := range served {
		if !documented[r] {
			missing = append(missing, r)
		}
	}
	for r := range documented {
		if !served[r] {
			stale = append(stale, r)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)
	if len(missing) > 0 {
		t.Errorf("routes missing in %s:\n%s", openAPIFile, strings.Join(missing, "\n"))
	}
	if len(stale) > 0 {
		t.Errorf("entries in %s without a route:\n%s", openAPIFile, strings.Join(stale, "\n"))
	}
}
