// Package cli is MindSift's small command line for operators: listing and creating accounts, a new
// password for a locked-out account, the admin role, an integrity check of the database. It runs in the
// server binary (`mindsift users`, in the image `docker exec <container> mindsift users`), next to a
// server that may be running on the same database: it opens the database the way the server does,
// never migrates it, and keeps its transactions short. Changes are recorded in the audit log, which the
// running server reads to end live connections and to log them (api/cli_support.go).
package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Exit codes, for scripts.
const (
	ExitOK       = 0
	ExitFailed   = 1 // the database cannot be opened or a step failed; check: problems found
	ExitUsage    = 2 // unknown command or flag, invalid input (name, email, password)
	ExitNotFound = 3 // no such account
	ExitRefused  = 4 // taken name or email, last administrator, demo mode
)

// IsCommand reports whether args (os.Args[1:]) ask for a command rather than the server.
func IsCommand(args []string) bool {
	return len(args) > 0 && args[0] != "serve"
}

// Env is what a command reads and writes: the streams and how the database is found.
type Env struct {
	Stdout io.Writer
	Stderr io.Writer
	Stdin  io.Reader
	// DatabasePath and DemoMode as the server takes them from the environment
	DatabasePath string
	DemoMode     bool
	// BackupSecretsKey: the key check --backup puts into the backup (config.BackupSecretsKeyFromEnv)
	BackupSecretsKey []byte
}

// Main runs the command in args (os.Args[1:]) with the process's streams and environment.
func Main(args []string) int {
	dbPath := config.DatabasePathFromEnv()
	return Run(args, Env{
		Stdout:           os.Stdout,
		Stderr:           os.Stderr,
		Stdin:            os.Stdin,
		DatabasePath:     dbPath,
		DemoMode:         config.DemoModeFromEnv(),
		BackupSecretsKey: config.BackupSecretsKeyFromEnv(filepath.Dir(dbPath)),
	})
}

const usage = `MindSift command line. Without a command the binary starts the server.

Usage: mindsift <command> [arguments]

Commands:
  serve                                   start the server (the same as no command)
  users [--json]                          list the accounts
  users create <name> --email <address> [--admin] [--display-name <name>]
               [--password-file <path> | --password-stdin] [--json]
                                          create an account; without a password it gets a
                                          one-time password, printed once
  users delete <name> [--yes] [--json]    delete an account with its data; without --yes it
                                          only shows what would be deleted
  reset-password <name> [--must-change] [--revoke-keys] [--disable-2fa] [--json]
                                          new one-time password, signs out every session;
                                          --must-change: a new own password at the next sign-in
                                          before anything else; --revoke-keys also removes the
                                          API keys, AI connections (MCP) and the calendar
                                          subscription; --disable-2fa also
                                          removes app codes, passkeys and recovery codes
  make-admin <name> [--revoke] [--json]   give (or take away) the admin role
  check [--backup] [--json]               check the database (integrity, foreign keys);
                                          --backup first writes a snapshot to backups/system
  audit [--limit <n>] [--json]            the audit log, newest first (default 50 entries):
                                          who changed accounts, roles and server settings
  help                                    this text

<name> is the username, the email address or the ID of an account.
The database is found as by the server: DATABASE_URL, else DATA_DIR/mindsift.db.
Exit codes: 0 done, 1 failed or problems found, 2 invalid input, 3 account not found,
4 refused (name or email taken, last administrator, demo mode).
`

// cmdError is a failure with its exit code and a short code for --json.
type cmdError struct {
	exit int
	code string
	msg  string
}

func (e *cmdError) Error() string { return e.msg }

func usageErr(format string, a ...any) error {
	return &cmdError{ExitUsage, "invalid", fmt.Sprintf(format, a...)}
}
func notFound(name string) error {
	return &cmdError{ExitNotFound, "not_found", fmt.Sprintf("no account %q (give the username, the email address or the ID)", name)}
}
func refused(code, format string, a ...any) error {
	return &cmdError{ExitRefused, code, fmt.Sprintf(format, a...)}
}

// Run runs one command and returns the exit code.
func Run(args []string, env Env) int {
	// Warnings of the store go to stderr, so stdout stays the command's answer (JSON for scripts)
	slog.SetDefault(slog.New(slog.NewTextHandler(env.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn})))
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		_, _ = fmt.Fprint(env.Stdout, usage)
		return ExitOK
	}
	c := &command{env: env}
	for _, a := range args {
		c.json = c.json || a == "--json"
	}
	err := c.run(args)
	c.close()
	if err == nil {
		return ExitOK
	}
	var ce *cmdError
	if !errors.As(err, &ce) {
		ce = &cmdError{ExitFailed, "failed", err.Error()}
	}
	if ce.msg == "" {
		return ce.exit // the command has said everything
	}
	if c.json {
		c.writeJSON(map[string]any{"error": ce.msg, "code": ce.code})
	} else {
		_, _ = fmt.Fprintln(env.Stderr, "Error:", ce.msg)
		if ce.exit == ExitUsage {
			_, _ = fmt.Fprintln(env.Stderr, "Run 'mindsift help' for the commands.")
		}
	}
	return ce.exit
}

// command holds one run: the parsed flags and the store, opened on first use.
type command struct {
	env   Env
	json  bool
	store *storage.Store
}

func (c *command) run(args []string) error {
	name, rest := args[0], args[1:]
	switch name {
	case "users":
		if len(rest) > 0 && rest[0] == "create" {
			return c.usersCreate(rest[1:])
		}
		if len(rest) > 0 && rest[0] == "delete" {
			return c.usersDelete(rest[1:])
		}
		if len(rest) > 0 && rest[0] == "list" {
			rest = rest[1:]
		}
		return c.usersList(rest)
	case "reset-password":
		return c.resetPassword(rest)
	case "make-admin":
		return c.makeAdmin(rest)
	case "check":
		return c.check(rest)
	case "audit":
		return c.audit(rest)
	}
	return usageErr("unknown command %q", name)
}

// open opens the database the server uses, as it exists: no new file, no migrations.
func (c *command) open() error {
	if c.store != nil {
		return nil
	}
	if _, err := os.Stat(c.env.DatabasePath); err != nil {
		return fmt.Errorf("no database at %s (set DATA_DIR or DATABASE_URL as for the server)", c.env.DatabasePath)
	}
	store, err := storage.NewStore(c.env.DatabasePath, storage.WithExistingSchema(), storage.WithBackupSecretsKey(c.env.BackupSecretsKey))
	if err != nil {
		return err
	}
	c.store = store
	return nil
}

func (c *command) close() {
	if c.store != nil {
		_ = c.store.Close()
	}
}

// refuseInDemo: the demo's accounts and data are reset all the time and belong to its visitors.
func (c *command) refuseInDemo() error {
	if c.env.DemoMode {
		return refused("demo", "demo mode (MINDSIFT_DEMO): the command line changes nothing in the demo")
	}
	return nil
}

func (c *command) writeJSON(v any) {
	enc := json.NewEncoder(c.env.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func (c *command) printf(format string, a ...any) {
	fmt.Fprintf(c.env.Stdout, format, a...)
}

// flagSpec: the flags a command takes; value flags take the next argument or --flag=value.
type flagSpec struct {
	bools  []string
	values []string
}

// parsed holds positional arguments and flags.
type parsed struct {
	args   []string
	bools  map[string]bool
	values map[string]string
}

// parseFlags reads args in any order; --json is known to every command.
func (c *command) parseFlags(args []string, spec flagSpec) (*parsed, error) {
	p := &parsed{bools: map[string]bool{}, values: map[string]string{}}
	isBool := map[string]bool{"json": true}
	for _, b := range spec.bools {
		isBool[b] = true
	}
	isValue := map[string]bool{}
	for _, v := range spec.values {
		isValue[v] = true
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			p.args = append(p.args, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(a, "-") || a == "-" {
			p.args = append(p.args, a)
			continue
		}
		name, value, hasValue := strings.Cut(strings.TrimLeft(a, "-"), "=")
		switch {
		case isBool[name] && !hasValue:
			p.bools[name] = true
		case isValue[name] && hasValue:
			p.values[name] = value
		case isValue[name] && i+1 < len(args):
			i++
			p.values[name] = args[i]
		case isValue[name]:
			return nil, usageErr("--%s needs a value", name)
		default:
			return nil, usageErr("unknown flag %s", a)
		}
	}
	c.json = p.bools["json"]
	return p, nil
}

// oneName: the single positional argument naming an account.
func (p *parsed) oneName(cmd string) (string, error) {
	if len(p.args) != 1 || strings.TrimSpace(p.args[0]) == "" {
		return "", usageErr("%s needs exactly one account name", cmd)
	}
	return strings.TrimSpace(p.args[0]), nil
}
