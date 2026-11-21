package shell

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/mindsift-app/mindsift/internal/api"
)

// "Make reachable for local programs": the open instance also listens on 127.0.0.1 (IPv4 loopback only,
// never a wildcard address), for an AI agent's MCP client or a script on this computer. Behind it is the
// instance's own router, restricted to what API keys may call (api.LocalAPIOnly); the setting is stored per
// instance in desktop.json (Entry.LocalAPI), with a port of its own so an agent's configuration always
// reaches the same instance. The listener lives and dies with the running instance.

// LocalAPI: the setting of one local instance
type LocalAPI struct {
	Enabled bool `json:"enabled"`
	// Port: chosen when the setting is first switched on (DefaultLocalAPIPort or the next one free), kept
	// while it is off again
	Port int `json:"port,omitempty"`
}

// DefaultLocalAPIPort: the first port tried for an instance's listener
const DefaultLocalAPIPort = 18890

// localAPIPortRange: how many ports after DefaultLocalAPIPort are tried when none is set yet
const localAPIPortRange = 100

// minLocalAPIPort: ports below need special rights on most systems
const minLocalAPIPort = 1024

// localAPIState: what the settings show (POST /__desktop/api/local-api)
type localAPIState struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port,omitempty"`
	// Listening: the listener is up (false while off, or when its port could not be taken: Problem)
	Listening bool     `json:"listening"`
	Problem   *Problem `json:"problem,omitempty"`
}

// listenLocalAPI starts the running instance's listener on 127.0.0.1:port, replacing one on another port.
// problem "portInUse": another program has the port.
func (r *running) listenLocalAPI(port int) error {
	if r.api != nil && r.apiPort == port {
		return nil
	}
	r.stopLocalAPI()
	ln, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		if errors.Is(err, errAddrInUse) {
			return problem("portInUse", port)
		}
		return problem("listenFailed", err)
	}
	srv := &http.Server{
		Handler:           api.LocalAPIOnly(http.HandlerFunc(r.serveLocalAPI)),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Warn("Listener for local programs stopped", "port", port, "error", err)
		}
	}()
	r.api, r.apiPort = srv, port
	slog.Info("Instance reachable for local programs", "address", ln.Addr().String(), "data", r.dir)
	return nil
}

// serveLocalAPI: a request of a local program, counted like the window's so closing waits for it
func (r *running) serveLocalAPI(w http.ResponseWriter, req *http.Request) {
	if !r.enter() {
		http.Error(w, "instance closing", http.StatusServiceUnavailable)
		return
	}
	defer r.active.Done()
	r.handler.ServeHTTP(w, req)
}

// stopLocalAPI closes the listener, letting requests still running finish (a few seconds at most)
func (r *running) stopLocalAPI() {
	if r.api == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := r.api.Shutdown(ctx); err != nil {
		_ = r.api.Close()
	}
	slog.Info("Instance no longer reachable for local programs", "port", r.apiPort, "data", r.dir)
	r.api, r.apiPort = nil, 0
}

// ServeLocalAPI switches the listener of the open instance id: on at port (> 0), off with 0. An instance
// that is not open has no listener to switch (it gets one when it opens, Shell.openLocal).
func (l *Local) ServeLocalAPI(id string, port int) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cur == nil || l.cur.id != id {
		return problem("notOpen")
	}
	if port <= 0 {
		l.cur.stopLocalAPI()
		return nil
	}
	return l.cur.listenLocalAPI(port)
}

// LocalAPIPort: the port the open instance id listens on for local programs, 0 when none
func (l *Local) LocalAPIPort(id string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cur == nil || l.cur.id != id || l.cur.api == nil {
		return 0
	}
	return l.cur.apiPort
}

// applyLocalAPI starts the listener of a local entry that was just opened, when its setting is on. A port
// taken by another program does not keep the instance from opening; the settings show the problem.
func (s *Shell) applyLocalAPI(e Entry) {
	port := 0
	if e.LocalAPI != nil && e.LocalAPI.Enabled {
		port = e.LocalAPI.Port
	}
	err := s.Local.ServeLocalAPI(e.ID, port)
	s.mu.Lock()
	s.localAPIProblem = nil
	if err != nil {
		slog.Warn("Making the instance reachable for local programs failed", "port", port, "error", err)
		s.localAPIProblem = asProblem(err)
	}
	s.mu.Unlock()
}

// localAPIState: the setting of the open local instance and whether its listener is up
func (s *Shell) localAPIState() (localAPIState, error) {
	e, ok := s.Settings.Get(s.Local.Current())
	if !ok {
		return localAPIState{}, problem("notOpen")
	}
	var st localAPIState
	if e.LocalAPI != nil {
		st.Enabled, st.Port = e.LocalAPI.Enabled, e.LocalAPI.Port
	}
	st.Listening = s.Local.LocalAPIPort(e.ID) != 0
	s.mu.Lock()
	if st.Enabled && !st.Listening {
		st.Problem = s.localAPIProblem
	}
	s.mu.Unlock()
	return st, nil
}

// setLocalAPI switches the open instance's setting and its listener. port 0 keeps the instance's port, or,
// switching on for the first time, takes the first of DefaultLocalAPIPort and the ports after it that no
// other instance uses and no other program holds. A port taken by another program is refused and the
// setting stays as it was.
func (s *Shell) setLocalAPI(enabled bool, port int) (localAPIState, error) {
	id := s.Local.Current()
	e, ok := s.Settings.Get(id)
	if !ok {
		return localAPIState{}, problem("notOpen")
	}
	if port != 0 && (port < minLocalAPIPort || port > 65535) {
		return localAPIState{}, problem("portInvalid")
	}
	if port == 0 && e.LocalAPI != nil {
		port = e.LocalAPI.Port
	}
	if !enabled {
		_ = s.Local.ServeLocalAPI(id, 0)
	} else if port != 0 {
		if err := s.Local.ServeLocalAPI(id, port); err != nil {
			return localAPIState{}, err
		}
	} else {
		var err error
		if port, err = s.firstFreeLocalAPIPort(id); err != nil {
			return localAPIState{}, err
		}
	}
	if err := s.Settings.SetLocalAPI(id, LocalAPI{Enabled: enabled, Port: port}); err != nil {
		return localAPIState{}, problem("failed", err)
	}
	s.mu.Lock()
	s.localAPIProblem = nil
	s.mu.Unlock()
	return s.localAPIState()
}

// firstFreeLocalAPIPort starts the listener on the first port no other instance has and no program holds
func (s *Shell) firstFreeLocalAPIPort(id string) (int, error) {
	used := s.Settings.LocalAPIPorts(id)
	for p := DefaultLocalAPIPort; p < DefaultLocalAPIPort+localAPIPortRange; p++ {
		if used[p] {
			continue
		}
		err := s.Local.ServeLocalAPI(id, p)
		if err == nil {
			return p, nil
		}
		var pr *Problem
		if !errors.As(err, &pr) || pr.Code != "portInUse" {
			return 0, err
		}
	}
	return 0, problem("portInUse", DefaultLocalAPIPort, "–", DefaultLocalAPIPort+localAPIPortRange-1)
}
