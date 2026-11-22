//go:build linux

package shell

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

// hostPaths: the portal's answers so far, by document id (a document's host path does not change while it
// is exported)
var (
	hostPathsMu sync.Mutex
	hostPaths   = map[string]string{}
)

// HostPath: the path p as the person knows it, for showing; under Flatpak a path of the document portal
// becomes the host's (see hostpath.go), any other path stays as it is.
func HostPath(p string) string {
	id, rest, ok := splitDocPath(p)
	if !ok {
		return p
	}
	hostPathsMu.Lock()
	host, known := hostPaths[id]
	hostPathsMu.Unlock()
	if !known {
		host = askHostPath(id)
		if host == "" {
			return p
		}
		hostPathsMu.Lock()
		hostPaths[id] = host
		hostPathsMu.Unlock()
	}
	return host + rest
}

// askHostPath: the host's path of a document from org.freedesktop.portal.Documents.GetHostPaths (portal
// version 5 and later; older ones answer with an error); "" when it cannot tell
func askHostPath(id string) string {
	conn, err := dbus.SessionBus()
	if err != nil {
		slog.Debug("Desktop: no session bus for the document portal", "error", err)
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var paths map[string][]byte
	obj := conn.Object("org.freedesktop.portal.Documents", "/org/freedesktop/portal/documents")
	if err := obj.CallWithContext(ctx, "org.freedesktop.portal.Documents.GetHostPaths", 0, []string{id}).Store(&paths); err != nil {
		slog.Debug("Desktop: the document portal gave no host path", "error", err)
		return ""
	}
	return joinHostPath(paths[id], "")
}
