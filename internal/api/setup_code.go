package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// One-time setup code: a server without any account and without ADMIN_USER would otherwise make whoever
// opens it first the administrator. At start it creates a code and writes it to its log only; the setup
// wizard (/auth/setup) asks for it. It lives in memory (a restart makes a new one) and is gone once the
// first administrator exists. The demo and ADMIN_USER need none: the demo has its accounts, ADMIN_USER
// creates the admin before the server listens.

// setupCodeAlphabet: no 0/O and 1/I, so the code can be typed from a screen without guessing; 32 signs,
// so a random byte maps onto it without bias (256 = 8 × 32).
const setupCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

type setupCodeState struct {
	mu   sync.Mutex
	code string // normalized (without dashes); empty = none needed
}

// newSetupCode: three groups of four signs, 60 bits. crypto/rand.Read does not fail (since Go 1.24 it
// ends the program instead).
func newSetupCode() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	out := make([]byte, 0, 14)
	for i, v := range b {
		if i > 0 && i%4 == 0 {
			out = append(out, '-')
		}
		out = append(out, setupCodeAlphabet[int(v)%len(setupCodeAlphabet)])
	}
	return string(out)
}

// normalizeSetupCode accepts the code as typed: lower case, spaces and dashes are fine.
func normalizeSetupCode(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, strings.ToUpper(strings.TrimSpace(s)))
}

func (c *setupCodeState) set(code string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.code = normalizeSetupCode(code)
}

func (c *setupCodeState) required() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.code != ""
}

// matches compares in constant time (for codes of the same length).
func (c *setupCodeState) matches(typed string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.code != "" && subtle.ConstantTimeCompare([]byte(normalizeSetupCode(typed)), []byte(c.code)) == 1
}

func (c *setupCodeState) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.code = ""
}

// prepareSetupCode creates and logs the code when the server starts without any account, outside the demo
// and without ADMIN_USER. A database that cannot be asked counts as empty: the setup then needs a code
// rather than being open.
func (s *Server) prepareSetupCode() {
	if s.cfg.DemoMode || s.cfg.InitialAdmin.Set() {
		return
	}
	if count, err := s.store.CountUsers(); err == nil && count > 0 {
		return
	}
	code := newSetupCode()
	s.setupCode.set(code)
	// Shown whatever LOG_LEVEL says: without it nobody can set up the server
	level := slog.LevelWarn
	if !slog.Default().Enabled(context.Background(), level) {
		level = slog.LevelError
	}
	slog.Log(context.Background(), level, fmt.Sprintf("Setup code: %s – enter it in the setup wizard; valid until the first administrator exists (a restart makes a new one)", code))
}

// checkSetupCode answers the setup request itself when the code is missing, wrong or the address is
// locked after wrong codes; true means it may go on. Wrong codes count like failed sign-ins per address
// (loginguard.go), not for the whole server, so nobody can lock the real admin out from elsewhere.
func (s *Server) checkSetupCode(w http.ResponseWriter, r *http.Request, typed string) bool {
	if !s.setupCode.required() {
		return true
	}
	ip := clientIPFrom(r)
	account := "setup:" + ip.ip
	// The right code always goes through, also while the address is locked: behind a proxy without a client
	// address header everyone shares one address, and wrong codes from someone else must not lock the admin
	// out (audit 2026-11-13, N2). Guessing stays hopeless with 60 bits; the lock only slows wrong codes down.
	if strings.TrimSpace(typed) != "" && s.setupCode.matches(typed) {
		s.loginGuard.recordSuccess(account, ip)
		return true
	}
	if wait := s.loginGuard.lockedFor(account, ip); wait > 0 {
		slog.Warn("Setup locked after wrong setup codes", "remote_addr", r.RemoteAddr, "wait", wait.Round(time.Second))
		writeLoginLocked(w, wait)
		return false
	}
	if strings.TrimSpace(typed) == "" {
		writeErrorCode(w, http.StatusForbidden, "setup_code_required", "Einrichtungscode erforderlich: Er steht im Server-Log.")
		return false
	}
	s.loginGuard.recordFailure(account, ip)
	slog.Warn("Setup refused: wrong setup code", "remote_addr", r.RemoteAddr)
	writeErrorCode(w, http.StatusForbidden, "setup_code_invalid", "Der Einrichtungscode stimmt nicht. Er steht im Server-Log.")
	return false
}
