// Package clock holds the server's time zone: one zone per installation, used wherever a time is meant
// for people (calendar days, due dates, alarms, the daily summary, backup times, dates in mails).
//
// The zone in effect is the admin's setting, else the TZ environment variable, else UTC. It is kept in
// an atomic value, so a change in the administration applies at once without touching time.Local (which
// other goroutines read unguarded). Instants (timeouts, expiry, timestamps stored as UTC) keep using
// time.Now(); only calendar arithmetic goes through In, Now and Today.
package clock

import (
	"errors"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

// Where the zone in effect comes from
const (
	SourceSetting = "setting" // the administration's system setting
	SourceEnv     = "env"     // the TZ environment variable
	SourceDefault = "default" // neither: UTC
)

// Zone is the zone in effect and where it comes from.
type Zone struct {
	Loc    *time.Location
	Source string
}

// Name is the IANA name of the zone ("Europe/Berlin", "UTC").
func (z Zone) Name() string { return z.Loc.String() }

var current atomic.Pointer[Zone]

// Current is the zone in effect; UTC until Set or Apply ran.
func Current() Zone {
	if z := current.Load(); z != nil {
		return *z
	}
	return Zone{Loc: time.UTC, Source: SourceDefault}
}

// Location is the server's time zone.
func Location() *time.Location { return Current().Loc }

// Now is the current instant in the server's time zone.
func Now() time.Time { return time.Now().In(Location()) }

// In converts t to the server's time zone, for calendar arithmetic on a passed-in instant.
func In(t time.Time) time.Time { return t.In(Location()) }

// Today is the server's calendar day of now as YYYY-MM-DD.
func Today() string { return Now().Format("2006-01-02") }

// Set makes z the zone in effect.
func Set(z Zone) {
	if z.Loc == nil {
		z = Zone{Loc: time.UTC, Source: SourceDefault}
	}
	current.Store(&z)
}

// UseInTest puts loc in effect until the test ends (tb is a *testing.T or *testing.B). Tests that call it
// must not run in parallel with others that read the zone.
func UseInTest(tb interface{ Cleanup(func()) }, loc *time.Location) {
	prev := Current()
	Set(Zone{Loc: loc, Source: SourceSetting})
	tb.Cleanup(func() { Set(prev) })
}

// ErrInvalidZone: the name is not an IANA time zone this build knows.
var ErrInvalidZone = errors.New("unknown time zone")

// Load reads an IANA zone name. Empty, "Local" and unknown names are refused: "Local" would follow the
// machine instead of the setting.
func Load(name string) (*time.Location, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "Local" || len(name) > 64 {
		return nil, ErrInvalidZone
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, ErrInvalidZone
	}
	return loc, nil
}

// Resolve picks the zone: setting > env (the value of TZ) > UTC. A setting or TZ value that cannot be
// read is skipped; err names the first one skipped, so the caller can log it.
func Resolve(setting, env string) (Zone, error) {
	var skipped error
	if setting = strings.TrimSpace(setting); setting != "" {
		if loc, err := Load(setting); err == nil {
			return Zone{Loc: loc, Source: SourceSetting}, nil
		}
		skipped = errors.New("time zone setting " + setting + ": " + ErrInvalidZone.Error())
	}
	// TZ may carry a leading colon (POSIX), which Go's own reading of TZ strips as well
	if env = strings.TrimPrefix(strings.TrimSpace(env), ":"); env != "" {
		if loc, err := Load(env); err == nil {
			return Zone{Loc: loc, Source: SourceEnv}, skipped
		}
		if skipped == nil {
			skipped = errors.New("TZ " + env + ": " + ErrInvalidZone.Error())
		}
	}
	return Zone{Loc: time.UTC, Source: SourceDefault}, skipped
}

// Fallback is the zone without the admin's setting: TZ, else UTC.
func Fallback() Zone {
	z, _ := Resolve("", os.Getenv("TZ"))
	return z
}

// Apply resolves the zone from the admin's setting and the TZ environment variable and puts it in effect.
func Apply(setting string) (Zone, error) {
	z, err := Resolve(setting, os.Getenv("TZ"))
	Set(z)
	return z, err
}
