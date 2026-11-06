package api

import (
	"net/http"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestInviteCodeRedeemedOnlyOnce(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	inv, err := store.CreateUserInvite("", "", nil, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^INV-[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$`).MatchString(inv.Code) {
		t.Fatalf("unexpected invite code format %q", inv.Code)
	}

	// Two registrations race for the same code: exactly one account
	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := `{"email":"race` + string(rune('a'+i)) + `@example.com","password":"password123","inviteCode":"` + strings.ToLower(inv.Code) + `"}`
			codes[i] = sessionCall(router, "POST", "/api/v1/auth/register", "", body, "").Code
		}(i)
	}
	wg.Wait()
	created := 0
	for _, c := range codes {
		if c == http.StatusCreated {
			created++
		}
	}
	if created != 1 {
		t.Fatalf("want exactly one account, got codes %v", codes)
	}
}

func TestInviteReleasedWhenAccountFails(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	inv, _ := store.CreateUserInvite("", "", nil, 7, 1)
	_, _ = store.CreateUser("taken@example.com", "hash", "Taken", "member")
	body := func(email string) string {
		return `{"email":"` + email + `","password":"password123","inviteCode":"` + inv.Code + `"}`
	}
	if rec := sessionCall(router, "POST", "/api/v1/auth/register", "", body("taken@example.com"), ""); rec.Code != http.StatusConflict {
		t.Fatalf("existing address: want 409, got %d", rec.Code)
	}
	if rec := sessionCall(router, "POST", "/api/v1/auth/register", "", body("free@example.com"), ""); rec.Code != http.StatusCreated {
		t.Fatalf("code must still work after a failed attempt, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestRegisterThrottledPerAddress(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	router := srv.Router()
	for i := 0; i < limitRegisterPerIP; i++ {
		rec := sessionCall(router, "POST", "/api/v1/auth/register", "", `{"email":"x@example.com","password":"password123","inviteCode":"INV-NOPE"}`, "")
		if rec.Code != http.StatusForbidden {
			t.Fatalf("attempt %d: want 403, got %d", i+1, rec.Code)
		}
	}
	rec := sessionCall(router, "POST", "/api/v1/auth/register", "", `{"email":"x@example.com","password":"password123","inviteCode":"INV-NOPE"}`, "")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("want 429 after %d attempts, got %d", limitRegisterPerIP, rec.Code)
	}
}

func TestThrottleWindowAndSwitch(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	g := newLoginGuard(true)
	g.now = func() time.Time { return now }
	ip := clientIPInfo{ip: "203.0.113.9"}
	for i := 0; i < 3; i++ {
		if g.throttle("forgot", ip, 3) != 0 {
			t.Fatalf("request %d must pass", i+1)
		}
	}
	if g.throttle("forgot", ip, 3) == 0 {
		t.Fatal("fourth request must be refused")
	}
	if g.throttle("register", ip, 3) != 0 {
		t.Fatal("other kinds have their own bucket")
	}
	if g.throttle("forgot", clientIPInfo{ip: "198.51.100.1"}, 3) != 0 {
		t.Fatal("other addresses are not affected")
	}
	if g.throttle("forgot", clientIPInfo{ip: "172.18.0.2", viaProxyWithoutHeader: true}, 0) != 0 {
		t.Fatal("unknown visitors are not limited")
	}
	now = now.Add(loginLockWindow + time.Minute)
	if g.throttle("forgot", ip, 3) != 0 {
		t.Fatal("lock must end after the window")
	}
	if off := newLoginGuard(false); off.throttle("forgot", ip, 0) != 0 {
		t.Fatal("LOGIN_PROTECTION=false switches throttling off")
	}
}
