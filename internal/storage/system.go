package storage

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// --- STATS, SEARCH & EXPORT ---

func (s *Store) GetDashboardStats(userID string) (*domain.DashboardStats, error) {
	st := &domain.DashboardStats{}
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE user_id = ? AND status = 'inbox'`, userID).Scan(&st.InboxCount)
	// Same tasks as GetTasks without a list ("Alle Aufgaben"): own ones plus those in shared task lists
	taskScope := `(user_id = ? OR task_list_id IN (` + s.accessibleTaskListIDsQuery() + `)) AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))`
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE `+taskScope+` AND is_completed = 0`, userID, userID, userID, userID).Scan(&st.TasksOpenCount)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE `+taskScope+` AND is_completed = 1`, userID, userID, userID, userID).Scan(&st.TasksDoneCount)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ? AND is_archived = 0`, userID).Scan(&st.DocsCount)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE user_id = ? AND status = 'discarded'`, userID).Scan(&st.DiscardedCount)
	// Own lists and lists shared with the user directly or through a group
	visibleLists := `
		SELECT l.id
		FROM lists l
		LEFT JOIN list_shares ls ON ls.list_id = l.id AND (
		    (ls.target_type = 'user' AND ls.target_id = ?)
		    OR (ls.target_type = 'team' AND ls.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		)
		WHERE l.user_id = ? OR ls.id IS NOT NULL`
	_ = s.db.QueryRow(`SELECT COUNT(DISTINCT id) FROM (`+visibleLists+`)`, userID, userID, userID).Scan(&st.ListsCount)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM list_items WHERE is_completed = 0 AND list_id IN (`+visibleLists+`)`,
		userID, userID, userID).Scan(&st.ListItemsOpenCount)

	// Count open (uncompleted) To-Dos across accessible workspace documents (owned or shared)
	docRows, err := s.db.Query(`
		SELECT blocks_json FROM documents 
		WHERE (user_id = ? OR id IN (SELECT doc_id FROM doc_shares WHERE user_id = ?))
		  AND is_archived = 0`,
		userID, userID,
	)
	if err == nil {
		for docRows.Next() {
			var bj string
			if err := docRows.Scan(&bj); err == nil && bj != "" {
				var blocks []domain.DocumentBlock
				if err := json.Unmarshal([]byte(bj), &blocks); err == nil {
					for _, b := range blocks {
						if b.Type == "todo" && !b.Checked {
							st.DocsTodosOpenCount++
						}
					}
				}
			}
		}
		_ = docRows.Close()
	}

	return st, nil
}

func (s *Store) SearchAll(userID, query string) ([]domain.Thought, []domain.Document, error) {
	res, err := s.SearchGlobal(userID, query)
	if err != nil {
		return nil, nil, err
	}
	return res.Thoughts, res.Documents, nil
}

func (s *Store) ExportUserData(userID string) (*domain.FullExport, error) {
	user, err := s.GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	thoughts, _ := s.GetThoughts(userID, "all", 5000)
	docs, _ := s.GetDocuments(userID)
	lists, _ := s.GetAllListsForUser(userID)
	taskLists, _ := s.GetTaskLists(userID)
	themes, _ := s.GetUserThemes(userID)

	return &domain.FullExport{
		ExportedAt: domain.NowISO(),
		Version:    "1.0.0",
		User:       *user,
		Thoughts:   thoughts,
		Documents:  docs,
		Lists:      lists,
		TaskLists:  taskLists,
		Themes:     themes,
	}, nil
}

// --- SYSTEM SETTINGS ---

func (s *Store) SeedSMTPDefaultsFromEnv(host, port, user, pass, from, fromName string, tls, skipVerify bool) {
	cur, err := s.GetSystemSettings()
	if err != nil || cur == nil {
		return
	}
	// Only populate DB from env if DB has no SMTP host configured yet and env provides one
	if cur.SMTPHost == "" && strings.TrimSpace(host) != "" {
		cur.SMTPHost = strings.TrimSpace(host)
		if strings.TrimSpace(port) != "" {
			cur.SMTPPort = strings.TrimSpace(port)
		}
		cur.SMTPUser = strings.TrimSpace(user)
		cur.SMTPPass = pass
		cur.SMTPFrom = strings.TrimSpace(from)
		cur.SMTPFromName = strings.TrimSpace(fromName)
		cur.SMTPTLS = tls
		cur.SMTPSkipVerify = skipVerify
		_ = s.UpdateSystemSettings(cur)
	}
}

func (s *Store) GetSystemSettings() (*domain.SystemSettings, error) {
	settings := &domain.SystemSettings{
		SharingMode:         SharingOrganizations,
		AllowRegistration:   false,
		InstanceName:        "MindSift",
		SMTPPort:            "587",
		SMTPTLS:             true,
		BackupTime:          DefaultBackupTime,
		BackupRetentionDays: DefaultBackupRetentionDays,
	}

	rows, err := s.db.Query(`SELECT key, value FROM system_settings`)
	if err != nil {
		return settings, nil
	}
	defer rows.Close()

	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			switch k {
			case "sharing_mode":
				settings.SharingMode = v
			case "allow_registration":
				settings.AllowRegistration = (v == "true" || v == "1")
			case "registration_mode":
				settings.RegistrationMode = NormalizeRegistrationMode(v)
			case "registration_domains":
				settings.RegistrationDomains = v
			case "registration_verify_email":
				settings.RegistrationVerifyEmail = v == "true"
			case "instance_name":
				settings.InstanceName = v
			case "smtp_host":
				settings.SMTPHost = v
			case "smtp_port":
				if v != "" {
					settings.SMTPPort = v
				}
			case "smtp_user":
				settings.SMTPUser = v
			case "smtp_pass":
				settings.SMTPPass = v
			case "smtp_from":
				settings.SMTPFrom = v
			case "smtp_from_name":
				settings.SMTPFromName = v
			case "smtp_tls":
				settings.SMTPTLS = (v != "false" && v != "0")
			case "smtp_skip_verify":
				settings.SMTPSkipVerify = v == "true"
			case "allow_private_webhooks":
				settings.AllowPrivateWebhooks = v == "true"
			case "backup_enabled":
				settings.BackupEnabled = v == "true"
			case "backup_time":
				if validBackupTime(v) {
					settings.BackupTime = v
				}
			case "backup_retention_days":
				if n, err := strconv.Atoi(v); err == nil && n > 0 {
					settings.BackupRetentionDays = n
				}
			case "retention_allow_never":
				allow := v != "false"
				settings.RetentionAllowNever = &allow
			case "mcp_enabled":
				on := v != "false"
				settings.MCPEnabled = &on
			case "default_language":
				if i18n.Valid(v) {
					settings.DefaultLanguage = v
				}
			}
		}
	}
	// Older installations only knew the open/closed switch
	if settings.RegistrationMode == "" {
		settings.RegistrationMode = RegistrationClosed
		if settings.AllowRegistration {
			settings.RegistrationMode = RegistrationOpen
		}
	}
	settings.AllowRegistration = settings.RegistrationMode == RegistrationOpen
	if settings.RetentionAllowNever == nil {
		allow := true
		settings.RetentionAllowNever = &allow
	}
	if settings.MCPEnabled == nil {
		on := true
		settings.MCPEnabled = &on
	}
	return settings, nil
}

func (s *Store) UpdateSystemSettings(settings *domain.SystemSettings) error {
	// Clients that only send the old switch keep working
	settings.RegistrationMode = NormalizeRegistrationMode(settings.RegistrationMode)
	if settings.RegistrationMode == "" {
		settings.RegistrationMode = RegistrationClosed
		if settings.AllowRegistration {
			settings.RegistrationMode = RegistrationOpen
		}
	}
	settings.AllowRegistration = settings.RegistrationMode == RegistrationOpen
	settings.RegistrationDomains = strings.Join(ParseEmailDomains(settings.RegistrationDomains), ", ")
	regStr := "false"
	if settings.AllowRegistration {
		regStr = "true"
	}
	tlsStr := "false"
	if settings.SMTPTLS {
		tlsStr = "true"
	}
	skipVerifyStr := "false"
	if settings.SMTPSkipVerify {
		skipVerifyStr = "true"
	}
	privateHooksStr := "false"
	if settings.AllowPrivateWebhooks {
		privateHooksStr = "true"
	}
	if settings.SMTPPort == "" {
		settings.SMTPPort = "587"
	}
	settings.SharingMode = NormalizeSharingMode(settings.SharingMode)
	if settings.InstanceName == "" {
		settings.InstanceName = "MindSift"
	}
	if !validBackupTime(settings.BackupTime) {
		settings.BackupTime = DefaultBackupTime
	}
	if settings.BackupRetentionDays < 1 || settings.BackupRetentionDays > 365 {
		settings.BackupRetentionDays = DefaultBackupRetentionDays
	}
	_, err := s.db.Exec(`INSERT INTO system_settings (key, value) VALUES 
		('sharing_mode', ?),
		('allow_registration', ?),
		('instance_name', ?),
		('smtp_host', ?),
		('smtp_port', ?),
		('smtp_user', ?),
		('smtp_pass', ?),
		('smtp_from', ?),
		('smtp_from_name', ?),
		('smtp_tls', ?),
		('smtp_skip_verify', ?),
		('allow_private_webhooks', ?),
		('backup_enabled', ?),
		('backup_time', ?),
		('backup_retention_days', ?),
		('registration_mode', ?),
		('registration_domains', ?),
		('registration_verify_email', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		settings.SharingMode,
		regStr,
		settings.InstanceName,
		strings.TrimSpace(settings.SMTPHost),
		strings.TrimSpace(settings.SMTPPort),
		strings.TrimSpace(settings.SMTPUser),
		settings.SMTPPass,
		strings.TrimSpace(settings.SMTPFrom),
		strings.TrimSpace(settings.SMTPFromName),
		tlsStr,
		skipVerifyStr,
		privateHooksStr,
		strconv.FormatBool(settings.BackupEnabled),
		settings.BackupTime,
		strconv.Itoa(settings.BackupRetentionDays),
		settings.RegistrationMode,
		settings.RegistrationDomains,
		strconv.FormatBool(settings.RegistrationVerifyEmail),
	)
	if err == nil && settings.RetentionAllowNever != nil {
		_, err = s.db.Exec(`INSERT INTO system_settings (key, value) VALUES ('retention_allow_never', ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, strconv.FormatBool(*settings.RetentionAllowNever))
	}
	if err == nil && settings.MCPEnabled != nil {
		_, err = s.db.Exec(`INSERT INTO system_settings (key, value) VALUES ('mcp_enabled', ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, strconv.FormatBool(*settings.MCPEnabled))
	}
	if err == nil && settings.DefaultLanguage != "" {
		if !i18n.Valid(settings.DefaultLanguage) {
			return ErrInvalidLanguage
		}
		_, err = s.db.Exec(`INSERT INTO system_settings (key, value) VALUES ('default_language', ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, settings.DefaultLanguage)
	}
	return err
}

// MCPEnabledSetting: the admin's switch for the MCP endpoint in the system settings (default: on).
func (s *Store) MCPEnabledSetting() bool {
	var v string
	_ = s.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'mcp_enabled'`).Scan(&v)
	return v != "false"
}
