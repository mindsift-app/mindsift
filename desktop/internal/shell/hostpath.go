package shell

import (
	"path"
	"strings"
)

// Under Flatpak a folder or file chosen in the system's dialog comes back as a path of the document portal,
// /run/user/1000/doc/<id>/<name>/…: the app may read and write there (the portal's FUSE file system lies in
// its sandbox), but the path means nothing to the person, who chose ~/Backups. HostPath gives the path on
// the host for showing it; what the app stores and uses stays the portal's path, the host's is not
// reachable from the sandbox. hostpath_linux.go asks the portal (org.freedesktop.portal.Documents,
// GetHostPaths, version 5 and later); everywhere else, and whenever the portal cannot tell, the path stays
// as it is.

// splitDocPath: the document id of a path in the document portal and what follows the document itself
// ("" for the document, "/sub/file" below a folder). ok is false for any other path.
// /run/user/<uid>/doc/<id>/<name>[/rest], also below by-app/<app id>/ and the sandbox's /run/flatpak/doc.
func splitDocPath(p string) (id, rest string, ok bool) {
	if p == "" || !strings.HasPrefix(p, "/") {
		return "", "", false
	}
	clean := path.Clean(p)
	var tail string
	switch {
	case strings.HasPrefix(clean, "/run/flatpak/doc/"):
		tail = strings.TrimPrefix(clean, "/run/flatpak/doc/")
	case strings.HasPrefix(clean, "/run/user/"):
		uid, after, found := strings.Cut(strings.TrimPrefix(clean, "/run/user/"), "/")
		if !found || uid == "" || strings.Trim(uid, "0123456789") != "" || !strings.HasPrefix(after, "doc/") {
			return "", "", false
		}
		tail = strings.TrimPrefix(after, "doc/")
	default:
		return "", "", false
	}
	parts := strings.Split(tail, "/")
	if len(parts) > 0 && parts[0] == "by-app" {
		if len(parts) < 3 {
			return "", "", false
		}
		parts = parts[2:]
	}
	// The id and the document's own name; the root of a document (<id>/) is no document
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	rest = ""
	if len(parts) > 2 {
		rest = "/" + strings.Join(parts[2:], "/")
	}
	return parts[0], rest, true
}

// joinHostPath: the host's path of the document (as the portal answers it, possibly with a trailing NUL)
// and what follows it in the portal's path
func joinHostPath(host []byte, rest string) string {
	h := strings.TrimRight(string(host), "\x00")
	if h == "" || !strings.HasPrefix(h, "/") {
		return ""
	}
	return h + rest
}
