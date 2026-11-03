package storage

import (
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// --- USERS ---

const userSelectCols = `id, email, username, password_hash, display_name, role, is_active, token_version, alarm_channels, alarm_email, discord_webhook_url, custom_webhook_url, notify_before_minutes, avatar_url, organization_id, created_at`

func parseAlarmChannels(raw string) []string {
	parts := strings.Split(raw, ",")
	res := make([]string, 0, len(parts))
	seen := make(map[string]bool)
	for _, p := range parts {
		p = strings.ToLower(strings.TrimSpace(p))
		if (p == "email" || p == "discord" || p == "webhook") && !seen[p] {
			seen[p] = true
			res = append(res, p)
		}
	}
	return res
}

func scanUser(row interface{ Scan(dest ...any) error }) (*domain.User, error) {
	u := &domain.User{}
	var isActiveInt int
	var channelsRaw string
	err := row.Scan(
		&u.ID, &u.Email, &u.Username, &u.PasswordHash, &u.DisplayName,
		&u.Role, &isActiveInt, &u.TokenVersion, &channelsRaw, &u.AlarmEmail,
		&u.DiscordWebhookURL, &u.CustomWebhookURL, &u.NotifyBeforeMinutes, &u.AvatarURL, &u.OrganizationID, &u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	u.IsActive = isActiveInt != 0
	if u.TokenVersion <= 0 {
		u.TokenVersion = 1
	}
	if u.Role == "" {
		u.Role = "member"
	}
	u.AlarmChannels = parseAlarmChannels(channelsRaw)
	if u.AlarmEmail == "" {
		u.AlarmEmail = u.Email
	}
	return u, nil
}

func (s *Store) CountUsers() (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

func (s *Store) CreateUser(email, passwordHash, displayName, role string) (*domain.User, error) {
	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	username := strings.Split(cleanEmail, "@")[0]
	return s.CreateUserWithUsername(cleanEmail, username, passwordHash, displayName, role)
}

func (s *Store) CreateUserWithUsername(email, username, passwordHash, displayName, role string) (*domain.User, error) {
	return s.createUserWithID(domain.NewID("usr"), email, username, passwordHash, displayName, role)
}

func (s *Store) createUserWithID(id, email, username, passwordHash, displayName, role string) (*domain.User, error) {
	if role != "admin" && role != "member" {
		role = "member"
	}
	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	cleanUsername := strings.ToLower(strings.TrimSpace(username))
	if cleanUsername == "" {
		cleanUsername = strings.Split(cleanEmail, "@")[0]
	}
	u := &domain.User{
		ID:                  id,
		Email:               cleanEmail,
		Username:            cleanUsername,
		PasswordHash:        passwordHash,
		DisplayName:         strings.TrimSpace(displayName),
		Role:                role,
		IsActive:            true,
		TokenVersion:        1,
		AlarmChannels:       []string{},
		AlarmEmail:          cleanEmail,
		DiscordWebhookURL:   "",
		CustomWebhookURL:    "",
		NotifyBeforeMinutes: 30,
		AvatarURL:           "",
		CreatedAt:           domain.NowISO(),
	}
	_, err := s.db.Exec(
		`INSERT INTO users (id, email, username, password_hash, display_name, role, is_active, token_version, alarm_channels, alarm_email, discord_webhook_url, custom_webhook_url, notify_before_minutes, avatar_url, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, 1, 1, '', ?, '', '', 30, '', ?)`,
		u.ID, u.Email, u.Username, u.PasswordHash, u.DisplayName, u.Role, u.AlarmEmail, u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Store) GetUserByEmail(email string) (*domain.User, error) {
	return s.GetUserByLogin(email)
}

func (s *Store) GetUserByLogin(login string) (*domain.User, error) {
	cleanLogin := strings.ToLower(strings.TrimSpace(login))
	if cleanLogin == "" {
		return nil, errors.New("benutzername oder e-mail darf nicht leer sein")
	}
	row := s.db.QueryRow(
		`SELECT `+userSelectCols+` FROM users 
		 WHERE LOWER(email) = ? 
		    OR (username != '' AND LOWER(username) = ?) 
		    OR LOWER(display_name) = ?
		    OR (INSTR(email, '@') > 0 AND LOWER(SUBSTR(email, 1, INSTR(email, '@') - 1)) = ?)
		 LIMIT 1`,
		cleanLogin, cleanLogin, cleanLogin, cleanLogin,
	)
	return scanUser(row)
}

// EnsureDemoAccounts seeds admin/admin and user/user accounts for demo evaluation
// Demo accounts keep the same IDs across resets, so the sessions of people trying the demo stay valid
// when the database is reset underneath them.
const (
	DemoAdminID = "usr_demo_admin"
	DemoUserID  = "usr_demo_user"
)

func (s *Store) EnsureDemoAccounts() error {
	s.initMu.Lock()
	defer s.initMu.Unlock()

	adminHash, err := auth.HashPassword("admin")
	if err != nil {
		return err
	}
	userHash, err := auth.HashPassword("user")
	if err != nil {
		return err
	}

	// 1. Admin user (admin / admin)
	adminCreated := false
	adminUser, err := s.GetUserByLogin("admin")
	if err != nil || adminUser == nil {
		adminUser, err = s.createUserWithID(DemoAdminID, "admin@mindsift.local", "admin", adminHash, "Admin", "admin")
		if err != nil {
			return fmt.Errorf("failed to create demo admin: %w", err)
		}
		adminCreated = true
	} else {
		_ = s.UpdateUserPassword(adminUser.ID, adminHash)
		_, _ = s.db.Exec(`UPDATE users SET is_active = 1, role = 'admin' WHERE id = ?`, adminUser.ID)
	}

	// 2. Regular user (user / user)
	normalUser, err := s.GetUserByLogin("user")
	if err != nil || normalUser == nil {
		normalUser, err = s.createUserWithID(DemoUserID, "user@mindsift.local", "user", userHash, "User", "member")
		if err != nil {
			return fmt.Errorf("failed to create demo user: %w", err)
		}
	} else {
		_ = s.UpdateUserPassword(normalUser.ID, userHash)
		_, _ = s.db.Exec(`UPDATE users SET is_active = 1 WHERE id = ?`, normalUser.ID)
	}

	// 3. Sample data for the admin, partly shared with the demo user (only on first start). Both accounts
	// share an organization so they can see each other in the default sharing mode.
	if adminCreated {
		if org, err := s.CreateOrganization("Demo"); err == nil {
			_ = s.SetUserOrganization(adminUser.ID, org.ID)
			_ = s.SetUserOrganization(normalUser.ID, org.ID)
		}
		_ = s.SeedStarterContent(adminUser)
		s.seedDemoShares(adminUser, normalUser)
	}

	return nil
}

func (s *Store) GetUserByID(id string) (*domain.User, error) {
	row := s.db.QueryRow(
		`SELECT `+userSelectCols+` FROM users WHERE id = ?`,
		id,
	)
	return scanUser(row)
}

func (s *Store) GetFirstUser() (*domain.User, error) {
	row := s.db.QueryRow(
		`SELECT ` + userSelectCols + ` FROM users ORDER BY created_at ASC LIMIT 1`,
	)
	return scanUser(row)
}

func (s *Store) GetAllUsers() ([]domain.User, error) {
	rows, err := s.db.Query(
		`SELECT ` + userSelectCols + ` FROM users ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	users := make([]domain.User, 0)
	for rows.Next() {
		if u, err := scanUser(rows); err == nil {
			users = append(users, *u)
		}
	}
	_ = rows.Close()
	return users, nil
}

func (s *Store) UpdateUser(
	userID string,
	displayName, email, role *string,
	isActive *bool,
	discordWebhookURL *string,
	notifyBeforeMinutes *int,
) (*domain.User, error) {
	return s.UpdateUserFull(userID, displayName, email, role, isActive, nil, nil, discordWebhookURL, nil, notifyBeforeMinutes, nil)
}

func (s *Store) UpdateUserFull(
	userID string,
	displayName, email, role *string,
	isActive *bool,
	alarmChannels *[]string,
	alarmEmail, discordWebhookURL, customWebhookURL *string,
	notifyBeforeMinutes *int,
	avatarURL *string,
) (*domain.User, error) {
	u, err := s.GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	if displayName != nil {
		u.DisplayName = strings.TrimSpace(*displayName)
	}
	if email != nil {
		u.Email = strings.ToLower(strings.TrimSpace(*email))
	}
	if role != nil && (*role == "admin" || *role == "member") {
		u.Role = *role
	}
	if isActive != nil {
		u.IsActive = *isActive
	}
	if alarmChannels != nil {
		u.AlarmChannels = parseAlarmChannels(strings.Join(*alarmChannels, ","))
	}
	if alarmEmail != nil {
		u.AlarmEmail = strings.TrimSpace(*alarmEmail)
	}
	if discordWebhookURL != nil {
		u.DiscordWebhookURL = strings.TrimSpace(*discordWebhookURL)
	}
	if customWebhookURL != nil {
		u.CustomWebhookURL = strings.TrimSpace(*customWebhookURL)
	}
	if notifyBeforeMinutes != nil {
		u.NotifyBeforeMinutes = *notifyBeforeMinutes
	}
	if avatarURL != nil {
		u.AvatarURL = strings.TrimSpace(*avatarURL)
	}
	if (role != nil && *role != u.Role) || (isActive != nil && !*isActive && u.IsActive) {
		u.TokenVersion++
	}
	activeInt := 0
	if u.IsActive {
		activeInt = 1
	}
	channelsStr := strings.Join(u.AlarmChannels, ",")
	_, err = s.db.Exec(
		`UPDATE users SET display_name = ?, email = ?, role = ?, is_active = ?, token_version = ?, alarm_channels = ?, alarm_email = ?, discord_webhook_url = ?, custom_webhook_url = ?, notify_before_minutes = ?, avatar_url = ? WHERE id = ?`,
		u.DisplayName, u.Email, u.Role, activeInt, u.TokenVersion, channelsStr, u.AlarmEmail, u.DiscordWebhookURL, u.CustomWebhookURL, u.NotifyBeforeMinutes, u.AvatarURL, userID,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Store) UpdateUserPassword(userID, passwordHash string) error {
	_, err := s.db.Exec(`UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?`, passwordHash, userID)
	return err
}

func (s *Store) DeleteUser(userID string) error {
	// Remove owned data properly first (other people's tasks in the user's lists stay theirs)
	if err := s.PurgeUserData(userID); err != nil {
		return err
	}
	if err := s.execInTx(
		stmt(`DELETE FROM sessions WHERE user_id = ?`, userID),
		stmt(`DELETE FROM task_assignees WHERE user_id = ?`, userID),
		stmt(`DELETE FROM password_reset_tokens WHERE user_id = ?`, userID),
		stmt(`DELETE FROM users WHERE id = ?`, userID),
	); err != nil {
		return err
	}
	// Shares pointing at the deleted account are no longer visible to anyone
	s.pruneSharingNow()
	return nil
}

// RevokeAllUserTokens increments the user's token_version, instantly invalidating all existing JWTs for that user
func (s *Store) RevokeAllUserTokens(userID string) error {
	return s.execInTx(
		stmt(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`, userID),
		stmt(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''`, nowUTC(), userID),
	)
}

// --- USER INVITES ---

// MaxInviteUses caps how many accounts one invite link can create.
const MaxInviteUses = 1000

func (s *Store) CreateUserInvite(createdBy, email, role, orgID string, validDays, maxUses int) (*domain.UserInvite, error) {
	if role != "admin" && role != "member" {
		role = "member"
	}
	if validDays <= 0 || validDays > 365 {
		validDays = 7
	}
	if maxUses < 1 {
		maxUses = 1
	}
	if maxUses > MaxInviteUses {
		maxUses = MaxInviteUses
	}
	if maxUses > 1 && strings.TrimSpace(email) != "" {
		return nil, errors.New("Ein Einladungslink für mehrere Personen kann nicht an eine E-Mail-Adresse gebunden werden")
	}
	code := newInviteCode()
	now := time.Now().UTC()
	inv := &domain.UserInvite{
		ID:             domain.NewID("inv"),
		Code:           code,
		Email:          strings.ToLower(strings.TrimSpace(email)),
		Role:           role,
		OrganizationID: strings.TrimSpace(orgID),
		CreatedBy:      createdBy,
		ExpiresAt:      now.AddDate(0, 0, validDays).Format(time.RFC3339),
		CreatedAt:      now.Format(time.RFC3339),
		MaxUses:        maxUses,
	}
	_, err := s.db.Exec(
		`INSERT INTO user_invites (id, code, email, role, organization_id, created_by, expires_at, used_by, created_at, max_uses, use_count)
		 VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0)`,
		inv.ID, inv.Code, inv.Email, inv.Role, inv.OrganizationID, inv.CreatedBy, inv.ExpiresAt, inv.CreatedAt, inv.MaxUses,
	)
	if err != nil {
		return nil, err
	}
	return inv, nil
}

func (s *Store) GetUserInvites() ([]domain.UserInvite, error) {
	rows, err := s.db.Query(
		`SELECT i.id, i.code, i.email, i.role, i.organization_id, COALESCE(o.name, ''), i.created_by, i.expires_at, i.used_by, i.created_at,
		        i.max_uses, i.use_count
		 FROM user_invites i
		 LEFT JOIN organizations o ON o.id = i.organization_id
		 ORDER BY i.created_at DESC`,
	)
	if err != nil {
		return []domain.UserInvite{}, err
	}
	defer rows.Close()

	invites := make([]domain.UserInvite, 0)
	for rows.Next() {
		var inv domain.UserInvite
		if err := rows.Scan(&inv.ID, &inv.Code, &inv.Email, &inv.Role, &inv.OrganizationID, &inv.OrganizationName, &inv.CreatedBy, &inv.ExpiresAt, &inv.UsedBy, &inv.CreatedAt, &inv.MaxUses, &inv.UseCount); err == nil {
			invites = append(invites, inv)
		}
	}
	return invites, nil
}

// newInviteCode returns INV- plus 100 random bits in Base32, grouped for typing:
// INV-ABCDE-FGHIJ-KLMNO-PQRST (FLAW-32).
func newInviteCode() string {
	b := make([]byte, 13)
	_, _ = rand.Read(b)
	raw := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)[:20]
	return "INV-" + raw[0:5] + "-" + raw[5:10] + "-" + raw[10:15] + "-" + raw[15:20]
}

func (s *Store) GetUserInviteByCode(code string) (*domain.UserInvite, error) {
	return s.getUserInvite(`UPPER(code) = ?`, strings.ToUpper(strings.TrimSpace(code)))
}

// GetUserInviteByID: a still usable invite by its id (e.g. to send it by mail).
func (s *Store) GetUserInviteByID(id string) (*domain.UserInvite, error) {
	return s.getUserInvite(`id = ?`, id)
}

func (s *Store) getUserInvite(where string, arg string) (*domain.UserInvite, error) {
	var inv domain.UserInvite
	err := s.db.QueryRow(
		`SELECT id, code, email, role, organization_id, created_by, expires_at, used_by, created_at, max_uses, use_count
		 FROM user_invites WHERE `+where,
		arg,
	).Scan(&inv.ID, &inv.Code, &inv.Email, &inv.Role, &inv.OrganizationID, &inv.CreatedBy, &inv.ExpiresAt, &inv.UsedBy, &inv.CreatedAt, &inv.MaxUses, &inv.UseCount)
	if err != nil {
		return nil, errors.New("Ungültiger Einladungscode")
	}
	if inv.UseCount >= inv.MaxUses {
		if inv.MaxUses > 1 {
			return nil, errors.New("Dieser Einladungslink ist bereits voll ausgeschöpft")
		}
		return nil, errors.New("Dieser Einladungscode wurde bereits eingelöst")
	}
	if exp, err := time.Parse(time.RFC3339, inv.ExpiresAt); err == nil && time.Now().UTC().After(exp) {
		return nil, errors.New("Dieser Einladungscode ist abgelaufen")
	}
	return &inv, nil
}

// ClaimUserInvite reserves one use of an invite before the account is created, so registrations with
// the same code can never use it more often than allowed, even at the same moment (FLAW-40). The
// returned marker goes to FinishUserInvite or ReleaseUserInvite.
func (s *Store) ClaimUserInvite(inviteID string) (string, error) {
	res, err := s.db.Exec(`UPDATE user_invites SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses`, inviteID)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return "", errors.New("Dieser Einladungscode wurde bereits eingelöst")
	}
	return domain.NewID("claim"), nil
}

// FinishUserInvite records the new account on a single-use invite (links for several people only count).
func (s *Store) FinishUserInvite(inviteID, claim, userID string) error {
	_, err := s.db.Exec(`UPDATE user_invites SET used_by = ? WHERE id = ? AND max_uses = 1`, userID, inviteID)
	return err
}

// ReleaseUserInvite gives the reserved use back when the account could not be created.
func (s *Store) ReleaseUserInvite(inviteID, claim string) {
	_, _ = s.db.Exec(`UPDATE user_invites SET use_count = use_count - 1 WHERE id = ? AND use_count > 0`, inviteID)
}

// BindUserInviteEmail ties a single-use invite to the address it is sent to.
func (s *Store) BindUserInviteEmail(inviteID, email string) error {
	_, err := s.db.Exec(`UPDATE user_invites SET email = ? WHERE id = ? AND max_uses = 1 AND email = ''`,
		strings.ToLower(strings.TrimSpace(email)), inviteID)
	return err
}

func (s *Store) DeleteUserInvite(inviteID string) error {
	_, err := s.db.Exec(`DELETE FROM user_invites WHERE id = ?`, inviteID)
	return err
}
