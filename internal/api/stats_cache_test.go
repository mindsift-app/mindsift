package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// fakeClock for the cache: tests move it by hand
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (f *fakeClock) now() time.Time { f.mu.Lock(); defer f.mu.Unlock(); return f.t }
func (f *fakeClock) add(d time.Duration) {
	f.mu.Lock()
	f.t = f.t.Add(d)
	f.mu.Unlock()
}

func newTestStatsCache() (*statsCache, *fakeClock) {
	clk := &fakeClock{t: time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)}
	c := newStatsCache()
	c.now = clk.now
	return c, clk
}

func countingCompute(n *atomic.Int32) func() (*domain.DashboardStats, error) {
	return func() (*domain.DashboardStats, error) {
		v := n.Add(1)
		return &domain.DashboardStats{InboxCount: int(v)}, nil
	}
}

func TestStatsCacheAnswersFromMemoryWithinTTL(t *testing.T) {
	c, clk := newTestStatsCache()
	var n atomic.Int32
	for i := 0; i < 5; i++ {
		st, _ := c.get("u1", countingCompute(&n))
		if st.InboxCount != 1 {
			t.Fatalf("request %d: want the first computation, got %d", i, st.InboxCount)
		}
	}
	// Another user has own counters
	if st, _ := c.get("u2", countingCompute(&n)); st.InboxCount != 2 {
		t.Fatalf("u2: want its own computation, got %d", st.InboxCount)
	}
	clk.add(statsCacheTTL)
	if st, _ := c.get("u1", countingCompute(&n)); st.InboxCount != 3 {
		t.Fatalf("after the TTL: want a new computation, got %d", st.InboxCount)
	}
}

func TestStatsCacheInvalidateDropsTheUserOnly(t *testing.T) {
	c, _ := newTestStatsCache()
	var n atomic.Int32
	c.get("u1", countingCompute(&n))
	c.get("u2", countingCompute(&n))
	c.invalidate("u1")
	if st, _ := c.get("u1", countingCompute(&n)); st.InboxCount != 3 {
		t.Fatalf("u1 after invalidate: want a new computation, got %d", st.InboxCount)
	}
	if st, _ := c.get("u2", countingCompute(&n)); st.InboxCount != 2 {
		t.Fatalf("u2: want the cached value, got %d", st.InboxCount)
	}
}

// A change that lands while the counters are being computed: that result may predate the change and
// must not be stored.
func TestStatsCacheDoesNotStoreAComputationOverlappingAChange(t *testing.T) {
	c, _ := newTestStatsCache()
	var n atomic.Int32
	c.get("u1", countingCompute(&n))
	c.invalidate("u1")
	c.get("u1", func() (*domain.DashboardStats, error) {
		c.invalidate("u1") // the write commits during the computation
		return &domain.DashboardStats{InboxCount: 99}, nil
	})
	if st, _ := c.get("u1", countingCompute(&n)); st.InboxCount == 99 {
		t.Fatal("a computation that overlapped a change was stored")
	}
}

func TestStatsCacheBurstComputesOnce(t *testing.T) {
	c, _ := newTestStatsCache()
	var n atomic.Int32
	release := make(chan struct{})
	slow := func() (*domain.DashboardStats, error) {
		<-release
		return countingCompute(&n)()
	}
	var wg sync.WaitGroup
	results := make([]int, 20)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			st, _ := c.get("u1", slow)
			results[i] = st.InboxCount
		}(i)
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	if got := n.Load(); got != 1 {
		t.Fatalf("want one computation for the burst, got %d", got)
	}
	for i, r := range results {
		if r != 1 {
			t.Fatalf("request %d got %d", i, r)
		}
	}
}

func TestStatsCacheKeepsTheMapSmall(t *testing.T) {
	c, clk := newTestStatsCache()
	var n atomic.Int32
	for i := 0; i < statsCacheMaxUsers+10; i++ {
		c.get("u"+strings.Repeat("x", i%7)+string(rune('a'+i%26))+time.Duration(i).String(), countingCompute(&n))
	}
	clk.add(statsCacheTTL)
	c.get("last", countingCompute(&n))
	if len(c.entries) > statsCacheMaxUsers {
		t.Fatalf("entries that ran out stay: %d", len(c.entries))
	}
}

func getStats(t *testing.T, srv *Server, token string) domain.DashboardStats {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /stats: %d %s", rec.Code, rec.Body.String())
	}
	var st domain.DashboardStats
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	return st
}

// The acting user sees the own change at once, other changes reach the counters with the realtime event
func TestStatsCacheThroughTheAPI(t *testing.T) {
	srv, store, token := setupTestServer(t)
	claims, err := auth.ValidateToken("test-jwt-secret-key", token)
	if err != nil {
		t.Fatal(err)
	}
	userID := claims.UserID
	before := getStats(t, srv, token)

	// Own change through the API: the next GET /stats includes it
	req := httptest.NewRequest(http.MethodPost, "/api/v1/inbox", strings.NewReader(`{"content":"Milch kaufen"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)
	if rec.Code >= 300 {
		t.Fatalf("POST /inbox: %d %s", rec.Code, rec.Body.String())
	}
	if got := getStats(t, srv, token).InboxCount; got != before.InboxCount+1 {
		t.Fatalf("own change: want inbox %d, got %d", before.InboxCount+1, got)
	}

	// A change that bypasses this user's requests (another person, a background job) stays cached...
	if _, err := store.CreateThought(userID, "Brot", "", "", ""); err != nil {
		t.Fatal(err)
	}
	cached := getStats(t, srv, token).InboxCount
	if cached != before.InboxCount+1 {
		t.Fatalf("want the cached count %d, got %d", before.InboxCount+1, cached)
	}
	// ...an event that cannot change counters keeps it...
	srv.wsHub.BroadcastToUser(userID, "DOC_SEQ", nil)
	if got := getStats(t, srv, token).InboxCount; got != cached {
		t.Fatalf("DOC_SEQ dropped the cache: got %d", got)
	}
	// ...and the realtime event about the change drops it
	srv.wsHub.BroadcastToUser(userID, "TASK_CREATED", nil)
	if got := getStats(t, srv, token).InboxCount; got != before.InboxCount+2 {
		t.Fatalf("after the event: want inbox %d, got %d", before.InboxCount+2, got)
	}
}

// While changes keep coming, a request never waits behind a computation that started before the last
// change: it computes in parallel. (Before, requests queued one computation after the other and timed out
// under load, all of one person's tabs waiting in line.)
func TestStatsCacheDoesNotQueueBehindAnOutdatedComputation(t *testing.T) {
	c, _ := newTestStatsCache()
	release := make(chan struct{})
	started := make(chan struct{}, 4)
	var n atomic.Int32
	slow := func() (*domain.DashboardStats, error) {
		v := n.Add(1)
		started <- struct{}{}
		<-release
		return &domain.DashboardStats{InboxCount: int(v)}, nil
	}

	firstDone := make(chan struct{})
	go func() { _, _ = c.get("u1", slow); close(firstDone) }()
	<-started

	// A change after the first computation started: the next request must not join it
	c.invalidate("u1")
	secondDone := make(chan *domain.DashboardStats, 1)
	go func() { st, _ := c.get("u1", slow); secondDone <- st }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("the request after a change waited for the computation that started before it")
	}

	// A third request after no further change joins the second computation instead of starting another
	thirdDone := make(chan *domain.DashboardStats, 1)
	go func() { st, _ := c.get("u1", slow); thirdDone <- st }()
	time.Sleep(50 * time.Millisecond)
	if got := n.Load(); got != 2 {
		t.Fatalf("computations = %d, want 2 (the third request joins the second)", got)
	}
	close(release)
	<-firstDone
	second, third := <-secondDone, <-thirdDone
	if second.InboxCount != 2 || third.InboxCount != 2 {
		t.Fatalf("second and third got %d and %d, want both the second computation's 2", second.InboxCount, third.InboxCount)
	}
}
