package cli

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --must-change asks for an own password at the next sign-in, --revoke-keys removes the account's API keys
// and OAuth grants; neither happens without its flag, and the audit row says what was done
func TestResetPasswordMustChangeAndRevokeKeys(t *testing.T) {
	path, store := testDB(t)
	bert := mustCreate(t, store, "bert", domain.RoleMember)
	anna := mustCreate(t, store, "anna", domain.RoleMember)
	_, _ = store.CreateAPIKey(bert.ID, "Skript", nil)
	_, _ = store.CreateAPIKey(anna.ID, "Annas Skript", nil)
	client, err := store.CreateOAuthClient("Claude", []string{"https://claude.ai/api/mcp/auth_callback"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GrantOAuth(bert.ID, client, nil, "https://claude.ai/api/mcp/auth_callback", "challenge", time.Now()); err != nil {
		t.Fatal(err)
	}

	r := run(t, path, "", "reset-password", "bert")
	if r.code != ExitOK || !strings.Contains(r.stdout, "--must-change requires it") {
		t.Fatalf("plain reset: %d %s", r.code, r.stdout)
	}
	if u, _ := store.GetUserByID(bert.ID); u.MustChangePassword {
		t.Fatal("no request without --must-change")
	}
	if keys, _ := store.GetAPIKeys(bert.ID); len(keys) != 2 {
		t.Fatalf("keys stay without --revoke-keys: %d", len(keys))
	}
	feed := &storage.CalendarFeed{UserID: bert.ID, TokenHash: "hash-bert", TokenSealed: "sealed", CreatedAt: domain.NowISO()}
	if err := store.SaveCalendarFeed(feed); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CalendarFeedOf(bert.ID); err != nil {
		t.Fatalf("the feed must stay without --revoke-keys: %v", err)
	}

	r = run(t, path, "", "reset-password", "bert", "--must-change", "--revoke-keys", "--json")
	if r.code != ExitOK {
		t.Fatalf("code %d: %s %s", r.code, r.stdout, r.stderr)
	}
	m := decode(t, r)
	if m["mustChange"] != true || m["keysRevoked"] != float64(1) || m["connectionsRevoked"] != float64(1) || m["calendarFeedRevoked"] != true {
		t.Fatalf("json: %v", m)
	}
	if u, _ := store.GetUserByID(bert.ID); !u.MustChangePassword {
		t.Fatal("--must-change not stored")
	}
	if keys, _ := store.GetAPIKeys(bert.ID); len(keys) != 0 {
		t.Fatalf("keys and grants of bert must be gone: %+v", keys)
	}
	if _, err := store.CalendarFeedByTokenHash("hash-bert"); err == nil {
		t.Fatal("--revoke-keys must switch the calendar subscription off")
	}
	if keys, _ := store.GetAPIKeys(anna.ID); len(keys) != 1 {
		t.Fatal("other accounts keep their keys")
	}
	events, _ := store.AuditEntriesAfter(0, storage.AuditSourceCLI)
	last := events[len(events)-1]
	var d map[string]any
	_ = json.Unmarshal(last.Details, &d)
	if last.Action != storage.AuditAccountPasswordReset || d["mustChange"] != true || d["keysRevoked"] != float64(1) || d["connectionsRevoked"] != float64(1) || d["calendarFeedRevoked"] != true {
		t.Fatalf("audit row: %+v %s", last, last.Details)
	}

	// The text names what happened
	r = run(t, path, "", "reset-password", "bert", "--must-change", "--revoke-keys")
	if r.code != ExitOK || !strings.Contains(r.stdout, "Revoked 0 API keys and 0 AI connections") || !strings.Contains(r.stdout, "choose an own password") {
		t.Fatalf("text: %s", r.stdout)
	}
	if r := run(t, path, "", "help"); !strings.Contains(r.stdout, "--must-change") || !strings.Contains(r.stdout, "--revoke-keys") {
		t.Fatalf("help: %s", r.stdout)
	}
}
