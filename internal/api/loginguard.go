package api

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Brute-force protection for the login (FLAW-09). Failed attempts are counted in memory in three
// buckets; when one is full, logins for it are refused with 429 for the lock time:
//   account + IP   3 failures   the attacker's address is locked out of this account, the real owner
//                               logging in from elsewhere is not
//   account       20 failures   stops attacks spread over many addresses
//   IP            30 failures   stops one address trying many accounts
// A bucket counts failures within the lock window and starts over afterwards. A successful login
// clears the account buckets; a password reset clears the account completely. LOGIN_PROTECTION=false
// switches all of it off. Counters are lost on restart, which is fine for this purpose.

const (
	loginLockWindow       = 15 * time.Minute
	loginLimitAccountIP   = 3
	loginLimitAccount     = 20
	loginLimitIP          = 30
	loginGuardCleanupEach = 5 * time.Minute
)

type loginBucket struct {
	count       int
	windowStart time.Time
	lockedUntil time.Time
}

type loginGuard struct {
	enabled bool
	now     func() time.Time

	mu          sync.Mutex
	buckets     map[string]*loginBucket
	lastCleanup time.Time
}

func newLoginGuard(enabled bool) *loginGuard {
	return &loginGuard{enabled: enabled, now: time.Now, buckets: map[string]*loginBucket{}}
}

type loginKey struct {
	key   string
	limit int
}

// loginKeys: account is the user ID (or the typed login for unknown names, so both look the same).
// The IP buckets are left out when the IP is not known (proxy without client header).
func loginKeys(account string, ip clientIPInfo) []loginKey {
	keys := []loginKey{{"acct:" + account, loginLimitAccount}}
	if !ip.viaProxyWithoutHeader && ip.ip != "" {
		keys = append(keys, loginKey{"acctip:" + account + "|" + ip.ip, loginLimitAccountIP}, loginKey{"ip:" + ip.ip, loginLimitIP})
	}
	return keys
}

// lockedFor returns how long the login is still refused (0 = allowed).
func (g *loginGuard) lockedFor(account string, ip clientIPInfo) time.Duration {
	if !g.enabled {
		return 0
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	var wait time.Duration
	for _, k := range loginKeys(account, ip) {
		if b := g.buckets[k.key]; b != nil && b.lockedUntil.After(now) && b.lockedUntil.Sub(now) > wait {
			wait = b.lockedUntil.Sub(now)
		}
	}
	return wait
}

func (g *loginGuard) recordFailure(account string, ip clientIPInfo) {
	if !g.enabled {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.cleanupLocked(now)
	for _, k := range loginKeys(account, ip) {
		b := g.buckets[k.key]
		if b == nil || now.Sub(b.windowStart) > loginLockWindow {
			b = &loginBucket{windowStart: now}
			g.buckets[k.key] = b
		}
		b.count++
		if b.count >= k.limit {
			b.lockedUntil = now.Add(loginLockWindow)
		}
	}
}

// recordSuccess clears the counters of this account (the IP bucket stays, so one valid login cannot
// be used to keep trying other accounts).
func (g *loginGuard) recordSuccess(account string, ip clientIPInfo) {
	if !g.enabled {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.buckets, "acct:"+account)
	delete(g.buckets, "acctip:"+account+"|"+ip.ip)
}

// unlockAccount lifts every lock of the account, e.g. after a password reset by mail or by an admin.
func (g *loginGuard) unlockAccount(account string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for k := range g.buckets {
		if k == "acct:"+account || strings.HasPrefix(k, "acctip:"+account+"|") {
			delete(g.buckets, k)
		}
	}
}

func (g *loginGuard) cleanupLocked(now time.Time) {
	if now.Sub(g.lastCleanup) < loginGuardCleanupEach {
		return
	}
	g.lastCleanup = now
	for k, b := range g.buckets {
		if now.Sub(b.windowStart) > loginLockWindow && !b.lockedUntil.After(now) {
			delete(g.buckets, k)
		}
	}
}

// Other endpoints that can be abused in bulk are limited per address in the same buckets (FLAW-39).
// Every request counts here, not only failures: registration (also guessing invite codes) and
// "forgot password" (mail flood to many addresses).
const (
	limitRegisterPerIP    = 20
	limitForgotPerIP      = 10
	limitTestAlarmPerUser = 5
)

// throttle counts one request of this kind from the visitor's address and returns how long further
// requests are refused (0 = this one may go ahead). Unknown addresses are not limited.
func (g *loginGuard) throttle(kind string, ip clientIPInfo, limit int) time.Duration {
	if !g.enabled || ip.viaProxyWithoutHeader || ip.ip == "" {
		return 0
	}
	return g.throttleKey(kind+":"+ip.ip, limit)
}

// throttleKey is throttle for any key, e.g. a person instead of an address.
func (g *loginGuard) throttleKey(key string, limit int) time.Duration {
	if !g.enabled {
		return 0
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.cleanupLocked(now)
	b := g.buckets[key]
	if b != nil && b.lockedUntil.After(now) {
		return b.lockedUntil.Sub(now)
	}
	if b == nil || now.Sub(b.windowStart) > loginLockWindow {
		b = &loginBucket{windowStart: now}
		g.buckets[key] = b
	}
	b.count++
	if b.count >= limit {
		b.lockedUntil = now.Add(loginLockWindow)
	}
	return 0
}

// lockedKey returns how long requests under key are still refused, without counting this one.
func (g *loginGuard) lockedKey(key string) time.Duration {
	if !g.enabled {
		return 0
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if b := g.buckets[key]; b != nil && b.lockedUntil.After(now) {
		return b.lockedUntil.Sub(now)
	}
	return 0
}

// failKey counts a failure under key (whatever the address); at limit failures within the lock window
// the key is locked for the lock window.
func (g *loginGuard) failKey(key string, limit int) {
	if !g.enabled {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.cleanupLocked(now)
	b := g.buckets[key]
	if b == nil || now.Sub(b.windowStart) > loginLockWindow {
		b = &loginBucket{windowStart: now}
		g.buckets[key] = b
	}
	if b.count++; b.count >= limit {
		b.lockedUntil = now.Add(loginLockWindow)
	}
}

func writeThrottled(w http.ResponseWriter, wait time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
	writeError(w, http.StatusTooManyRequests,
		tr(w, "Zu viele Anfragen von dieser Adresse. Bitte versuche es in {minutes} Minuten erneut.", "minutes", strconv.Itoa(int(math.Ceil(wait.Minutes())))))
}

func writeLoginLocked(w http.ResponseWriter, wait time.Duration) {
	minutes := int(math.Ceil(wait.Minutes()))
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
	msg := "Zu viele fehlgeschlagene Anmeldeversuche. Die Anmeldung ist für noch {minutes} Minuten gesperrt."
	if minutes == 1 {
		msg = "Zu viele fehlgeschlagene Anmeldeversuche. Die Anmeldung ist für noch eine Minute gesperrt."
	}
	writeError(w, http.StatusTooManyRequests, tr(w, msg, "minutes", strconv.Itoa(minutes)))
}
