package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
)

func TestResolveClientIP(t *testing.T) {
	h := func(kv ...string) http.Header {
		out := http.Header{}
		for i := 0; i < len(kv); i += 2 {
			out.Set(kv[i], kv[i+1])
		}
		return out
	}
	private := parseProxyTrust("private")
	cases := []struct {
		name  string
		trust proxyTrust
		peer  string
		hdr   http.Header
		want  string
		noHdr bool
	}{
		{"proxy in docker network passes the visitor", private, "172.18.0.2", h("X-Forwarded-For", "203.0.113.7"), "203.0.113.7", false},
		{"spoofed left part of the chain is ignored", private, "172.18.0.2", h("X-Forwarded-For", "1.2.3.4, 203.0.113.7, 10.0.0.5"), "203.0.113.7", false},
		{"X-Real-IP from a trusted proxy", private, "127.0.0.1", h("X-Real-IP", "198.51.100.9"), "198.51.100.9", false},
		{"direct visitor cannot fake an address", private, "203.0.113.50", h("X-Forwarded-For", "1.2.3.4"), "203.0.113.50", false},
		{"proxy without header is flagged", private, "172.18.0.2", h(), "172.18.0.2", true},
		{"all: headers always believed", parseProxyTrust("all"), "203.0.113.50", h("X-Forwarded-For", "1.2.3.4, 5.6.7.8"), "1.2.3.4", false},
		{"none: headers never believed", parseProxyTrust("none"), "172.18.0.2", h("X-Forwarded-For", "1.2.3.4"), "172.18.0.2", false},
		{"external proxy by CIDR", parseProxyTrust("private,198.51.100.0/24"), "198.51.100.1", h("CF-Connecting-IP", "203.0.113.8"), "203.0.113.8", false},
	}
	for _, c := range cases {
		got := c.trust.resolveClientIP(c.peer, c.hdr)
		if got.ip != c.want || got.viaProxyWithoutHeader != c.noHdr {
			t.Errorf("%s: got %+v, want %s (noHeader=%v)", c.name, got, c.want, c.noHdr)
		}
	}
}

func TestLoginGuardBuckets(t *testing.T) {
	g := newLoginGuard(true)
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	g.now = func() time.Time { return now }
	attacker := clientIPInfo{ip: "203.0.113.66"}
	owner := clientIPInfo{ip: "198.51.100.10"}

	for i := 0; i < loginLimitAccountIP; i++ {
		g.recordFailure("usr_admin", attacker)
	}
	if g.lockedFor("usr_admin", attacker) != loginLockWindow {
		t.Fatalf("3 failures from one address must lock that address out of the account")
	}
	if g.lockedFor("usr_admin", owner) != 0 {
		t.Fatalf("the owner logging in from elsewhere must not be locked out")
	}

	// Spread over many addresses: the account itself locks at 20
	for i := 0; i < loginLimitAccount; i++ {
		g.recordFailure("usr_admin", clientIPInfo{ip: "192.0.2." + string(rune('0'+i%10)) + string(rune('0'+i/10))})
	}
	if g.lockedFor("usr_admin", owner) == 0 {
		t.Fatalf("20 failures across addresses must lock the account")
	}
	g.unlockAccount("usr_admin")
	if g.lockedFor("usr_admin", owner) != 0 || g.lockedFor("usr_admin", attacker) != 0 {
		t.Fatalf("unlockAccount must lift account and account+IP locks")
	}

	// The lock ends by itself
	for i := 0; i < loginLimitAccountIP; i++ {
		g.recordFailure("usr_ben", attacker)
	}
	now = now.Add(loginLockWindow + time.Second)
	if g.lockedFor("usr_ben", attacker) != 0 {
		t.Fatalf("lock must expire after the window")
	}

	// Without a known client IP only the account bucket counts
	proxied := clientIPInfo{ip: "172.18.0.2", viaProxyWithoutHeader: true}
	for i := 0; i < 10; i++ {
		g.recordFailure("usr_carla", proxied)
	}
	if g.lockedFor("usr_carla", proxied) != 0 {
		t.Fatalf("per-IP limits must not apply when the proxy hides the client IP")
	}

	off := newLoginGuard(false)
	for i := 0; i < 50; i++ {
		off.recordFailure("usr_admin", attacker)
	}
	if off.lockedFor("usr_admin", attacker) != 0 {
		t.Fatalf("LOGIN_PROTECTION=false must never lock")
	}
}

func TestLoginLockedAfterThreeFailures(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	_, _ = store.CreateUser("lock@example.com", mustHash(t, "richtig123"), "Lock", "member")
	login := func(pw, from string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"login":"lock@example.com","password":"`+pw+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = from + ":4711"
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	for i := 0; i < 3; i++ {
		if rec := login("falsch", "203.0.113.66"); rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: want 401, got %d", i+1, rec.Code)
		}
	}
	rec := login("richtig123", "203.0.113.66")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" || !strings.Contains(rec.Body.String(), "15 Minuten") {
		t.Fatalf("locked login: want 429 with Retry-After, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := login("richtig123", "198.51.100.10"); rec.Code != http.StatusOK {
		t.Fatalf("owner from another address must still log in, got %d", rec.Code)
	}
}

func mustHash(t *testing.T, pw string) string {
	t.Helper()
	h, err := auth.HashPassword(pw)
	if err != nil {
		t.Fatal(err)
	}
	return h
}
