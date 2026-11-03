package storage

import (
	"crypto/sha256"
	"encoding/base64"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Lifetimes follow the time handed in, not the clock: code 10 minutes, access token 1 hour, unused
// connections after the configured days.
func TestOAuthLifetimes(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "oauth.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	u, err := s.EnsureDefaultUser()
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 3, 29, 1, 30, 0, 0, time.FixedZone("CET", 3600)) // around a DST switch
	client, err := s.CreateOAuthClient("Claude", []string{"https://claude.ai/cb"}, start)
	if err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("a", 43)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	late, _ := s.GrantOAuth(u.ID, client, []string{ScopeTasksRead}, "https://claude.ai/cb", challenge, start)
	if _, err := s.ExchangeOAuthCode(late, client.ID, "https://claude.ai/cb", verifier, start.Add(11*time.Minute)); err != ErrOAuthInvalidGrant {
		t.Fatalf("code after 11 minutes must be refused, got %v", err)
	}
	code, _ := s.GrantOAuth(u.ID, client, []string{ScopeTasksRead}, "https://claude.ai/cb", challenge, start)
	tok, err := s.ExchangeOAuthCode(code, client.ID, "https://claude.ai/cb", verifier, start.Add(9*time.Minute))
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	issued := start.Add(9 * time.Minute)
	if _, _, _, err := s.ValidateOAuthAccessToken(tok.AccessToken, issued.Add(59*time.Minute)); err != nil {
		t.Fatalf("access token within the hour: %v", err)
	}
	if _, _, _, err := s.ValidateOAuthAccessToken(tok.AccessToken, issued.Add(61*time.Minute)); err == nil {
		t.Fatal("access token after an hour must be refused")
	}
	if _, err := s.RefreshOAuth(tok.RefreshToken, client.ID, issued.Add(91*24*time.Hour)); err != ErrOAuthInvalidGrant {
		t.Fatalf("refresh token after 90 days must be refused, got %v", err)
	}
	if _, err := s.RefreshOAuth(tok.RefreshToken, "mcl_other", issued.Add(time.Hour)); err != ErrOAuthInvalidGrant {
		t.Fatalf("refresh token of another client must be refused, got %v", err)
	}
	// An ordinary key's secret check never finds OAuth entries
	if _, _, _, err := s.ValidateAPIKey(tok.AccessToken); err == nil {
		t.Fatal("OAuth token must not pass as API key")
	}

	// Last use was at issue time: 0 days keeps it, after 90 days it goes; tokens go with it
	lastUse := issued.Add(59 * time.Minute)
	if n, _ := s.PurgeOAuth(lastUse.AddDate(0, 0, 200), 0); n != 0 {
		t.Fatalf("idle days 0 must keep connections, removed %d", n)
	}
	if n, _ := s.PurgeOAuth(lastUse.AddDate(0, 0, 89), 90); n != 0 {
		t.Fatalf("used 89 days ago must stay, removed %d", n)
	}
	fresh, _ := s.GrantOAuth(u.ID, client, []string{ScopeTasksRead}, "https://claude.ai/cb", challenge, lastUse)
	if n, _ := s.PurgeOAuth(lastUse.AddDate(0, 0, 91), 90); n != 1 {
		t.Fatalf("unused for 91 days must go, removed %d", n)
	}
	if _, err := s.ExchangeOAuthCode(fresh, client.ID, "https://claude.ai/cb", verifier, lastUse); err == nil {
		t.Fatal("codes of a removed connection must be gone")
	}
	// The client without any connection left is removed a day later
	if _, err := s.GetOAuthClient(client.ID); err == nil {
		t.Fatal("unused client should have been removed with the purge")
	}
}
