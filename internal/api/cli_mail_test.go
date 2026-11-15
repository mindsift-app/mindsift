package api

import (
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// `mindsift reset-password --disable-2fa` mails the owner like the reset in the administration: the running
// server sends it when it reads the command line's audit row; a plain reset sends nothing
func TestCLIDisable2FAMailsOwner(t *testing.T) {
	srv, store, _, mails := verificationServer(t)
	u, err := store.CreateUserWithUsername("bert@example.com", "bert", "x", "Bert", domain.RoleMember)
	if err != nil {
		t.Fatal(err)
	}
	last, _ := store.LastAuditID()
	row := storage.AuditEntry{ActorKind: storage.AuditActorCLI, Source: storage.AuditSourceCLI, Action: storage.AuditAccountPasswordReset,
		TargetKind: storage.AuditTargetUser, TargetID: u.ID, TargetName: u.Username}
	if err := store.RecordAudit(row, map[string]bool{"mustChange": true}); err != nil {
		t.Fatal(err)
	}
	last = srv.applyCLIEvents(last)
	time.Sleep(200 * time.Millisecond)
	if got := mails(); len(got) != 0 {
		t.Fatalf("a reset without --disable-2fa sends no notice: %+v", got)
	}
	if err := store.RecordAudit(row, map[string]bool{"secondFactorsRemoved": true}); err != nil {
		t.Fatal(err)
	}
	srv.applyCLIEvents(last)
	m := waitMail(t, mails, "bert@example.com")
	if !strings.Contains(m.text, "Zwei-Faktor-Anmeldung deines Kontos zurückgesetzt") {
		t.Fatalf("notice text: %s", m.text)
	}
}
