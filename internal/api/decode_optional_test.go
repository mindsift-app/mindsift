package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeOptionalJSON(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, body string
		ok         bool
		want       string
	}{
		{"empty", "", true, "kept"},
		{"null", "null", true, "kept"},
		{"object", `{"name":"neu"}`, true, "neu"},
		{"broken", `{"name":`, false, "kept"},
		{"not json", "name=neu", false, "kept"},
		{"wrong type", `{"name":5}`, false, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := struct {
				Name string `json:"name"`
			}{Name: "kept"}
			rec := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(c.body))
			if got := decodeOptionalJSON(rec, r, &req); got != c.ok {
				t.Fatalf("decodeOptionalJSON(%q) = %v, want %v", c.body, got, c.ok)
			}
			if !c.ok && rec.Code != http.StatusBadRequest {
				t.Fatalf("status %d for %q, want 400", rec.Code, c.body)
			}
			if c.want != "" && req.Name != c.want {
				t.Fatalf("name %q for %q, want %q", req.Name, c.body, c.want)
			}
		})
	}

	// Over the limit is a broken body too
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"`+strings.Repeat("x", 100)+`"}`))
	var req struct {
		Name string `json:"name"`
	}
	if decodeOptionalJSONLimit(rec, r, 32, &req) || rec.Code != http.StatusBadRequest {
		t.Fatalf("body over the limit: status %d, want 400", rec.Code)
	}
}

// An endpoint whose body may be left out takes an empty body and refuses a broken one
func TestOptionalBodyEndpointRefusesBrokenJSON(t *testing.T) {
	t.Parallel()
	srv, _, token := setupTestServer(t)
	router := srv.Router()
	for _, c := range []struct {
		body string
		want int
	}{{"", http.StatusOK}, {`{"taskListId":""}`, http.StatusOK}, {`{"taskListId":`, http.StatusBadRequest}} {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/clear-done", strings.NewReader(c.body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, r)
		if rec.Code != c.want {
			t.Fatalf("clear-done with %q: status %d, want %d (%s)", c.body, rec.Code, c.want, rec.Body.String())
		}
	}
}
