package shell

import (
	"strings"

	"github.com/mindsift-app/mindsift/internal/config"
)

// DevToolsEnv switches the webview's developer tools (right click → Inspect) on in any build.
const DevToolsEnv = "MINDSIFT_DESKTOP_DEVTOOLS"

// DevToolsEnabled: the developer tools only in builds of a branch (version v1.2.3-dev, or none with go run)
// or when DevToolsEnv is on (a yes/no value like the server's variables: 1, true, yes, on). In a release
// they stay off: they would let anyone at the window run code in whatever page it shows, the window's own
// pages with the instance's session included.
func DevToolsEnabled(version string) bool {
	if config.EnvBool(DevToolsEnv, false) {
		return true
	}
	return version == "" || strings.HasSuffix(version, "-dev")
}
