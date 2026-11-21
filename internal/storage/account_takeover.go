package storage

import (
	"errors"
	"strings"
)

// Taking one account of a server's database snapshot over into a local instance of the desktop app
// (api/desktop_restore.go). The snapshot is opened as a store of its own; its accounts are listed with
// what each owns (SnapshotAccounts), the chosen one's data goes through the export and the import like
// a person's own backup, and the person's settings follow with TakeOverPersonSettings.

// SnapshotAccount is one account of a database snapshot with what it owns: notes (not in the trash),
// tasks (its own and every task in its own task lists), lists and inbox entries, as the import of its
// backup would count them.
type SnapshotAccount struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	Role        string `json:"role"`
	IsActive    bool   `json:"isActive"`
	Notes       int    `json:"notes"`
	Tasks       int    `json:"tasks"`
	Lists       int    `json:"lists"`
	Inbox       int    `json:"inbox"`
}

// SnapshotAccounts lists every account of the database, oldest first.
func (s *Store) SnapshotAccounts() ([]SnapshotAccount, error) {
	rows, err := s.db.Query(`SELECT u.id, u.display_name, u.username, u.email, u.role, u.is_active,
		(SELECT COUNT(*) FROM documents d WHERE d.user_id = u.id AND d.is_archived = 0),
		(SELECT COUNT(*) FROM thoughts t WHERE (t.user_id = u.id OR (t.task_list_id != '' AND t.task_list_id IN (SELECT id FROM task_lists WHERE user_id = u.id)))
			AND (t.status = 'kept' OR (t.status = 'converted' AND t.converted_type = 'task'))),
		(SELECT COUNT(*) FROM lists l WHERE l.user_id = u.id),
		(SELECT COUNT(*) FROM thoughts t WHERE t.user_id = u.id AND t.status = 'inbox')
		FROM users u ORDER BY u.created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SnapshotAccount{}
	for rows.Next() {
		var a SnapshotAccount
		if err := rows.Scan(&a.ID, &a.DisplayName, &a.Username, &a.Email, &a.Role, &a.IsActive, &a.Notes, &a.Tasks, &a.Lists, &a.Inbox); err != nil {
			return nil, err
		}
		if !strings.Contains(a.Email, "@") { // an account without an address
			a.Email = ""
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// TakeOverPersonSettings copies what belongs to the person from account srcID of src to account dstID of
// s: the name, language, voice input, how long finished and deleted things are kept, the recognition of
// dates in typed text, whether the tour was offered, the notification settings and the alarm channels
// with their webhooks. Not the sign-in (username, address, password, second factor, passkeys), the role,
// the organizations and the profile picture (its file is not in a database snapshot).
func (s *Store) TakeOverPersonSettings(src *Store, srcID, dstID string, allowNever bool) error {
	u, err := src.GetUserByID(srcID)
	if err != nil {
		return err
	}
	channels := u.AlarmChannels
	if _, err := s.UpdateUserFull(dstID, &u.DisplayName, nil, nil, nil, &channels, &u.DiscordWebhookURL, &u.CustomWebhookURL, &u.NotifyBeforeMinutes, nil); err != nil {
		return err
	}
	var errs []error
	if lang := src.Language(srcID); lang != "" {
		errs = append(errs, s.SetLanguage(dstID, lang))
	}
	errs = append(errs,
		s.SetVoiceInput(dstID, src.VoiceInput(srcID)),
		s.SetVoiceLanguage(dstID, src.VoiceLanguage(srcID)),
		s.SetRetention(dstID, src.RetentionOf(srcID, allowNever), allowNever),
		s.SetTypedRecognition(dstID, src.TypedRecognition(srcID)),
		s.SetNotificationSettings(dstID, src.NotificationSettingsOf(srcID)),
	)
	if src.TourOffered(srcID) {
		errs = append(errs, s.SetTourOffered(dstID, true))
	}
	return errors.Join(errs...)
}

// HasAccount: whether the database has an account with this id.
func (s *Store) HasAccount(id string) bool {
	u, err := s.GetUserByID(id)
	return err == nil && u != nil && u.ID == id
}
