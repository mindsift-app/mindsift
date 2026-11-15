package cli

import (
	"path/filepath"

	"github.com/mindsift-app/mindsift/internal/clock"
)

// check runs SQLite's integrity and foreign key checks; with --backup it first writes a snapshot of the
// database where the daily backups go (backups/system next to the database, same name pattern), so the
// administration lists it and the retention period removes it like the others.
func (c *command) check(args []string) error {
	p, err := c.parseFlags(args, flagSpec{bools: []string{"backup"}})
	if err != nil {
		return err
	}
	if len(p.args) > 0 {
		return usageErr("unknown argument %q for check", p.args[0])
	}
	backup := p.bools["backup"]
	if backup {
		if err := c.refuseInDemo(); err != nil {
			return err
		}
	}
	if err := c.open(); err != nil {
		return err
	}
	res := map[string]any{}
	if backup {
		// The file name carries the server's date and time (its time zone setting), as the scheduler writes it
		if sys, err := c.store.GetSystemSettings(); err == nil && sys.TimeZone != nil {
			_, _ = clock.Apply(*sys.TimeZone)
		}
		dir := filepath.Join(filepath.Dir(c.env.DatabasePath), "backups", "system")
		name, err := c.store.WriteSystemSnapshot(dir, clock.Now())
		if err != nil {
			return err
		}
		path := filepath.Join(dir, name)
		res["backup"] = path
		if !c.json {
			c.printf("Backup written: %s\n", path)
		}
	}
	problems, err := c.store.IntegrityProblems()
	if err != nil {
		return err
	}
	res["ok"] = len(problems) == 0
	res["problems"] = append([]string{}, problems...)
	if c.json {
		c.writeJSON(res)
	} else if len(problems) == 0 {
		c.printf("Database %s: ok (integrity_check, foreign_key_check)\n", c.env.DatabasePath)
	} else {
		c.printf("Database %s: %d problems found\n", c.env.DatabasePath, len(problems))
		for _, pr := range problems {
			c.printf("  %s\n", pr)
		}
	}
	if len(problems) > 0 {
		return &cmdError{ExitFailed, "problems", ""} // reported above
	}
	return nil
}
