package api

import (
	"crypto/subtle"
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/metrics"
)

// apiMetrics: what /metrics reports (Prometheus text format, internal/metrics). Only with METRICS_TOKEN;
// without it the path answers 404 like any other unknown one. No label carries a person, an id or an
// address: routes are chi's patterns ("/api/v1/documents/{id}"), the rest are fixed words.
type apiMetrics struct {
	reg      metrics.Registry
	requests *metrics.CounterVec
	duration *metrics.HistogramVec
	mails    *metrics.CounterVec
	backups  *metrics.CounterVec
	// Unix seconds of the last backup run without errors (0 = none since the start)
	lastBackup atomic.Int64
}

func newAPIMetrics(s *Server) *apiMetrics {
	m := &apiMetrics{}
	m.requests = m.reg.Counter(metrics.NewCounterVec("mindsift_http_requests_total",
		"API requests answered, by method, route pattern and status code.", "method", "route", "status"))
	m.duration = m.reg.Histogram(metrics.NewHistogramVec("mindsift_http_request_duration_seconds",
		"Time to answer an API request, by method and route pattern.", metrics.DurationBuckets, "method", "route"))
	m.mails = m.reg.Counter(metrics.NewCounterVec("mindsift_mails_total",
		"Mails handed to the mail server, by result (sent, failed).", "result"))
	m.backups = m.reg.Counter(metrics.NewCounterVec("mindsift_backup_runs_total",
		"Backup runs (daily or \"Back up now\"), by result (ok, failed).", "result"))

	started := time.Now()
	version := s.appVersion()
	gauge := func(name, help string, value func() float64) {
		m.reg.Read(metrics.Read{Name: name, Help: help, Type: "gauge", Samples: func() []metrics.Sample {
			return []metrics.Sample{{Value: value()}}
		}})
	}
	m.reg.Read(metrics.Read{Name: "mindsift_build_info", Help: "Always 1; the version of the running build.", Type: "gauge",
		Labels: []string{"version", "goversion"}, Samples: func() []metrics.Sample {
			return []metrics.Sample{{Labels: []string{version, runtime.Version()}, Value: 1}}
		}})
	gauge("mindsift_start_time_seconds", "When the server started, in Unix seconds.", func() float64 { return float64(started.Unix()) })
	gauge("mindsift_last_backup_success_time_seconds", "End of the last backup run without errors since the start, in Unix seconds (0 = none).",
		func() float64 { return float64(m.lastBackup.Load()) })

	// Accounts: all of them, and those with a session used in the last day
	gauge("mindsift_users", "Accounts on this server.", func() float64 {
		n, err := s.store.CountUsers()
		if err != nil {
			return -1
		}
		return float64(n)
	})
	gauge("mindsift_active_users", "Accounts with a session used in the last 24 hours.", func() float64 {
		return float64(s.store.ActiveUserCount(time.Now().Add(-24 * time.Hour)))
	})

	// Database: the connection pool and the size of its files
	gauge("mindsift_db_open_connections", "Open connections to the database.", func() float64 { return float64(s.store.DBStats().OpenConnections) })
	gauge("mindsift_db_in_use_connections", "Database connections in use.", func() float64 { return float64(s.store.DBStats().InUse) })
	m.reg.Read(metrics.Read{Name: "mindsift_db_wait_count_total", Help: "Times a request waited for a free database connection.", Type: "counter",
		Samples: func() []metrics.Sample { return []metrics.Sample{{Value: float64(s.store.DBStats().WaitCount)}} }})
	m.reg.Read(metrics.Read{Name: "mindsift_db_wait_seconds_total", Help: "Time spent waiting for a free database connection.", Type: "counter",
		Samples: func() []metrics.Sample { return []metrics.Sample{{Value: s.store.DBStats().WaitDuration.Seconds()}} }})
	m.reg.Read(metrics.Read{Name: "mindsift_db_file_bytes", Help: "Size of the database files (database, write-ahead log).", Type: "gauge",
		Labels: []string{"file"}, Samples: func() []metrics.Sample {
			var out []metrics.Sample
			for _, f := range []struct{ name, path string }{{"database", s.cfg.DatabasePath}, {"wal", s.cfg.DatabasePath + "-wal"}} {
				if info, err := os.Stat(f.path); err == nil {
					out = append(out, metrics.Sample{Labels: []string{f.name}, Value: float64(info.Size())})
				}
			}
			return out
		}})

	// Go runtime
	gauge("go_goroutines", "Goroutines that currently exist.", func() float64 { return float64(runtime.NumGoroutine()) })
	m.reg.Read(metrics.Read{Name: "go_memstats", Help: "Memory of the Go runtime in bytes (heap in use, obtained from the system).", Type: "gauge",
		Labels: []string{"kind"}, Samples: func() []metrics.Sample {
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			return []metrics.Sample{
				{Labels: []string{"heap_alloc"}, Value: float64(ms.HeapAlloc)},
				{Labels: []string{"sys"}, Value: float64(ms.Sys)},
			}
		}})
	m.reg.Read(metrics.Read{Name: "go_gc_cycles_total", Help: "Completed garbage collection cycles.", Type: "counter",
		Samples: func() []metrics.Sample {
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			return []metrics.Sample{{Value: float64(ms.NumGC)}}
		}})
	return m
}

// observeRequest counts an API request under the route pattern chi matched ("unmatched" otherwise).
func (m *apiMetrics) observeRequest(r *http.Request, status int, d time.Duration) {
	if m == nil {
		return
	}
	route := "unmatched"
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if p := rc.RoutePattern(); p != "" {
			route = p
		}
	}
	method := methodLabel(r.Method)
	m.requests.Inc(method, route, strconv.Itoa(status))
	m.duration.Observe(d.Seconds(), method, route)
}

// methodLabel: the request method as a metrics label. Anything but the standard methods counts as "other":
// the method is whatever the client sends, and every new label value would add series that are never
// dropped (anyone could grow the server's memory without signing in).
func methodLabel(method string) string {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch,
		http.MethodDelete, http.MethodOptions, http.MethodConnect, http.MethodTrace:
		return method
	}
	return "other"
}

func (m *apiMetrics) mailSent(err error) {
	if m == nil {
		return
	}
	if err != nil {
		m.mails.Inc("failed")
	} else {
		m.mails.Inc("sent")
	}
}

func (m *apiMetrics) backupRun(err error, at time.Time) {
	if m == nil {
		return
	}
	if err != nil {
		m.backups.Inc("failed")
		return
	}
	m.backups.Inc("ok")
	m.lastBackup.Store(at.Unix())
}

// handleMetrics: GET /metrics with "Authorization: Bearer <METRICS_TOKEN>". Registered only when the token
// is set; a missing or wrong token answers 401.
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || subtle.ConstantTimeCompare([]byte(strings.TrimSpace(got)), []byte(s.cfg.MetricsToken)) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="metrics"`)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", metrics.ContentType)
	w.Header().Set("Cache-Control", "no-store")
	s.metrics.reg.Write(w)
}

// appVersion: the version of the built frontend (version.json), "" in development builds without it.
func (s *Server) appVersion() string {
	if s.staticFS == nil {
		return ""
	}
	data, err := fs.ReadFile(s.staticFS, "version.json")
	if err != nil {
		return ""
	}
	var v struct {
		Version string `json:"version"`
	}
	_ = json.Unmarshal(data, &v)
	return v.Version
}
