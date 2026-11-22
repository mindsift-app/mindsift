package storage

import (
	"context"
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
	return s.snapshotAccounts(context.Background())
}

func (s *Store) snapshotAccounts(ctx context.Context) ([]SnapshotAccount, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT u.id, u.display_name, u.username, u.email, u.role, u.is_active,
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
//
// The snapshot is a file from elsewhere: every value passes the checks PATCH /auth/settings applies, the
// webhooks through checkWebhook (the API's validateWebhookURL: only https, Discord only to discord.com,
// no blocked targets). A value that fails is left out, its channel too, and named in the answer (the keys
// of PATCH /auth/settings: discordWebhookUrl, customWebhookUrl, language, voiceInput, voiceLanguage,
// retention, notifyBeforeMinutes); the rest is taken over.
func (s *Store) TakeOverPersonSettings(src *Store, srcID, dstID string, allowNever bool, checkWebhook func(raw string, discord bool) error) (skipped []string, err error) {
	u, err := src.GetUserByID(srcID)
	if err != nil {
		return nil, err
	}
	channels := u.AlarmChannels
	discord, custom := strings.TrimSpace(u.DiscordWebhookURL), strings.TrimSpace(u.CustomWebhookURL)
	without := func(drop string) {
		kept := channels[:0:0]
		for _, c := range channels {
			if c != drop {
				kept = append(kept, c)
			}
		}
		channels = kept
	}
	if discord != "" && (len(discord) > maxWebhookURLLength || checkWebhook(discord, true) != nil) {
		discord = ""
		without("discord")
		skipped = append(skipped, "discordWebhookUrl")
	}
	if custom != "" && (len(custom) > maxWebhookURLLength || checkWebhook(custom, false) != nil) {
		custom = ""
		without("webhook")
		skipped = append(skipped, "customWebhookUrl")
	}
	var notifyBefore *int
	if n := u.NotifyBeforeMinutes; n >= 0 && n <= maxNotifyBeforeMinutes {
		notifyBefore = &n
	} else {
		skipped = append(skipped, "notifyBeforeMinutes")
	}
	if _, err := s.UpdateUserFull(dstID, &u.DisplayName, nil, nil, nil, &channels, &discord, &custom, notifyBefore, nil); err != nil {
		return skipped, err
	}
	var errs []error
	// A value the store refuses (unknown language, voice input, retention) is left out, not an error
	setOrSkip := func(key string, err error) {
		switch {
		case err == nil:
		case errors.Is(err, ErrInvalidLanguage), errors.Is(err, ErrInvalidVoiceInput), errors.Is(err, ErrInvalidVoiceLanguage),
			errors.Is(err, ErrInvalidRetention), errors.Is(err, ErrRetentionNever):
			skipped = append(skipped, key)
		default:
			errs = append(errs, err)
		}
	}
	if lang := src.Language(srcID); lang != "" {
		setOrSkip("language", s.SetLanguage(dstID, lang))
	}
	setOrSkip("voiceInput", s.SetVoiceInput(dstID, src.VoiceInput(srcID)))
	setOrSkip("voiceLanguage", s.SetVoiceLanguage(dstID, src.VoiceLanguage(srcID)))
	setOrSkip("retention", s.SetRetention(dstID, src.RetentionOf(srcID, allowNever), allowNever))
	errs = append(errs,
		s.SetTypedRecognition(dstID, src.TypedRecognition(srcID)),
		s.SetNotificationSettings(dstID, src.NotificationSettingsOf(srcID)),
	)
	if src.TourOffered(srcID) {
		errs = append(errs, s.SetTourOffered(dstID, true))
	}
	return skipped, errors.Join(errs...)
}

const (
	// maxWebhookURLLength: a longer alarm URL from a snapshot is not taken over
	maxWebhookURLLength = 2048
	// maxNotifyBeforeMinutes: alarms at most a week ahead (the app offers far less)
	maxNotifyBeforeMinutes = 7 * 24 * 60
)

// HasAccount: whether the database has an account with this id.
func (s *Store) HasAccount(id string) bool {
	u, err := s.GetUserByID(id)
	return err == nil && u != nil && u.ID == id
}
