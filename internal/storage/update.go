package storage

// The look for a new MindSift release (api/update.go) keeps its last answer in the system settings, so a
// restart neither forgets it nor asks GitHub again right away. Each admin can put the hint for one version
// aside ("Später"); a newer release shows it again. Both live in system_settings (key/value), no table of
// their own.

const updateCheckKey = "update_check"

func updateDismissedKey(userID string) string { return "update_dismissed:" + userID }

// UpdateCheckState returns the stored answer of the last release check (JSON, api.updateState); "" when
// there is none or it cannot be read.
func (s *Store) UpdateCheckState() string {
	var v string
	if dbFailed(s.db.QueryRow(`SELECT value FROM system_settings WHERE key = ?`, updateCheckKey).Scan(&v)) {
		return ""
	}
	return v
}

func (s *Store) SetUpdateCheckState(state string) error {
	_, err := s.db.Exec(`INSERT INTO system_settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, updateCheckKey, state)
	return err
}

// UpdateDismissed returns the release whose hint the admin put aside ("" for none).
func (s *Store) UpdateDismissed(userID string) string {
	var v string
	if dbFailed(s.db.QueryRow(`SELECT value FROM system_settings WHERE key = ?`, updateDismissedKey(userID)).Scan(&v)) {
		return ""
	}
	return v
}

func (s *Store) SetUpdateDismissed(userID, version string) error {
	_, err := s.db.Exec(`INSERT INTO system_settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, updateDismissedKey(userID), version)
	return err
}
