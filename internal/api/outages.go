package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
)

// outages is the circuit breaker of one run of a background job (the notification job with its digests
// and daily summaries, the alarm ticker). The jobs serve their recipients one after another and send
// synchronously, so a mail server that does not answer used to hold up everyone after the first
// recipient by its timeout (SMTP: up to 30 s to connect, 60 s for the dialogue), and the next run too.
// Once a target did not answer or refused the connection, the rest of the run skips it: the channel
// counts as not delivered (errTargetSkipped), so the retry bookkeeping of each job sends it again in a
// later run, but it is no failed attempt of the recipient, who was never tried. A later run tries the
// target again, so at most one recipient per run and target waits for the timeout.
//
// Targets: "email" is the one mail server; Discord and own webhooks go by the host of their URL (all
// Discord webhooks share discord.com, own webhooks of different people mostly differ). Push goes to the
// devices' push services one by one and is not covered.
//
// A run belongs to one goroutine; outages is not safe for concurrent use. A nil *outages skips nothing.
type outages struct {
	down map[string]error
}

// errTargetSkipped: the channel was not tried because its target failed earlier in the run.
var errTargetSkipped = errors.New("target unreachable earlier in this run, skipped")

// send runs the delivery to target unless the target is down in this run; a connection or timeout
// error marks it down.
func (o *outages) send(target string, deliver func() error) error {
	if o == nil {
		return deliver()
	}
	if cause := o.down[target]; cause != nil {
		return fmt.Errorf("%w (%s: %v)", errTargetSkipped, target, cause)
	}
	err := deliver()
	if unreachable(err) {
		if o.down == nil {
			o.down = map[string]error{}
		}
		o.down[target] = err
		slog.Warn("Delivery target unreachable, skipped for the rest of this run", "target", target, "error", err)
	}
	return err
}

// skipped reports whether err only says the channel was skipped by the circuit breaker.
func skipped(err error) bool { return errors.Is(err, errTargetSkipped) }

// unreachable: the error says the target cannot be reached at all (refused or failed connection, name
// not resolved, no answer in time), not that it refused this one message (an SMTP or HTTP status). Only
// these trip the circuit breaker: a refused recipient says nothing about the next one.
func unreachable(err error) bool {
	if err == nil {
		return false
	}
	var op *net.OpError
	var dns *net.DNSError
	var ne net.Error
	return errors.As(err, &op) || errors.As(err, &dns) || (errors.As(err, &ne) && ne.Timeout()) ||
		errors.Is(err, os.ErrDeadlineExceeded) || errors.Is(err, context.DeadlineExceeded)
}

// webhookTarget: the circuit breaker's target for a Discord or own webhook, its host.
func webhookTarget(raw string) string {
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		return "host:" + strings.ToLower(u.Host)
	}
	return "url:" + raw
}
