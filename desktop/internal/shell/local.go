package shell

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/mindsift-app/mindsift/internal/api"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// Local runs the MindSift server of one instance at a time inside this process. Opening another instance
// closes the running one first (requests still running end, then the hub, the background jobs and the
// database), so there is never more than one database open.
type Local struct {
	// Static: the built frontend the server serves; Desktop: platform, origin and system user for
	// config.ApplyDesktop; Version: the app's version
	Static  fs.FS
	Desktop config.Desktop
	Version string
	// Notify shows an alarm of the instance with the given id as a system notification (notify.go); nil:
	// the instances get none (their channel "desktop" is off)
	Notify func(instanceID string, n api.DesktopNotification) error

	envOnce sync.Once
	mu      sync.Mutex
	cur     *running
}

type running struct {
	id, dir string
	handler http.Handler
	cancel  context.CancelFunc
	shut    func()
	lock    *instanceLock
	// api: the listener for local programs while the setting is on (localapi.go), guarded by Local.mu
	api     *http.Server
	apiPort int

	mu      sync.Mutex
	closing bool
	active  sync.WaitGroup
}

// closeWait: how long closing waits for requests still running (long polls and event streams end at once,
// their context is cancelled first)
const closeWait = 10 * time.Second

// Current: the id of the open instance, empty when none is open
func (l *Local) Current() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cur == nil {
		return ""
	}
	return l.cur.id
}

// Open opens the instance in dir (created when missing) under the entry id, closing another one first.
// The same instance again stays open as it is. ErrLocked: another process has it open.
func (l *Local) Open(id, dir string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cur != nil && l.cur.id == id && samePath(l.cur.dir, dir) {
		return nil
	}
	if l.cur != nil {
		l.cur.close()
		l.cur = nil
	}
	r, err := l.start(id, dir)
	if err != nil {
		return err
	}
	l.cur = r
	return nil
}

// Close closes the open instance, if any.
func (l *Local) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cur != nil {
		l.cur.close()
		l.cur = nil
	}
}

// ServeHTTP hands the request to the open instance; false when none is open (or it is closing).
func (l *Local) ServeHTTP(w http.ResponseWriter, r *http.Request) bool {
	l.mu.Lock()
	cur := l.cur
	l.mu.Unlock()
	if cur == nil || !cur.enter() {
		return false
	}
	defer cur.active.Done()
	cur.handler.ServeHTTP(w, r)
	return true
}

func (r *running) enter() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closing {
		return false
	}
	r.active.Add(1)
	return true
}

func (r *running) close() {
	r.mu.Lock()
	r.closing = true
	r.mu.Unlock()
	r.cancel()
	r.stopLocalAPI()
	done := make(chan struct{})
	go func() {
		r.active.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(closeWait):
		slog.Warn("Requests of the local server still running at close", "data", r.dir)
	}
	r.shut()
	r.lock.release()
	slog.Info("Local MindSift server closed", "data", r.dir)
}

// processEnv sets what holds for every instance of this process, once: the server's time zone (the
// system's until the administration sets one) and its default language (the system's, when MindSift
// speaks it).
func (l *Local) processEnv() {
	l.envOnce.Do(func() {
		if os.Getenv("TZ") == "" {
			if zone := SystemTimeZone(); zone != "" {
				_ = os.Setenv("TZ", zone)
			}
		}
		_, _ = clock.Apply("")
		if os.Getenv("DEFAULT_LANGUAGE") == "" {
			if lang := SystemLanguage(); i18n.Valid(lang) {
				_ = os.Setenv("DEFAULT_LANGUAGE", lang)
			}
		}
	})
}

func (l *Local) start(id, dir string) (*running, error) {
	if err := CreateFolder(dir); err != nil {
		return nil, problem("folderFailed", err)
	}
	lock, err := lockInstance(dir)
	if errors.Is(err, ErrLocked) {
		return nil, problem("locked")
	}
	if err != nil {
		return nil, problem("folderFailed", err)
	}
	l.processEnv()
	_ = os.Setenv("DATA_DIR", dir)
	cfg := config.Load()
	cfg.AppVersion = l.Version
	cfg.ApplyDesktop(l.Desktop)
	// A restore the administration staged (api/fullrestore.go) is swapped in here, before the store opens
	store, restoreErr, err := storage.OpenStoreWithRestore(cfg.DatabasePath, storage.WithSecretsKey(cfg.SecretsKey), storage.WithDefaultInstanceName(cfg.InstanceName))
	if err != nil {
		lock.release()
		return nil, problem("openFailed", err)
	}
	if restoreErr != nil {
		slog.Error("Restoring the backup failed; the instance opens with the data from before", "data", dir, "error", restoreErr)
	}
	store.ConfiguredLanguage = cfg.DefaultLanguage
	hub := ws.NewHub()
	srv := api.NewServer(cfg, store, hub, l.Static)
	if notify := l.Notify; notify != nil {
		// Before the window asks for the status (capability desktopNotify) and the first alarm run
		srv.SetDesktopNotifier(api.DesktopNotifierFunc(func(n api.DesktopNotification) error { return notify(id, n) }))
	}
	srv.SetRestarter(func() { l.reopen(id, dir) })
	srv.ApplyTimeZone()
	srv.CheckSecretsKey()
	ctx, cancel := context.WithCancel(context.Background())
	router := srv.Router()
	r := &running{id: id, dir: dir, cancel: cancel, lock: lock}
	r.handler = http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		// The webview's requests carry no peer address; the server's rate limits and logs expect one
		if req.RemoteAddr == "" {
			req.RemoteAddr = "127.0.0.1:0"
		}
		router.ServeHTTP(w, req.WithContext(mergeDone(req.Context(), ctx)))
	})
	r.shut = func() {
		hub.Close()
		srv.Close()
		if err := store.Close(); err != nil {
			slog.Warn("Closing the database failed", "data", dir, "error", err)
		}
	}
	slog.Info("Local MindSift server ready", "data", dir)
	return r, nil
}

// reopen closes the open instance id and opens it again, after the administration staged a restore of a
// backup (the store swaps it in when it opens). Its listener for local programs comes back on its port.
func (l *Local) reopen(id, dir string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cur == nil || l.cur.id != id {
		return
	}
	port := l.cur.apiPort
	l.cur.close()
	l.cur = nil
	r, err := l.start(id, dir)
	if err != nil {
		slog.Error("Reopening the instance after a restore failed", "data", dir, "error", err)
		return
	}
	l.cur = r
	if port > 0 {
		if err := r.listenLocalAPI(port); err != nil {
			slog.Warn("Making the instance reachable for local programs failed after a restore", "port", port, "error", err)
		}
	}
	slog.Info("Instance reopened after a restore", "data", dir)
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
