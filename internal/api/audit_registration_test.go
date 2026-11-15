package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// Sign-ups on the login page go to the audit log: without invite as account.registered with what the
// account waits for, with an invite as invite.redeemed (who, which invite, never its code)
func TestAuditRegistration(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	admin, _ := store.GetFirstUser()

	setRegistration(t, store, storage.RegistrationOpen, "")
	if code, _ := register(srv, "offen@example.com", ""); code != http.StatusCreated {
		t.Fatalf("open: %d", code)
	}
	e := lastAudit(t, store, storage.AuditAccountRegistered)
	if e.TargetName != "offen" || e.ActorID != e.TargetID || e.ActorKind != storage.AuditActorUser || len(e.Details) != 0 {
		t.Fatalf("open sign-up: %+v %s", e, e.Details)
	}

	setRegistration(t, store, storage.RegistrationApproval, "")
	if code, _ := register(srv, "wartet@example.com", ""); code != http.StatusAccepted {
		t.Fatalf("approval: %d", code)
	}
	e = lastAudit(t, store, storage.AuditAccountRegistered)
	var d map[string]any
	_ = json.Unmarshal(e.Details, &d)
	if e.TargetName != "wartet" || d["awaitingApproval"] != true || d["emailConfirmation"] != nil {
		t.Fatalf("waiting for approval: %+v %s", e, e.Details)
	}

	org, _ := store.CreateOrganization("Gäste")
	inv, err := store.CreateUserInvite(admin.ID, "", []string{org.ID}, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	setRegistration(t, store, storage.RegistrationClosed, "")
	if code, _ := register(srv, "gast@example.com", inv.Code); code != http.StatusCreated {
		t.Fatalf("invite: %d", code)
	}
	e = lastAudit(t, store, storage.AuditInviteRedeemed)
	d = nil
	_ = json.Unmarshal(e.Details, &d)
	if e.TargetKind != storage.AuditTargetInvite || e.TargetID != inv.ID || e.ActorName != "gast" ||
		d["account"] != "gast" || d["invitedBy"] != admin.Username {
		t.Fatalf("invite redeemed: %+v %s", e, e.Details)
	}
	if orgs, _ := d["organizations"].([]any); len(orgs) != 1 || orgs[0] != "Gäste" {
		t.Fatalf("organizations of the invite: %s", e.Details)
	}
	if strings.Contains(string(e.Details), inv.Code) || strings.Contains(e.TargetName, inv.Code) {
		t.Fatalf("the code must never be logged: %+v %s", e, e.Details)
	}
}

// Accounts whose address was not confirmed in time are deleted by the server, which logs each one
func TestAuditUnconfirmedAccountsDeleted(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	u, err := store.CreateInactiveUser("spaet@example.com", "hash", "Spät", "member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateEmailVerification(u.ID); err != nil {
		t.Fatal(err)
	}
	srv.purgeUnconfirmedAccounts(time.Now())
	if got, _ := store.AuditEntries(storage.AuditFilter{Action: storage.AuditAccountUnconfirmedDeleted}); len(got) != 0 {
		t.Fatalf("nothing expired yet: %+v", got)
	}
	srv.purgeUnconfirmedAccounts(time.Now().Add(storage.EmailVerificationTTL + time.Hour))
	e := lastAudit(t, store, storage.AuditAccountUnconfirmedDeleted)
	if e.ActorKind != storage.AuditActorSystem || e.Source != storage.AuditSourceSystem || e.TargetID != u.ID || e.TargetName != u.Username {
		t.Fatalf("purge entry: %+v", e)
	}
	if got, _ := store.GetUserByID(u.ID); got != nil {
		t.Fatal("account must be gone")
	}
}
