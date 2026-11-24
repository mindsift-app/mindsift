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
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
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
	// A plain BEGIN is deferred and takes no lock (storage.readConsistent reads with one), nor does its
	// ROLLBACK
	countStmt(q, !c.inTx && q != "BEGIN" && q != "ROLLBACK")
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
	// The background jobs stop before anything is measured: their passes (the alarm ticker every minute,
	// the note counts a while after a sync) would add their statements to whichever request happens to
	// run then, and under the race detector the tests take long enough to meet them. The measured
	// requests start no background job of their own.
	srv.Close()
	token, err := auth.GenerateToken(cfg.JWTSecret, user.ID, user.Email, user.DisplayName, user.TokenVersion, testSession(t, store, user.ID))
	if err != nil {
		t.Fatal(err)
	}
	return srv, store, token, user.ID
}

// TestTaskWriteCost: creating, completing and deleting a task costs a fixed number of statements and one write
// that waits for the write lock (the notifications go into the transaction of the change), not a few
// statements and a write per member of its list (load test 2026-11-15: creating a task was by far the
// slowest request, before: 331 statements and 55 writes in a list shared with 50 people; then 67 to 73
// statements and two writes; now 14 to 15 statements and one write, 8 to 9 in a personal list). Logs the
// cost per request; TASK_COST_SQL=1 logs every statement of the first one.
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
	check := func(what string, c taskWriteCost, maxStmts float64) {
		t.Helper()
		t.Logf("%s: %v", what, c)
		if c.stmts > maxStmts || c.locks > 1 {
			t.Errorf("%s: %v, expected at most %.0f statements and 1 write", what, c, maxStmts)
		}
	}

	sharedCreate, sharedIDs := create(shared.ID)
	check(fmt.Sprintf("create in a list shared with %d people", members), sharedCreate, 16)
	check(fmt.Sprintf("complete in a list shared with %d people", members), complete(sharedIDs), 16)
	personalCreate, personalIDs := create(personal.ID)
	check("create in a personal list", personalCreate, 10)
	check("complete in a personal list", complete(personalIDs), 10)
	inboxCreate, _ := create("")
	check("create without a list", inboxCreate, 6)

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

	// Deleting moves the task to the trash, forgets its watchers and stores what they are told in one
	// write (before: three, the trash, the notifications and the watchers each on their own)
	remove := func(ids []string) taskWriteCost {
		return measureTaskWrites(t, n, func(i int) {
			rec := sendWith(t, router, http.MethodDelete, "/api/v1/thoughts/"+ids[i], token, nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
	// A member watches the shared tasks, so deleting them notifies someone
	for _, id := range sharedIDs {
		if err := store.WatchTask(id, memberIDs[0], true); err != nil {
			t.Fatal(err)
		}
	}
	check(fmt.Sprintf("delete in a list shared with %d people", members), remove(sharedIDs), 22)
	check("delete in a personal list", remove(personalIDs), 15)
	if trash, _ := store.GetTaskTrash(ownerID, shared.ID); len(trash) != n {
		t.Errorf("task trash of the shared list: %d entries, want %d", len(trash), n)
	}
	if w := store.TaskWatchers(sharedIDs[0]); len(w) != 0 {
		t.Errorf("a deleted task still has watchers %v", w)
	}
	watcherEntries, _, err := store.CenterEntries(memberIDs[0], 200)
	if err != nil {
		t.Fatal(err)
	}
	watched := 0
	for _, e := range watcherEntries {
		if e.Kind == "watched" {
			watched++
		}
	}
	if watched != n {
		t.Errorf("center of the watcher: %d entries about watched tasks, want %d about the deleted ones", watched, n)
	}
}

// TestNoteTodoWriteCost: ticking a to-do in a note that is linked to a task changes the note, the task
// and tells the task's people. The task and its notifications go into one transaction
// (ReconcileDocTaskLinksNotify), so a tick waits twice for the write lock: once for the note, once for
// the task (before: three times, the notifications on their own; and 473 statements with 20 linked
// to-dos, as every task read the subtasks of all the others; now 33). Note and task each in a transaction
// of their own is deliberate: the note's change is applied under its lock inside its transaction, and
// the task's notifications are planned from the state the change produced, before a transaction begins.
func TestNoteTodoWriteCost(t *testing.T) {
	srv, store, token, ownerID := newCountingTestServer(t)
	router := srv.Router()

	const members, n = 50, 20
	list, err := store.CreateTaskList(ownerID, "", "", "Geteilt", "", "")
	if err != nil {
		t.Fatal(err)
	}
	blocks := make([]domain.DocumentBlock, n)
	for i := range blocks {
		blocks[i] = domain.DocumentBlock{ID: fmt.Sprintf("todo%d", i), Type: "todo", Content: fmt.Sprintf("Punkt %d", i)}
	}
	doc, err := store.CreateDocument(ownerID, "", "Gemeinsame Notiz", "", "", blocks, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	var memberIDs []string
	for i := range members {
		u, _ := newTestUser(t, store, fmt.Sprintf("leser%d@example.com", i))
		memberIDs = append(memberIDs, u.ID)
		if _, err := store.AddTaskListShare(list.ID, "user", u.ID, "editor", ownerID); err != nil {
			t.Fatal(err)
		}
		if _, err := store.CreateDocShare(ownerID, doc.ID, u.ID, "write"); err != nil {
			t.Fatal(err)
		}
	}
	var taskIDs []string
	for i := range n {
		th, err := store.CreateTaskFromDocBlock(ownerID, doc.ID, blocks[i].ID, blocks[i].Content, false)
		if err != nil {
			t.Fatal(err)
		}
		listID := list.ID
		if _, _, err := store.UpdateTask(ownerID, th, storage.ThoughtPatch{TaskListID: &listID}, nil); err != nil {
			t.Fatal(err)
		}
		taskIDs = append(taskIDs, th.ID)
	}

	sync := func(i int, op collab.Op) {
		rec := sendWith(t, router, http.MethodPost, "/api/v1/docs/"+doc.ID+"/sync", token,
			map[string]any{"clientId": "tab", "lastSeq": 0, "skipLog": true, "ops": []collab.Op{op}})
		if rec.Code != http.StatusOK {
			t.Fatalf("sync %d: %d %s", i, rec.Code, rec.Body.String())
		}
	}
	yes := true
	tick := measureTaskWrites(t, n, func(i int) {
		sync(i, collab.Op{OpID: fmt.Sprintf("tick%d", i), Kind: collab.OpSetProps, BlockID: blocks[i].ID, Patch: &collab.PropsPatch{Checked: &yes}})
	})
	t.Logf("tick a linked to-do in a note shared with %d people: %v", members, tick)
	if tick.locks > 2 || tick.stmts > 36 {
		t.Errorf("tick: %v, expected at most 36 statements and 2 writes", tick)
	}
	snap, err := store.GetDocSnapshot(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	version := map[string]int{}
	for _, b := range snap.Blocks {
		version[b.ID] = b.Version
	}
	retitle := measureTaskWrites(t, n, func(i int) {
		text := fmt.Sprintf("Punkt %d geändert", i)
		sync(i, collab.Op{OpID: fmt.Sprintf("text%d", i), Kind: collab.OpSetContent, BlockID: blocks[i].ID, BaseVersion: version[blocks[i].ID], Content: &text})
	})
	t.Logf("retitle a linked to-do in a note shared with %d people: %v", members, retitle)
	if retitle.locks > 2 || retitle.stmts > 36 {
		t.Errorf("retitle: %v, expected at most 36 statements and 2 writes", retitle)
	}

	// The tasks followed the note, and every member heard each one completed
	if th, _ := store.GetThoughtByID(ownerID, taskIDs[0]); th == nil || !th.IsCompleted || th.Content != "Punkt 0 geändert" {
		t.Errorf("linked task: %+v, want completed and retitled", th)
	}
	entries, _, err := store.CenterEntries(memberIDs[members-1], 100)
	if err != nil {
		t.Fatal(err)
	}
	done := 0
	for _, e := range entries {
		if e.Kind == "taskDone" {
			done++
		}
	}
	if done != n {
		t.Errorf("center of a member: %d completed, want %d", done, n)
	}
}
