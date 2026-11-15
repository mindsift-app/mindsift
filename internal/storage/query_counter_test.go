package storage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

// queryCount counts the statements every store opened with newCountingStore sends to SQLite (queries,
// execs and prepares, including those inside transactions).
var queryCount atomic.Int64

var registerCountingDriver = sync.OnceFunc(func() {
	probe, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		panic(err)
	}
	sql.Register("sqlite-counting", countingDriver{probe.Driver()})
	_ = probe.Close()
})

// newCountingStore is a store on a file in a temp directory whose statements are counted in queryCount.
func newCountingStore(t testing.TB) *Store {
	t.Helper()
	registerCountingDriver()
	store, err := newStore("sqlite-counting", filepath.Join(t.TempDir(), "count.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

type countingDriver struct{ driver.Driver }

type fullConn interface {
	driver.Conn
	driver.ConnBeginTx
	driver.ConnPrepareContext
	driver.ExecerContext
	driver.QueryerContext
}

func (d countingDriver) Open(name string) (driver.Conn, error) {
	c, err := d.Driver.Open(name)
	if err != nil {
		return nil, err
	}
	return countingConn{c.(fullConn)}, nil
}

type countingConn struct{ fullConn }

func (c countingConn) ExecContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	queryCount.Add(1)
	return c.fullConn.ExecContext(ctx, q, args)
}

func (c countingConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	queryCount.Add(1)
	return c.fullConn.QueryContext(ctx, q, args)
}

func (c countingConn) PrepareContext(ctx context.Context, q string) (driver.Stmt, error) {
	queryCount.Add(1)
	return c.fullConn.PrepareContext(ctx, q)
}
