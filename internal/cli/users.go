package cli

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/mindsift-app/mindsift/internal/api"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// userInfo is an account as the command line shows it.
type userInfo struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	TOTP        bool   `json:"totp"`
	Passkeys    bool   `json:"passkeys"`
	Disabled    bool   `json:"disabled"`
	Pending     bool   `json:"pendingApproval"`
	CreatedAt   string `json:"createdAt"`
	LastSignIn  string `json:"lastSignIn"`
}

func (c *command) info(u *domain.User) userInfo {
	return userInfo{ID: u.ID, Username: u.Username, Email: u.Email, DisplayName: u.DisplayName, Role: u.Role,
		TOTP: c.store.TOTPActive(u.ID), Passkeys: c.store.HasPasskeys(u.ID), Disabled: !u.IsActive, CreatedAt: u.CreatedAt}
}

func (c *command) usersList(args []string) error {
	p, err := c.parseFlags(args, flagSpec{})
	if err != nil {
		return err
	}
	if len(p.args) > 0 {
		return usageErr("unknown argument %q for users", p.args[0])
	}
	if err := c.open(); err != nil {
		return err
	}
	users, err := c.store.GetAllUsers()
	if err != nil {
		return err
	}
	signIns, err := c.store.LastSignIns()
	if err != nil {
		return err
	}
	pending := c.store.PendingRegistrationIDs()
	out := make([]userInfo, len(users))
	for i := range users {
		out[i] = c.info(&users[i])
		out[i].Pending = pending[users[i].ID]
		out[i].LastSignIn = signIns[users[i].ID]
	}
	if c.json {
		c.writeJSON(out)
		return nil
	}
	tw := tabwriter.NewWriter(c.env.Stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(tw, "NAME\tEMAIL\tROLE\t2FA\tSTATUS\tCREATED\tLAST SIGN-IN")
	for _, u := range out {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", u.Username, dash(u.Email), u.Role, secondFactors(u),
			status(u), shortTime(u.CreatedAt), dash(shortTime(u.LastSignIn)))
	}
	return tw.Flush()
}

func dash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// shortTime: an RFC 3339 time to the minute ("2026-11-15 09:30", UTC as stored).
func shortTime(t string) string {
	if len(t) >= 16 {
		return strings.Replace(t[:16], "T", " ", 1)
	}
	return t
}

func secondFactors(u userInfo) string {
	switch {
	case u.TOTP && u.Passkeys:
		return "app+passkey"
	case u.TOTP:
		return "app"
	case u.Passkeys:
		return "passkey"
	}
	return "-"
}

func status(u userInfo) string {
	switch {
	case u.Pending:
		return "pending"
	case u.Disabled:
		return "disabled"
	}
	return "active"
}

// findUser looks an account up by its exact username, email address or ID (not the looser matching of
// the sign-in, so a typo never picks another account).
func (c *command) findUser(name string) (*domain.User, error) {
	users, err := c.store.GetAllUsers()
	if err != nil {
		return nil, err
	}
	want := strings.ToLower(strings.TrimSpace(name))
	for i := range users {
		u := &users[i]
		if u.ID == name || (u.Username != "" && strings.ToLower(u.Username) == want) || (u.Email != "" && strings.ToLower(u.Email) == want) {
			return u, nil
		}
	}
	return nil, notFound(name)
}

// otherActiveAdmins counts the active administrators besides userID.
func (c *command) otherActiveAdmins(userID string) (int, error) {
	users, err := c.store.GetAllUsers()
	if err != nil {
		return 0, err
	}
	n := 0
	for _, u := range users {
		if u.ID != userID && u.IsActive && u.Role == domain.RoleAdmin {
			n++
		}
	}
	return n, nil
}

// passwordAlphabet: letters and digits without the ones that look alike (0/O, 1/l/I)
const passwordAlphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// oneTimePassword: four groups of five characters, about 115 bits, easy to read out and type.
func oneTimePassword() (string, error) {
	var b strings.Builder
	max := big.NewInt(int64(len(passwordAlphabet)))
	for i := 0; i < 20; i++ {
		if i > 0 && i%5 == 0 {
			b.WriteByte('-')
		}
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte(passwordAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// checkPassword applies the rule of the administration, with the message in English.
func checkPassword(pw string) error {
	switch err := auth.ValidatePassword(pw); {
	case errors.Is(err, auth.ErrPasswordTooShort):
		return usageErr("the password is too short: at least %d characters, not only spaces", auth.MinPasswordLength)
	case errors.Is(err, auth.ErrPasswordTooLong):
		return usageErr("the password is too long: at most %d characters", auth.MaxPasswordLength)
	case err != nil:
		return usageErr("the password is not accepted")
	}
	return nil
}

// readPassword: from a file or stdin, without the line break at the end; "" when neither is given.
func (c *command) readPassword(p *parsed) (string, error) {
	file, fromStdin := p.values["password-file"], p.bools["password-stdin"]
	if file != "" && fromStdin {
		return "", usageErr("give either --password-file or --password-stdin")
	}
	var data []byte
	var err error
	switch {
	case file != "":
		data, err = os.ReadFile(file)
	case fromStdin:
		data, err = io.ReadAll(io.LimitReader(c.env.Stdin, auth.MaxPasswordLength*4+2))
	default:
		return "", nil
	}
	if err != nil {
		return "", usageErr("reading the password: %v", err)
	}
	pw := strings.TrimRight(string(data), "\r\n")
	if err := checkPassword(pw); err != nil {
		return "", err
	}
	return pw, nil
}

// record writes a change to the audit log; the running server reads it from there (api/cli_support.go).
func (c *command) record(action string, target storage.AuditEntry, details any) {
	target.Action, target.ActorKind, target.Source = action, storage.AuditActorCLI, storage.AuditSourceCLI
	if err := c.store.RecordAudit(target, details); err != nil {
		_, _ = fmt.Fprintln(c.env.Stderr, "Warning: the change is done, but writing it to the audit log failed:", err)
	}
}

func userTarget(u *domain.User) storage.AuditEntry {
	return storage.AuditEntry{TargetKind: storage.AuditTargetUser, TargetID: u.ID, TargetName: u.Username}
}

func (c *command) usersCreate(args []string) error {
	p, err := c.parseFlags(args, flagSpec{bools: []string{"admin", "password-stdin"}, values: []string{"email", "display-name", "password-file"}})
	if err != nil {
		return err
	}
	name, err := p.oneName("users create")
	if err != nil {
		return err
	}
	if err := c.refuseInDemo(); err != nil {
		return err
	}
	username := strings.ToLower(name)
	if !storage.ValidUsername(username) {
		return usageErr("%q is not a valid username: 2 to 32 characters, lower case letters, digits, dot, dash and underscore, starting and ending with a letter or digit", name)
	}
	email := domain.NormalizeEmail(p.values["email"])
	if email == "" {
		return usageErr("--email is required (the administration asks for an address as well)")
	}
	if !api.ValidEmail(email) {
		return usageErr("%q is not a valid email address (a bare address such as anna@example.com)", p.values["email"])
	}
	password, err := c.readPassword(p)
	if err != nil {
		return err
	}
	generated := password == ""
	if generated {
		if password, err = oneTimePassword(); err != nil {
			return err
		}
	}
	role := domain.RoleMember
	if p.bools["admin"] {
		role = domain.RoleAdmin
	}
	if err := c.open(); err != nil {
		return err
	}
	if taken, err := c.store.UsernameTaken(username); err != nil {
		return err
	} else if taken {
		return refused("username_taken", "the username %q is taken", username)
	}
	if c.store.EmailInUse(email) {
		return refused("email_taken", "an account with the email address %s exists", email)
	}
	count, err := c.store.CountUsers()
	if err != nil {
		return err
	}
	// The first account administers the server; the setup wizard's other questions follow after its
	// first sign-in, as for ADMIN_USER
	if count == 0 && role != domain.RoleAdmin {
		return refused("first_admin", "there is no account yet: the first one must be an administrator (--admin)")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	u, err := c.store.CreateUserWithUsername(email, username, hash, p.values["display-name"], role)
	if errors.Is(err, storage.ErrEmailTaken) {
		return refused("email_taken", "an account with the email address %s exists", email)
	} else if err != nil {
		return err
	}
	if count == 0 {
		if err := c.store.SetSetupPending(true); err != nil {
			_, _ = fmt.Fprintln(c.env.Stderr, "Warning: marking the setup as unfinished failed:", err)
		}
	}
	c.record(storage.AuditAccountCreated, userTarget(u), map[string]string{"role": role})

	if c.json {
		res := map[string]any{"created": true, "user": c.info(u)}
		if generated {
			res["oneTimePassword"] = password
		}
		c.writeJSON(res)
		return nil
	}
	c.printf("Created account %s (%s, role %s, id %s).\n", u.Username, u.Email, u.Role, u.ID)
	if u.Username != username {
		c.printf("Note: %q was taken in the meantime, the account got %q.\n", username, u.Username)
	}
	if generated {
		c.printf("One-time password: %s\n", password)
		c.printf("It is shown only now. Hand it over safely; the person should set an own password in the account settings after signing in.\n")
	}
	return nil
}

func (c *command) usersDelete(args []string) error {
	p, err := c.parseFlags(args, flagSpec{bools: []string{"yes"}})
	if err != nil {
		return err
	}
	name, err := p.oneName("users delete")
	if err != nil {
		return err
	}
	if err := c.refuseInDemo(); err != nil {
		return err
	}
	if err := c.open(); err != nil {
		return err
	}
	u, err := c.findUser(name)
	if err != nil {
		return err
	}
	if u.Role == domain.RoleAdmin {
		if n, err := c.otherActiveAdmins(u.ID); err != nil {
			return err
		} else if n == 0 {
			return refused("last_admin", "%s is the last active administrator: make another account admin first (mindsift make-admin <name>)", u.Username)
		}
	}
	content, err := c.store.CountAccountContent(u.ID)
	if err != nil {
		return err
	}
	if !p.bools["yes"] {
		if c.json {
			c.writeJSON(map[string]any{"deleted": false, "dryRun": true, "user": c.info(u), "content": content})
			return nil
		}
		c.printf("Would delete the account %s (%s, role %s, created %s) with:\n", u.Username, dash(u.Email), u.Role, shortTime(u.CreatedAt))
		c.printf("  %d notes (%d shared with others), %d tasks, %d task lists (%d shared), %d lists (%d shared)\n",
			content.Notes, content.SharedNotes, content.Tasks, content.TaskLists, content.SharedTaskLists, content.Lists, content.SharedLists)
		c.printf("Shared notes and lists disappear for the people they were shared with. Tasks of others in the account's\n")
		c.printf("task lists stay theirs (%d). The account's backups are kept for the backup retention period\n", content.OthersTasks)
		c.printf("(administration, Backups, deleted accounts). Nothing was deleted; run again with --yes to delete.\n")
		return nil
	}
	cfg := &config.Config{DatabasePath: c.env.DatabasePath}
	if err := api.NewAccountTools(cfg, c.store).DeleteAccount(u); err != nil {
		return err
	}
	c.record(storage.AuditAccountDeleted, userTarget(u), content)
	if c.json {
		c.writeJSON(map[string]any{"deleted": true, "user": c.info(u), "content": content})
		return nil
	}
	c.printf("Deleted the account %s (%s) with %d notes, %d tasks, %d task lists and %d lists.\n",
		u.Username, dash(u.Email), content.Notes, content.Tasks, content.TaskLists, content.Lists)
	return nil
}

func (c *command) resetPassword(args []string) error {
	p, err := c.parseFlags(args, flagSpec{bools: []string{"disable-2fa"}})
	if err != nil {
		return err
	}
	name, err := p.oneName("reset-password")
	if err != nil {
		return err
	}
	if err := c.refuseInDemo(); err != nil {
		return err
	}
	if err := c.open(); err != nil {
		return err
	}
	u, err := c.findUser(name)
	if err != nil {
		return err
	}
	password, err := oneTimePassword()
	if err != nil {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	if err := c.store.ResetPassword(u.ID, hash); err != nil {
		return err
	}
	disable2FA := p.bools["disable-2fa"]
	if disable2FA {
		if err := c.store.ResetMFA(u.ID); err != nil {
			c.record(storage.AuditAccountPasswordReset, userTarget(u), nil)
			return fmt.Errorf("the new password is set, but removing the second factors failed: %w", err)
		}
		c.record(storage.AuditAccountPasswordReset, userTarget(u), map[string]bool{"secondFactorsRemoved": true})
	} else {
		c.record(storage.AuditAccountPasswordReset, userTarget(u), nil)
	}
	if c.json {
		c.writeJSON(map[string]any{"reset": true, "user": c.info(u), "oneTimePassword": password, "secondFactorsRemoved": disable2FA})
		return nil
	}
	c.printf("New password for %s (%s): %s\n", u.Username, dash(u.Email), password)
	c.printf("It is shown only now. Every session of the account is signed out.\n")
	if disable2FA {
		c.printf("App codes, passkeys, recovery codes and trusted devices are removed: the account signs in with the password alone.\n")
	} else if c.store.TOTPActive(u.ID) || c.store.HasPasskeys(u.ID) {
		c.printf("The account still asks for its second factor; add --disable-2fa if that is lost as well.\n")
	}
	c.printf("The person should set an own password in the account settings after signing in.\n")
	return nil
}

func (c *command) makeAdmin(args []string) error {
	p, err := c.parseFlags(args, flagSpec{bools: []string{"revoke"}})
	if err != nil {
		return err
	}
	name, err := p.oneName("make-admin")
	if err != nil {
		return err
	}
	if err := c.refuseInDemo(); err != nil {
		return err
	}
	if err := c.open(); err != nil {
		return err
	}
	u, err := c.findUser(name)
	if err != nil {
		return err
	}
	revoke := p.bools["revoke"]
	role := domain.RoleAdmin
	if revoke {
		role = domain.RoleMember
	}
	if u.Role == role || (revoke && u.Role != domain.RoleAdmin) {
		if c.json {
			c.writeJSON(map[string]any{"changed": false, "user": c.info(u)})
		} else {
			c.printf("%s has the role %s; nothing changed.\n", u.Username, u.Role)
		}
		return nil
	}
	if revoke && u.Role == domain.RoleAdmin {
		if n, err := c.otherActiveAdmins(u.ID); err != nil {
			return err
		} else if n == 0 {
			return refused("last_admin", "%s is the last active administrator: make another account admin first", u.Username)
		}
	}
	// As in the administration; every request reads the role from the database, so it counts at once
	updated, err := c.store.UpdateUser(u.ID, nil, nil, &role, nil, nil, nil)
	if err != nil {
		return err
	}
	c.record(storage.AuditAccountRoleChanged, userTarget(updated), map[string]string{"from": u.Role, "to": role})
	if c.json {
		c.writeJSON(map[string]any{"changed": true, "user": c.info(updated)})
		return nil
	}
	c.printf("%s now has the role %s (was %s); it counts from the next request on.\n", updated.Username, role, u.Role)
	if !updated.IsActive {
		c.printf("Note: the account is disabled; enable it in the administration to sign in.\n")
	}
	return nil
}
