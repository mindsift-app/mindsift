package storage

import "testing"

// Migration 35: alarm addresses of their own and waiting ones are gone, mail alarms use the login address
func TestAlarmAddressesGoToTheLoginAddress(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	if _, err := store.db.Exec(`UPDATE users SET alarm_email = 'privat@example.org' WHERE id = ?`, alice.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT INTO email_changes (user_id, kind, email, token_hash, created_at, expires_at) VALUES (?, 'alarm', 'neu@example.org', 'x', '', '')`, alice.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.migrateAlarmToLoginAddress(); err != nil {
		t.Fatal(err)
	}
	var kept string
	_ = store.db.QueryRow(`SELECT alarm_email FROM users WHERE id = ?`, alice.ID).Scan(&kept)
	if kept != "" {
		t.Errorf("alarm address kept: %q", kept)
	}
	if pending := store.PendingEmailChanges(alice.ID); len(pending) != 0 {
		t.Errorf("waiting alarm address kept: %v", pending)
	}
	if a := store.alarmUser(alice.ID); a == nil || a.UserEmail != alice.Email {
		t.Errorf("alarms of %s go to %+v", alice.Email, a)
	}
}
