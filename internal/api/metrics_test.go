package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testMetricsToken = "metrics-token-for-tests"

func metricsGet(router http.Handler, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", "/metrics", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestMetricsOffWithoutToken(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	if rec := metricsGet(srv.Router(), testMetricsToken); rec.Code != http.StatusNotFound {
		t.Fatalf("without METRICS_TOKEN /metrics must stay unknown: %d", rec.Code)
	}
}

func TestMetricsNeedTheToken(t *testing.T) {
	srv, _, token := setupTestServer(t)
	srv.cfg.MetricsToken = testMetricsToken
	router := srv.Router()

	for _, wrong := range []string{"", "falsch-falsch-falsch-falsch"} {
		if rec := metricsGet(router, wrong); rec.Code != http.StatusUnauthorized {
			t.Fatalf("token %q: %d", wrong, rec.Code)
		}
	}

	// A request of the app shows up under its route pattern, never with its id
	req := httptest.NewRequest("GET", "/api/v1/documents/doc_gibt_es_nicht", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(httptest.NewRecorder(), req)
	srv.metrics.mailSent(nil)
	srv.metrics.mailSent(errors.New("smtp"))
	srv.metrics.backupRun(nil, time.Unix(1794500000, 0))

	rec := metricsGet(router, testMetricsToken)
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain; version=0.0.4") {
		t.Fatalf("metrics: %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	body := rec.Body.String()
	for _, want := range []string{
		`mindsift_http_requests_total{method="GET",route="/api/v1/documents/{id}",status="404"} 1`,
		`mindsift_http_request_duration_seconds_count{method="GET",route="/api/v1/documents/{id}"} 1`,
		`mindsift_mails_total{result="failed"} 1`,
		`mindsift_mails_total{result="sent"} 1`,
		`mindsift_backup_runs_total{result="ok"} 1`,
		`mindsift_last_backup_success_time_seconds 1.7945e+09`,
		"# TYPE mindsift_users gauge",
		"mindsift_db_open_connections ",
		`mindsift_db_file_bytes{file="database"} `,
		"go_goroutines ",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q in\n%s", want, body)
		}
	}
	if strings.Contains(body, "doc_gibt_es_nicht") {
		t.Fatal("an id reached a label")
	}
}

func TestHealthWithDatabase(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	call := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/health?db=1", nil))
		return rec
	}
	if rec := call(); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"database":"ok"`) {
		t.Fatalf("health with database: %d %s", rec.Code, rec.Body.String())
	}
	_ = store.Close()
	if rec := call(); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("health with the database gone: %d %s", rec.Code, rec.Body.String())
	}
}

// Made-up methods share one label value: otherwise every request with a new one would add series for good
func TestMetricsMadeUpMethodsShareALabel(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	srv.cfg.MetricsToken = testMetricsToken
	router := srv.Router()

	for _, method := range []string{"FOO1", "FOO2", strings.Repeat("X", 500)} {
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, "/api/v1/auth/me", nil))
	}
	body := metricsGet(router, testMetricsToken).Body.String()
	if strings.Contains(body, "FOO1") || strings.Contains(body, "XXXX") {
		t.Fatalf("a made-up method reached a label:\n%s", body)
	}
	if !strings.Contains(body, `mindsift_http_requests_total{method="other",`) {
		t.Fatalf("made-up methods should count as other:\n%s", body)
	}
	if methodLabel(http.MethodPatch) != "PATCH" {
		t.Fatal("standard methods keep their name")
	}
}
