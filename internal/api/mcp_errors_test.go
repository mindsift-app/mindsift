package api

import (
	"fmt"
	"strings"
	"testing"
)

// An error text is translated once: a name filled into it stays as sent, even when it is a German text of
// the catalog ("Ungültiges JSON" came back as "Invalid JSON" when writeRPC translated the finished text).
func TestMCPErrorTextTranslatedOnce(t *testing.T) {
	t.Parallel()
	srv, _, token := setupTestServer(t)
	router := srv.Router()
	message := func(body string) string {
		t.Helper()
		_, res := rpc(t, router, token, body)
		rpcErr, ok := res["error"].(map[string]any)
		if !ok {
			t.Fatalf("no error in %v", res)
		}
		return fmt.Sprint(rpcErr["message"])
	}
	if msg := message(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"Ungültiges JSON"}}`); msg != "Unknown tool: Ungültiges JSON" {
		t.Fatalf("unknown tool: %q", msg)
	}
	if msg := message(`{"jsonrpc":"2.0","id":2,"method":"Ungültiges JSON"}`); !strings.HasSuffix(msg, ": Ungültiges JSON") || strings.Contains(msg, "nicht") {
		t.Fatalf("unknown method: %q", msg)
	}
	// Texts without placeholders are still translated
	if msg := message(`{"jsonrpc":"2.0","id":3,"method":"tools/call"}`); msg == "" || strings.Contains(msg, "fehlt") {
		t.Fatalf("missing name should be in English: %q", msg)
	}
}
