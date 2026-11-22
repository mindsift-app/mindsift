package shell

import (
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// freePort: a loopback port nothing listens on right now
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()
	return ln.Addr().(*net.TCPAddr).Port
}

func localGet(port int, path string) (int, error) {
	c := http.Client{Timeout: 5 * time.Second}
	res, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d%s", port, path))
	if err != nil {
		return 0, err
	}
	_ = res.Body.Close()
	return res.StatusCode, nil
}

func problemCode(out map[string]any) string {
	e, _ := out["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

// The setting for local programs: off by default, switched on it listens on 127.0.0.1 only, with the
// instance's router restricted to API keys; it is stored per instance, follows the instance when it closes
// and opens again, and a port another program holds is refused with a clear code.
func TestLocalAPIListener(t *testing.T) {
	t.Setenv("DB_MAX_CONNS", "1")
	sh := newTestShell(t)
	if _, out := call(t, sh, "local-api", map[string]any{}); problemCode(out) != "notOpen" {
		t.Fatalf("no instance open: %v", out)
	}
	_, out := call(t, sh, "create", map[string]any{"name": "Arbeit"})
	first := out["id"].(string)
	if _, st := call(t, sh, "local-api", map[string]any{}); st["enabled"] != false || st["listening"] != false {
		t.Fatalf("default: %v", st)
	}

	// On without a port: the first free one from DefaultLocalAPIPort on
	_, st := call(t, sh, "local-api-set", map[string]any{"enabled": true})
	port := int(st["port"].(float64))
	if st["enabled"] != true || st["listening"] != true || port < DefaultLocalAPIPort || port >= DefaultLocalAPIPort+localAPIPortRange {
		t.Fatalf("switched on: %v", st)
	}
	if e, _ := sh.Settings.Get(first); e.LocalAPI == nil || !e.LocalAPI.Enabled || e.LocalAPI.Port != port {
		t.Fatalf("stored: %+v", e.LocalAPI)
	}
	// The instance's router behind the API-key guard: MCP asks for a key, the app is not there
	if code, err := localGet(port, "/api/v1/tasks"); err != nil || code != http.StatusUnauthorized {
		t.Fatalf("tasks without key: %d %v", code, err)
	}
	if code, err := localGet(port, "/"); err != nil || code != http.StatusNotFound {
		t.Fatalf("app: %d %v", code, err)
	}
	// A second instance gets a port of its own; opening it closes the first one's listener
	call(t, sh, "create", map[string]any{"name": "Privat"})
	if _, err := localGet(port, "/api/v1/tasks"); err == nil {
		t.Fatal("the first instance's listener should be closed with it")
	}
	_, st = call(t, sh, "local-api-set", map[string]any{"enabled": true})
	if p := int(st["port"].(float64)); p == port || st["listening"] != true {
		t.Fatalf("second instance: %v (first has %d)", st, port)
	}

	// A port another program holds: refused, the setting stays as it was
	busy, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = busy.Close() }()
	busyPort := busy.Addr().(*net.TCPAddr).Port
	if _, out = call(t, sh, "local-api-set", map[string]any{"enabled": true, "port": busyPort}); problemCode(out) != "portInUse" {
		t.Fatalf("busy port: %v", out)
	}
	if _, out = call(t, sh, "local-api-set", map[string]any{"enabled": true, "port": 80}); problemCode(out) != "portInvalid" {
		t.Fatalf("port 80: %v", out)
	}
	// Off: the port stays stored, nothing listens
	_, st = call(t, sh, "local-api-set", map[string]any{"enabled": false})
	secondPort := int(st["port"].(float64))
	if st["enabled"] != false || st["listening"] != false || secondPort == 0 {
		t.Fatalf("off: %v", st)
	}
	if _, err := localGet(secondPort, "/api/v1/tasks"); err == nil {
		t.Fatal("still listening after switching off")
	}

	// Back to the first: its listener comes back on its port
	if _, out = call(t, sh, "open", map[string]any{"id": first}); out["id"] != first {
		t.Fatalf("open: %v", out)
	}
	if code, err := localGet(port, "/api/v1/tasks"); err != nil || code != http.StatusUnauthorized {
		t.Fatalf("first instance again: %d %v", code, err)
	}
	// Its port taken by another program meanwhile: the instance still opens, the settings tell why
	sh.Local.Close()
	holder, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatal(err)
	}
	if _, out = call(t, sh, "open", map[string]any{"id": first}); out["id"] != first {
		t.Fatalf("open with the port taken: %v", out)
	}
	_, st = call(t, sh, "local-api", map[string]any{})
	if st["enabled"] != true || st["listening"] != false || !strings.Contains(fmt.Sprint(st["problem"]), "portInUse") {
		t.Fatalf("port taken at opening: %v", st)
	}
	_ = holder.Close()
	// Switching on again takes it
	if _, st = call(t, sh, "local-api-set", map[string]any{"enabled": true}); st["listening"] != true || int(st["port"].(float64)) != port {
		t.Fatalf("again: %v", st)
	}
	sh.Local.Close()
	if _, err := localGet(port, "/api/v1/tasks"); err == nil {
		t.Fatal("closing the instance should close its listener")
	}
}

// An explicitly chosen port
func TestLocalAPIChosenPort(t *testing.T) {
	t.Setenv("DB_MAX_CONNS", "1")
	sh := newTestShell(t)
	call(t, sh, "create", map[string]any{"name": "Arbeit"})
	p := freePort(t)
	_, st := call(t, sh, "local-api-set", map[string]any{"enabled": true, "port": p})
	if st["listening"] != true || int(st["port"].(float64)) != p {
		t.Fatalf("chosen port: %v", st)
	}
	if code, err := localGet(p, "/api/v1/mcp"); err != nil || code != http.StatusUnauthorized {
		t.Fatalf("mcp without key: %d %v", code, err)
	}
}
