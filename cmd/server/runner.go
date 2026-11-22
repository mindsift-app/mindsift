package main

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/mindsift-app/mindsift/internal/api"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// runner serves the instance of the data folder and opens it again after the administration restored a
// backup (api/fullrestore.go): requests still running end (long polls and streams at once), then the hub,
// the background jobs and the database close, storage.OpenStoreWithRestore swaps the restored files in, and
// a new server takes over on the same port. Meanwhile requests get 503, which the app waits out.
type runner struct {
	cfg    *config.Config
	static fs.FS

	mu  sync.Mutex
	cur *instance
	// reopening: one reopen at a time
	reopening sync.Mutex
}

type instance struct {
	store   *storage.Store
	srv     *api.Server
	hub     *ws.Hub
	handler http.Handler
	ctx     context.Context
	cancel  context.CancelFunc

	mu      sync.Mutex
	closing bool
	active  sync.WaitGroup
}

// reopenWait: how long a restore waits for requests still running before it closes the store anyway
const reopenWait = 15 * time.Second

// open opens the store (swapping in a pending restore) and builds the server. first: the process start,
// where a broken ADMIN_USER stops the start.
func (rn *runner) open(first bool) (*instance, error) {
	cfg := rn.cfg
	storeOpts := []storage.StoreOption{storage.WithSecretsKey(cfg.SecretsKey), storage.WithDefaultInstanceName(cfg.InstanceName)}
	if cfg.DemoMode {
		storeOpts = append(storeOpts, storage.WithDemoMode())
	}
	store, restoreErr, err := storage.OpenStoreWithRestore(cfg.DatabasePath, storeOpts...)
	if err != nil {
		return nil, err
	}
	if restoreErr != nil {
		slog.Error("Restoring the backup failed; MindSift runs with the data from before", "error", restoreErr)
	}
	store.ConfiguredLanguage = cfg.DefaultLanguage
	if v, err := store.SQLiteVersion(); err == nil {
		slog.Info("Database opened", "sqlite", v)
	}

	if cfg.DemoMode {
		slog.Info("Demo mode: resetting the database and setting up the demo accounts...")
		_ = os.RemoveAll(filepath.Join(filepath.Dir(cfg.DatabasePath), "media")) // uploads of the last run
		if err := store.ResetAndSeedDemo(); err != nil {
			slog.Warn("Setting up demo mode failed", "error", err)
		} else {
			slog.Info("Demo accounts ready: admin / admin (admin role) and user / user (member role)")
		}
	}

	// Seed SMTP defaults from environment variables into DB if not yet configured in DB
	store.SeedSMTPDefaultsFromEnv(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPFrom, cfg.SMTPFromName, cfg.SMTPTLS, cfg.SMTPSkipVerify)

	hub := ws.NewHub()
	srv := api.NewServer(cfg, store, hub, rn.static)
	srv.SetRestarter(rn.reopen)
	srv.ApplyTimeZone()
	srv.CheckSecretsKey()
	// ADMIN_USER / ADMIN_PASSWORD: the first admin exists before anyone can reach the setup wizard. Set
	// but unusable, the server does not start: it would wait for the first visitor to become admin.
	if err := srv.CreateInitialAdmin(); err != nil {
		if first {
			slog.Error("Creating the first administrator from ADMIN_USER / ADMIN_PASSWORD failed; fix or remove the variables. MindSift does not start, so the setup is not left open", "error", err)
			os.Exit(1)
		}
		slog.Warn("Creating the first administrator from ADMIN_USER / ADMIN_PASSWORD failed", "error", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &instance{store: store, srv: srv, hub: hub, handler: srv.Router(), ctx: ctx, cancel: cancel}, nil
}

func (rn *runner) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rn.mu.Lock()
	cur := rn.cur
	rn.mu.Unlock()
	if cur == nil || !cur.enter() {
		w.Header().Set("Retry-After", "5")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"MindSift is reopening its data, please wait"}`))
		return
	}
	defer cur.active.Done()
	cur.handler.ServeHTTP(w, r.WithContext(mergeDone(r.Context(), cur.ctx)))
}

// reopen closes the running instance and opens it again (the restore staged by the API is swapped in).
// The process ends when the data folder no longer opens at all.
func (rn *runner) reopen() {
	rn.reopening.Lock()
	defer rn.reopening.Unlock()
	rn.mu.Lock()
	cur := rn.cur
	rn.mu.Unlock()
	if cur != nil {
		cur.close(reopenWait) // from here on requests get 503
	}
	next, err := rn.open(false)
	if err != nil {
		slog.Error("Reopening the data after a restore failed; MindSift stops", "error", err)
		os.Exit(1)
	}
	rn.mu.Lock()
	rn.cur = next
	rn.mu.Unlock()
	slog.Info("MindSift reopened its data")
}

func (in *instance) enter() bool {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.closing {
		return false
	}
	in.active.Add(1)
	return true
}

// close ends the instance: no new requests, running ones cancelled and waited for (up to wait), then the
// hub, the background jobs and the store.
func (in *instance) close(wait time.Duration) {
	in.mu.Lock()
	in.closing = true
	in.mu.Unlock()
	in.cancel()
	in.hub.Close()
	if wait > 0 {
		done := make(chan struct{})
		go func() {
			in.active.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(wait):
			slog.Warn("Requests still running while the data closes")
		}
	}
	in.srv.Close()
	if err := in.store.Close(); err != nil {
		slog.Warn("Closing the database failed", "error", err)
	}
}

// mergeDone: the request's context, also cancelled when the instance closes (long polls and streams end)
func mergeDone(req, app context.Context) context.Context {
	ctx, cancel := context.WithCancel(req)
	stop := context.AfterFunc(app, cancel)
	go func() {
		<-ctx.Done()
		stop()
	}()
	return ctx
}
