package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// Each hub keeps its own origin rule: two servers in one process (the API tests run many in parallel)
// neither share nor race on it.
func TestOriginCheckBelongsToTheHub(t *testing.T) {
	strict, open := NewHub(), NewHub()
	defer strict.Close()
	defer open.Close()
	strict.SetOriginCheck(func(r *http.Request) bool { return r.Header.Get("Origin") == "https://ok.example" })

	dial := func(hub *Hub, origin string) error {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			hub.ServeWS(w, r, "", "u1")
		}))
		defer ts.Close()
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http"), http.Header{"Origin": {origin}})
		if err == nil {
			conn.Close()
		}
		return err
	}
	if err := dial(strict, "https://evil.example"); err == nil {
		t.Error("the strict hub accepted a foreign origin")
	}
	if err := dial(strict, "https://ok.example"); err != nil {
		t.Errorf("the strict hub refused its own origin: %v", err)
	}
	// a hub without a rule accepts every origin, whatever another hub installed
	if err := dial(open, "https://evil.example"); err != nil {
		t.Errorf("the hub without a rule refused an origin: %v", err)
	}
}
