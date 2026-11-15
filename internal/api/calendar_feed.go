package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/ical"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Calendar subscription: every person can switch on one read-only iCalendar feed of their open tasks with
// a due date and subscribe to it in their calendar app (Google, Apple, Thunderbird, Outlook). The address
// /calendar/<token>.ics is the access, like a public link: no session, nothing can be written back. The
// owner routes sit among the settings routes, so API keys and MCP cannot read or create a feed
// (apikey_access.go). Tasks become events (VEVENT): calendar apps that subscribe to a feed ignore to-dos
// (VTODO), so the feed carries none. All-day tasks are DATE events, timed tasks start at the due time in
// UTC and last calendarEventMinutes. Reminders of a task become alarms at the moment MindSift itself
// would alarm; many apps ignore alarms in subscriptions, which does no harm.

const (
	// calendarEventMinutes: length of the event of a task with a due time (a due time is a moment, but an
	// event of no length is easy to miss in a calendar)
	calendarEventMinutes = 30
	// calendarRefresh: how often calendar apps are asked to fetch the feed again (REFRESH-INTERVAL,
	// X-PUBLISHED-TTL); clients cache it for calendarCacheSeconds in between
	calendarRefresh      = "PT1H"
	calendarCacheSeconds = 900
	// calendarNotesExcerpt: characters of a task's notes in the event's description
	calendarNotesExcerpt = 500
	// calendarFeedRequestsPerUser: fetches of one feed within the lock window (15 minutes) before it
	// answers 429 for a while; a calendar app fetches about once an hour, several devices included
	calendarFeedRequestsPerUser = 240
	// calendarFeedMissesPerIP: unknown tokens from one address within the lock window before that address
	// is refused for a while (the token has 256 bits; this only keeps the lookups cheap)
	calendarFeedMissesPerIP = 30
)

// calendarFeedsEnabled: CALENDAR_FEEDS if set, else the admin's switch (default on). Allowed in demo mode:
// the feed only shows the demo's tasks and goes with every reset.
func (s *Server) calendarFeedsEnabled() bool {
	if s.cfg.CalendarFeeds != nil {
		return *s.cfg.CalendarFeeds
	}
	sys, _ := s.store.GetSystemSettings()
	return sys == nil || sys.CalendarFeeds == nil || *sys.CalendarFeeds
}

// calendarFeedSealID binds a feed's sealed token to its owner (SECRETS_KEY, storage/sealed.go).
func calendarFeedSealID(userID string) string { return "calfeed:" + userID }

func calendarFeedPath(token string) string { return "/calendar/" + token + ".ics" }

// writeCalendarFeedState answers the settings: whether the server allows feeds, and the person's address.
// unreadable: a feed exists but its token no longer decrypts (SECRETS_KEY changed); a new link helps.
func (s *Server) writeCalendarFeedState(w http.ResponseWriter, userID string) {
	enabled := s.calendarFeedsEnabled()
	out := map[string]any{"enabled": enabled, "active": false, "token": nil, "url": nil}
	if f, err := s.store.CalendarFeedOf(userID); err == nil && enabled {
		out["active"] = true
		out["createdAt"] = f.CreatedAt
		if token, err := s.openSecret(calendarFeedSealID(userID), f.TokenSealed); err == nil {
			out["token"] = token
			if s.cfg.BaseURLSet {
				out["url"] = strings.TrimRight(s.cfg.BaseURL, "/") + calendarFeedPath(token)
			}
		} else {
			out["unreadable"] = true
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetCalendarFeed: GET /calendar-feed – the person's feed, if any.
func (s *Server) handleGetCalendarFeed(w http.ResponseWriter, r *http.Request) {
	s.writeCalendarFeedState(w, auth.GetUserID(r.Context()))
}

// handleSetCalendarFeed: PUT /calendar-feed – switches the feed on with a new address; an earlier address
// stops working at once.
func (s *Server) handleSetCalendarFeed(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	if !s.calendarFeedsEnabled() {
		writeError(w, http.StatusForbidden, "Kalender-Abos sind auf diesem Server ausgeschaltet")
		return
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		writeInternal(w, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	sealed, err := s.sealSecret(calendarFeedSealID(userID), token)
	if err != nil {
		writeInternal(w, err)
		return
	}
	f := &storage.CalendarFeed{UserID: userID, TokenHash: hashPublicToken(token), TokenSealed: sealed, CreatedAt: domain.NowISO()}
	if err := s.store.SaveCalendarFeed(f); err != nil {
		writeInternal(w, err)
		return
	}
	s.writeCalendarFeedState(w, userID)
}

// handleDeleteCalendarFeed: DELETE /calendar-feed – switches the feed off; the address stops working.
func (s *Server) handleDeleteCalendarFeed(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	if err := s.store.DeleteCalendarFeed(userID); err != nil {
		writeInternal(w, err)
		return
	}
	s.writeCalendarFeedState(w, userID)
}

// handleCalendarFeed: GET /calendar/{token}.ics – the feed for calendar apps. Unknown tokens, switched-off
// feeds and a server without feeds all answer the same 404. The token is looked up by its SHA-256 hash, so
// the time of the lookup says nothing about the token. The answer carries an ETag: a client that sends it
// back gets 304 while nothing changed.
func (s *Server) handleCalendarFeed(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
	w.Header().Set("Referrer-Policy", "no-referrer")
	token, ok := strings.CutSuffix(chi.URLParam(r, "file"), ".ics")
	if !ok || token == "" || len(token) > 100 || !s.calendarFeedsEnabled() {
		http.NotFound(w, r)
		return
	}
	ip := clientIPFrom(r)
	if !ip.viaProxyWithoutHeader && ip.ip != "" {
		if wait := s.loginGuard.lockedKey("calfeed-miss:" + ip.ip); wait > 0 {
			writeThrottled(w, wait)
			return
		}
	}
	feed, err := s.store.CalendarFeedByTokenHash(hashPublicToken(token))
	if err != nil {
		s.loginGuard.throttle("calfeed-miss", ip, calendarFeedMissesPerIP)
		http.NotFound(w, r)
		return
	}
	if wait := s.loginGuard.throttleKey("calfeed:"+feed.UserID, calendarFeedRequestsPerUser); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	body, err := s.calendarFeed(feed.UserID, time.Now())
	if err != nil {
		writeInternal(w, err)
		return
	}
	sum := sha256.Sum256([]byte(body))
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age="+strconv.Itoa(calendarCacheSeconds))
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="mindsift.ics"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(body))
}

// etagMatches reads an If-None-Match header ("*" or a list of tags, weak ones included).
func etagMatches(header, etag string) bool {
	for _, tag := range strings.Split(header, ",") {
		tag = strings.TrimPrefix(strings.TrimSpace(tag), "W/")
		if tag == etag || tag == "*" {
			return true
		}
	}
	return false
}

// calendarFeed builds the person's feed as of now.
func (s *Server) calendarFeed(userID string, now time.Time) (string, error) {
	tasks, err := s.store.CalendarTasks(userID, now)
	if err != nil {
		return "", err
	}
	return renderCalendarFeed(tasks, calendarFeedOptions{
		Lang:     s.userLanguage(userID),
		Loc:      clock.Location(),
		Link:     func(id string) string { return s.mcpLink("task", id) },
		Readable: s.store.ReadableMentions,
	}, now), nil
}

type calendarFeedOptions struct {
	Lang     string
	Loc      *time.Location           // the server's time zone, in which due dates are stored
	Link     func(id string) string   // the task's address in the app ("" without BASE_URL)
	Readable func(text string) string // mentions as "@Name"
}

// renderCalendarFeed writes the iCalendar text of the given tasks. now only stands in for a task's
// modification time when that cannot be read.
func renderCalendarFeed(tasks []storage.CalendarTask, o calendarFeedOptions, now time.Time) string {
	if o.Readable == nil {
		o.Readable = func(s string) string { return s }
	}
	if o.Link == nil {
		o.Link = func(string) string { return "" }
	}
	name := i18n.T(o.Lang, "MindSift – Aufgaben")
	var w ical.Writer
	w.Line("BEGIN", "VCALENDAR")
	w.Line("VERSION", "2.0")
	w.Line("PRODID", "-//MindSift//Calendar feed//EN")
	w.Line("CALSCALE", "GREGORIAN")
	w.Line("METHOD", "PUBLISH")
	w.Text("NAME", name)
	w.Text("X-WR-CALNAME", name)
	w.Text("X-WR-TIMEZONE", o.Loc.String())
	w.Line("REFRESH-INTERVAL;VALUE=DURATION", calendarRefresh)
	w.Line("X-PUBLISHED-TTL", calendarRefresh)
	for _, t := range tasks {
		writeCalendarEvent(&w, t, o, now)
	}
	w.Line("END", "VCALENDAR")
	return w.String()
}

func writeCalendarEvent(w *ical.Writer, t storage.CalendarTask, o calendarFeedOptions, now time.Time) {
	due, hasTime, ok := domain.ParseDue(t.DueDate, o.Loc)
	if !ok {
		return
	}
	created, _ := time.Parse(time.RFC3339, t.CreatedAt)
	modified := created
	for _, at := range []string{t.ChangedAt, t.UpdatedAt} {
		if changed, err := time.Parse(time.RFC3339, at); err == nil && changed.After(modified) {
			modified = changed
		}
	}
	if modified.IsZero() {
		modified = now.UTC().Truncate(24 * time.Hour)
	}
	summary := strings.TrimSpace(o.Readable(t.Content))

	w.Line("BEGIN", "VEVENT")
	w.Text("UID", t.ID+"@mindsift")
	w.Line("DTSTAMP", ical.UTC(modified))
	if !created.IsZero() {
		w.Line("CREATED", ical.UTC(created))
	}
	w.Line("LAST-MODIFIED", ical.UTC(modified))
	// SEQUENCE: grows with every change of the task (thoughts.revision), so clients take the new version.
	// DTSTAMP is the time of the last change, not of the fetch, so the feed (and its ETag) stays the same
	// while nothing changes.
	w.Line("SEQUENCE", strconv.Itoa(t.Revision))
	if hasTime {
		w.Line("DTSTART", ical.UTC(due))
		w.Line("DTEND", ical.UTC(due.Add(calendarEventMinutes*time.Minute)))
	} else {
		// Calendar days, no time and no zone: the same day in every client, whatever its time zone
		w.Line("DTSTART;VALUE=DATE", ical.Date(due))
		w.Line("DTEND;VALUE=DATE", ical.Date(due.AddDate(0, 0, 1)))
	}
	w.Text("SUMMARY", summary)
	if desc := calendarDescription(t, o); desc != "" {
		w.Text("DESCRIPTION", desc)
	}
	if link := o.Link(t.ID); link != "" {
		w.Line("URL;VALUE=URI", link)
	}
	// A task does not make anyone busy
	w.Line("TRANSP", "TRANSPARENT")
	for _, m := range t.Reminders {
		at, ok := domain.DueAlarmAt(t.DueDate, m, o.Loc)
		if !ok {
			continue
		}
		w.Line("BEGIN", "VALARM")
		w.Line("ACTION", "DISPLAY")
		w.Text("DESCRIPTION", summary)
		w.Line("TRIGGER;VALUE=DATE-TIME", ical.UTC(at))
		w.Line("END", "VALARM")
	}
	w.Line("END", "VEVENT")
}

// calendarDescription: the task list, the start of the notes and the link into the app.
func calendarDescription(t storage.CalendarTask, o calendarFeedOptions) string {
	var parts []string
	if t.ListTitle != "" {
		parts = append(parts, i18n.T(o.Lang, "Liste: {name}", "name", t.ListTitle))
	}
	if notes := strings.TrimSpace(o.Readable(t.Notes)); notes != "" {
		if utf8.RuneCountInString(notes) > calendarNotesExcerpt {
			notes = strings.TrimSpace(string([]rune(notes)[:calendarNotesExcerpt])) + "…"
		}
		parts = append(parts, notes)
	}
	if link := o.Link(t.ID); link != "" {
		parts = append(parts, link)
	}
	return strings.Join(parts, "\n\n")
}
