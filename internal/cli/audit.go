package cli

import (
	"fmt"
	"strconv"
	"text/tabwriter"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// audit prints the audit log of the administration, newest first. Only reads, so it may run next to
// the server and in the demo.
func (c *command) audit(args []string) error {
	p, err := c.parseFlags(args, flagSpec{values: []string{"limit"}})
	if err != nil {
		return err
	}
	if len(p.args) > 0 {
		return usageErr("unknown argument %q for audit", p.args[0])
	}
	limit := 50
	if v, ok := p.values["limit"]; ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 500 {
			return usageErr("--limit takes a number from 1 to 500")
		}
		limit = n
	}
	if err := c.open(); err != nil {
		return err
	}
	entries, err := c.store.AuditEntries(storage.AuditFilter{Limit: limit})
	if err != nil {
		return err
	}
	if c.json {
		c.writeJSON(entries)
		return nil
	}
	if len(entries) == 0 {
		c.printf("The audit log is empty.\n")
		return nil
	}
	tw := tabwriter.NewWriter(c.env.Stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(tw, "TIME (UTC)\tWHO\tACTION\tTARGET\tDETAILS")
	for _, e := range entries {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", shortTime(e.At), auditActor(e), e.Action, dash(auditTarget(e)), dash(string(e.Details)))
	}
	return tw.Flush()
}

// auditActor: the username for accounts, else the kind (cli, oidc, system).
func auditActor(e storage.AuditEntry) string {
	if e.ActorKind == storage.AuditActorUser {
		if e.ActorName != "" {
			return e.ActorName
		}
		return e.ActorID
	}
	return e.ActorKind
}

func auditTarget(e storage.AuditEntry) string {
	switch {
	case e.TargetName != "":
		return e.TargetName
	case e.TargetID != "":
		return e.TargetID
	}
	return e.TargetKind
}
