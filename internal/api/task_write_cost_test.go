package api

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// stmtCounter counts what the stores opened with newCountingTestServer send to SQLite: every statement,
// and the writes that each wait for the database's write lock on their own: execs outside a transaction
// plus the transactions begun (they take the lock at BEGIN, _txlock=immediate).
// TASK_COST_SQL=1 logs each statement of the measured requests.
var stmtCounter struct {
	all, locks atomic.Int64
	mu         sync.Mutex
	record     bool
	log        []string
}

func countStmt(q string, lock bool) {
	stmtCounter.all.Add(1)
	if lock {
		stmtCounter.locks.Add(1)
	}
	stmtCounter.mu.Lock()
	if stmtCounter.record {
		stmtCounter.log = append(stmtCounter.log, strings.Join(strings.Fields(q), " "))
	}
	stmtCounter.mu.Unlock()
}

var registerStmtCounter = sync.OnceFunc(func() {
	probe, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		panic(err)
	}
	sql.Register("sqlite-api-counting", stmtCountingDriver{probe.Driver()})
	_ = probe.Close()
})

type stmtCountingDriver struct{ driver.Driver }

type stmtFullConn interface {
	driver.Conn
	driver.ConnBeginTx
	driver.ConnPrepareContext
	driver.ExecerContext
	driver.QueryerContext
}

func (d stmtCountingDriver) Open(name string) (driver.Conn, error) {
	c, err := d.Driver.Open(name)
	if err != nil {
		return nil, err
	}
	return &stmtCountingConn{stmtFullConn: c.(stmtFullConn)}, nil
}

// stmtCountingConn: database/sql uses a connection from one goroutine at a time, so inTx needs no lock
type stmtCountingConn struct {
	stmtFullConn
	inTx bool
}

func (c *stmtCountingConn) ExecContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	countStmt(q, !c.inTx)
	return c.stmtFullConn.ExecContext(ctx, q, args)
}

func (c *stmtCountingConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	countStmt(q, false)
	return c.stmtFullConn.QueryContext(ctx, q, args)
}

func (c *stmtCountingConn) PrepareContext(ctx context.Context, q string) (driver.Stmt, error) {
	countStmt(q, false)
	return c.stmtFullConn.PrepareContext(ctx, q)
}

func (c *stmtCountingConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	countStmt("BEGIN", true)
	tx, err := c.stmtFullConn.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	c.inTx = true
	return stmtCountingTx{Tx: tx, c: c}, nil
}

type stmtCountingTx struct {
	driver.Tx
	c *stmtCountingConn
}

func (t stmtCountingTx) Commit() error {
	t.c.inTx = false
	return t.Tx.Commit()
}

func (t stmtCountingTx) Rollback() error {
	t.c.inTx = false
	return t.Tx.Rollback()
}

// taskWriteCost is what one request cost on average
type taskWriteCost struct {
	stmts, locks float64
	per          time.Duration
}

func (c taskWriteCost) String() string {
	return fmt.Sprintf("%.1f statements, %.1f writes waiting for the write lock, %v", c.stmts, c.locks, c.per)
}

// measureTaskWrites runs do n times and returns the average cost; the first run is logged statement by
// statement with TASK_COST_SQL=1.
func measureTaskWrites(t *testing.T, n int, do func(i int)) taskWriteCost {
	t.Helper()
	stmtCounter.mu.Lock()
	stmtCounter.record = os.Getenv("TASK_COST_SQL") != ""
	stmtCounter.log = nil
	stmtCounter.mu.Unlock()
	stmtCounter.all.Store(0)
	stmtCounter.locks.Store(0)
	start := time.Now()
	for i := range n {
		do(i)
		if i == 0 {
			stmtCounter.mu.Lock()
			for _, q := range stmtCounter.log {
				t.Logf("  %.160s", q)
			}
			stmtCounter.record = false
			stmtCounter.mu.Unlock()
		}
	}
	elapsed := time.Since(start)
	f := float64(n)
	return taskWriteCost{
		stmts: float64(stmtCounter.all.Load()) / f,
		locks: float64(stmtCounter.locks.Load()) / f,
		per:   elapsed / time.Duration(n),
	}
}

// newCountingTestServer is setupTestServer on a store whose statements are counted in stmtCounter.
func newCountingTestServer(t *testing.T) (*Server, *storage.Store, string, string) {
	t.Helper()
	registerStmtCounter()
	dbPath := filepath.Join(t.TempDir(), "count.db")
	store, err := storage.NewStoreWithDriver("sqlite-api-counting", dbPath, storage.WithSecretsKey(testSecretsKey))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	openSharing(t, store)
	user, err := store.EnsureDefaultUser()
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{Port: "8080", DatabasePath: dbPath, JWTSecret: testJWTSecret, SecretsKey: testSecretsKey}
	srv := NewServer(cfg, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	token, err := auth.GenerateToken(cfg.JWTSecret, user.ID, user.Email, user.DisplayName, user.TokenVersion, testSession(t, store, user.ID))
	if err != nil {
		t.Fatal(err)
	}
	return srv, store, token, user.ID
}

// TestTaskWriteCost: creating and completing a task costs a fixed number of statements and at most two
// writes that wait for the write lock, not a few statements and a write per member of its list (load
// test 2026-11-15: creating a task was by far the slowest request, before: 331 statements and 55 writes
// in a list shared with 50 people). Logs the cost per request; TASK_COST_SQL=1 logs every statement of
// the first one.
func TestTaskWriteCost(t *testing.T) {
	srv, store, token, ownerID := newCountingTestServer(t)
	router := srv.Router()

	const members = 50
	shared, err := store.CreateTaskList(ownerID, "", "", "Geteilt", "", "")
	if err != nil {
		t.Fatal(err)
	}
	var memberIDs []string
	for i := range members {
		u, _ := newTestUser(t, store, fmt.Sprintf("mitglied%d@example.com", i))
		memberIDs = append(memberIDs, u.ID)
		if _, err := store.AddTaskListShare(shared.ID, "user", u.ID, "editor", ownerID); err != nil {
			t.Fatal(err)
		}
	}
	personal, err := store.CreateTaskList(ownerID, "", "", "Privat", "", "")
	if err != nil {
		t.Fatal(err)
	}
	// Some tasks already there, as in a list in use
	for i := range 200 {
		th, err := store.CreateThoughtWithDetails(ownerID, fmt.Sprintf("Vorhanden %d", i), "", "", "", []string{shared.ID, personal.ID}[i%2], "todo", "")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.UpdateThoughtTriage(ownerID, th.ID, "keep", "task", "", "", ""); err != nil {
			t.Fatal(err)
		}
	}

	const n = 20
	create := func(listID string) (taskWriteCost, []string) {
		var ids []string
		cost := measureTaskWrites(t, n, func(i int) {
			var created struct {
				ID string `json:"id"`
			}
			rec := sendWith(t, router, http.MethodPost, "/api/v1/inbox", token,
				map[string]any{"content": fmt.Sprintf("Neue Aufgabe %d", i), "target": "task", "taskListId": listID})
			if rec.Code != http.StatusCreated {
				t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &created)
			ids = append(ids, created.ID)
		})
		return cost, ids
	}
	complete := func(ids []string) taskWriteCost {
		return measureTaskWrites(t, n, func(i int) {
			rec := sendWith(t, router, http.MethodPatch, "/api/v1/thoughts/"+ids[i], token, map[string]any{"isCompleted": true})
			if rec.Code != http.StatusOK {
				t.Fatalf("complete: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
	check := func(what string, c taskWriteCost) {
		t.Helper()
		t.Logf("%s: %v", what, c)
		if c.stmts > 80 || c.locks > 2 {
			t.Errorf("%s: %v, expected at most 80 statements and 2 writes", what, c)
		}
	}

	sharedCreate, sharedIDs := create(shared.ID)
	check(fmt.Sprintf("create in a list shared with %d people", members), sharedCreate)
	check(fmt.Sprintf("complete in a list shared with %d people", members), complete(sharedIDs))
	personalCreate, personalIDs := create(personal.ID)
	check("create in a personal list", personalCreate)
	check("complete in a personal list", complete(personalIDs))
	inboxCreate, _ := create("")
	check("create without a list", inboxCreate)

	// What the requests did is unchanged: the creator is assigned in the shared list only, and every
	// member has an entry for each task added and each completed
	if th, _ := store.GetThoughtByID(ownerID, sharedIDs[0]); th == nil || len(th.Assignees) != 1 || th.Assignees[0] != ownerID {
		t.Errorf("task in the shared list: assignees %v, want the creator", th)
	}
	if th, _ := store.GetThoughtByID(ownerID, personalIDs[0]); th == nil || len(th.Assignees) != 0 || !th.IsCompleted {
		t.Errorf("task in the personal list: %+v, want completed without assignees", th)
	}
	entries, unread, err := store.CenterEntries(memberIDs[members-1], 100)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, e := range entries {
		kinds[e.Kind]++
	}
	if unread != 2*n || kinds["taskCreated"] != n || kinds["taskDone"] != n {
		t.Errorf("center of a member: %d unread, kinds %v, want %d added and %d completed", unread, kinds, n, n)
	}
	if entries, _, _ := store.CenterEntries(ownerID, 100); len(entries) != 0 {
		t.Errorf("the creator has %d center entries for their own changes", len(entries))
	}
}
