package shell

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func fastChecks(t *testing.T, first time.Duration) {
	t.Helper()
	total, f, pause := checkTotal, checkFirst, checkPause
	checkTotal, checkFirst, checkPause = 2*time.Second, first, 10*time.Millisecond
	t.Cleanup(func() { checkTotal, checkFirst, checkPause = total, f, pause })
}

func TestCheckServerRetriesAfterSlowFirstTry(t *testing.T) {
	fastChecks(t, 100*time.Millisecond)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			time.Sleep(300 * time.Millisecond) // longer than the first try
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	if err := CheckServer(context.Background(), srv.URL+"/"); err != nil {
		t.Fatalf("second try should succeed: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want 2", calls.Load())
	}
}

func TestCheckServerKeepsErrors(t *testing.T) {
	fastChecks(t, 100*time.Millisecond)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	err := CheckServer(context.Background(), srv.URL+"/")
	if p, ok := err.(*Problem); !ok || p.Code != "notMindSift" || p.Detail != "404" {
		t.Fatalf("err = %v, want notMindSift: 404", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("a wrong answer must not be retried, calls = %d", calls.Load())
	}
	srv.Close()
	err = CheckServer(context.Background(), srv.URL+"/")
	if p, ok := err.(*Problem); !ok || p.Code != "serverUnreachable" || p.Detail == "" {
		t.Fatalf("err = %v, want serverUnreachable with detail", err)
	}
}
