package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// Notifications besides task alarms: events go into a queue per recipient and are sent bundled, one
// message per recipient and channel once the oldest event is NOTIFY_DIGEST_MINUTES old. Each user picks
// the channels per event kind (own mail address, own Discord webhook, own webhook with a JSON body), can
// pause everything and gets a daily summary of due tasks at a chosen time. Own changes never notify the
// one who made them, except on watched tasks when the user asked for it. The demo sends nothing.

const notifyMaxAttempts = 3

// notifyItem is one line of a bundled message.
type notifyItem struct {
	kind, title, text string
	// Daily summary only, for the sections of the mail: overdue | today | tomorrow | more
	group, when, list string
}

// notify queues an event for the recipients that want it (settings, pause, own-change rule).
func (s *Server) notify(kind, actorID string, recipients []string, payload map[string]string) {
	if s.cfg.DemoMode {
		return
	}
	seen := map[string]bool{}
	for _, uid := range recipients {
		if uid == "" || seen[uid] {
			continue
		}
		seen[uid] = true
		set := s.store.NotificationSettingsOf(uid)
		if set.Paused {
			continue
		}
		if uid == actorID && !(kind == "watched" && set.IncludeOwnWatched) {
			continue
		}
		if !set.Channels(kind).Any() {
			continue
		}
		if err := s.store.QueueNotification(uid, kind, payload); err != nil {
			slog.Warn("Benachrichtigung konnte nicht vorgemerkt werden", "user_id", uid, "error", err)
		}
	}
}

func (s *Server) actorName(userID string) string {
	if u, err := s.store.GetUserByID(userID); err == nil && u != nil && u.DisplayName != "" {
		return u.DisplayName
	}
	return "Jemand"
}

// notifyShared tells the people a note, folder or list was shared with (teams: all members).
func (s *Server) notifyShared(actorID, targetType, targetID, what, title string) {
	var recipients []string
	if targetType == "team" {
		members, _ := s.store.GetTeamMembers(targetID)
		for _, m := range members {
			recipients = append(recipients, m.UserID)
		}
	} else {
		recipients = []string{targetID}
	}
	s.notify("shared", actorID, recipients, map[string]string{
		"title": title,
		"text":  fmt.Sprintf("%s hat %s „%s“ mit dir geteilt", s.actorName(actorID), what, title),
	})
}

// notifyTaskChange covers watchers (any change) and list members (task completed).
func (s *Server) notifyTaskChange(actorID string, before, after *domain.Thought, deleted bool) {
	t := after
	if t == nil {
		t = before
	}
	if t == nil {
		return
	}
	title := strings.TrimSpace(strings.SplitN(t.Content, "\n", 2)[0])
	name := s.actorName(actorID)
	var change string
	switch {
	case deleted:
		change = "gelöscht"
	case before != nil && after != nil && !before.IsCompleted && after.IsCompleted:
		change = "erledigt"
	case before != nil && after != nil && before.IsCompleted && !after.IsCompleted:
		change = "wieder geöffnet"
	case before != nil && after != nil && before.DueDate != after.DueDate:
		change = "Fälligkeit geändert auf " + domain.HumanDue(after.DueDate)
	case before != nil && after != nil && before.Content != after.Content:
		change = "Text geändert"
	case before != nil && after != nil && before.Priority != after.Priority:
		change = "Priorität geändert auf " + after.Priority
	case before != nil && after != nil && before.TaskListID != after.TaskListID:
		change = "in eine andere Liste verschoben"
	default:
		change = "geändert"
	}
	payload := map[string]string{"title": title, "text": fmt.Sprintf("%s hat „%s“ %s", name, title, change)}
	watchers := s.store.TaskWatchers(t.ID)
	s.notify("watched", actorID, watchers, payload)

	if change == "erledigt" && t.TaskListID != "" {
		watching := map[string]bool{}
		for _, w := range watchers {
			watching[w] = true
		}
		var members []string
		for _, uid := range s.taskAudience(t) {
			if !watching[uid] { // watchers already hear about it
				members = append(members, uid)
			}
		}
		s.notify("taskDone", actorID, members, payload)
	}
	if deleted {
		s.store.ForgetTaskWatchers(t.ID)
	}
}

// --- Background jobs ---

func (s *Server) startNotificationJobs() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for now := range ticker.C {
		s.flushNotifications(now)
		s.sendDailySummaries(now)
	}
}

// flushNotifications sends one bundled message per recipient whose oldest event waited long enough.
func (s *Server) flushNotifications(now time.Time) {
	minutes := s.cfg.NotifyDigestMinutes
	if minutes < 1 {
		minutes = 5
	}
	window := time.Duration(minutes) * time.Minute
	users, err := s.store.DueNotificationUsers(now.Add(-window))
	if err != nil {
		slog.Error("Benachrichtigungen konnten nicht gelesen werden", "error", err)
		return
	}
	for _, uid := range users {
		queued, err := s.store.QueuedNotifications(uid)
		if err != nil || len(queued) == 0 {
			continue
		}
		set := s.store.NotificationSettingsOf(uid)
		var out channelItems
		ids := make([]int64, 0, len(queued))
		maxAttempts := 0
		for _, q := range queued {
			ids = append(ids, q.ID)
			if q.Attempts > maxAttempts {
				maxAttempts = q.Attempts
			}
			if set.Paused {
				continue
			}
			item := notifyItem{kind: q.Kind, title: q.Payload["title"], text: q.Payload["text"]}
			out.add(set.Channels(q.Kind), item)
		}
		if err := s.deliver(uid, "Neuigkeiten", out, false, now); err != nil {
			if maxAttempts+1 >= notifyMaxAttempts {
				slog.Warn("Benachrichtigungen nach mehreren Fehlversuchen verworfen", "user_id", uid, "count", len(ids), "error", err)
				_ = s.store.DeleteQueuedNotifications(ids)
			} else {
				_ = s.store.BumpQueuedNotifications(ids)
			}
			continue
		}
		_ = s.store.DeleteQueuedNotifications(ids)
	}
}

// channelItems collects what goes out on each channel.
type channelItems struct {
	email, discord, webhook, push []notifyItem
}

func (c *channelItems) add(ch domain.ChannelChoice, items ...notifyItem) {
	if ch.Email {
		c.email = append(c.email, items...)
	}
	if ch.Discord {
		c.discord = append(c.discord, items...)
	}
	if ch.Webhook {
		c.webhook = append(c.webhook, items...)
	}
	if ch.Push {
		c.push = append(c.push, items...)
	}
}

// deliver sends the items to the user's mail address, Discord webhook and/or own webhook.
// now is the time the run is for (greeting "Guten Morgen" follows the summary time, not the clock).
func (s *Server) deliver(userID, heading string, out channelItems, summary bool, now time.Time) error {
	emailItems, discordItems := out.email, out.discord
	u, err := s.store.GetUserByID(userID)
	if err != nil || u == nil || !u.IsActive {
		return nil // account gone: nothing to deliver
	}
	var firstErr error
	if len(emailItems) > 0 {
		to := u.AlarmEmail
		if to == "" {
			to = u.Email
		}
		subject := "MindSift: " + heading
		if len(emailItems) == 1 {
			subject = "MindSift: " + emailItems[0].text
		}
		c := s.digestMail(u.DisplayName, emailItems, now)
		if summary {
			c = s.summaryMail(u.DisplayName, emailItems, now)
		}
		text, htmlBody := renderMail(c)
		if err := s.sendNotifyEmail(to, subject, text, htmlBody); err != nil {
			firstErr = err
		}
	}
	if len(discordItems) > 0 && u.DiscordWebhookURL != "" {
		if err := s.sendNotifyDiscord(u.DiscordWebhookURL, heading, discordItems); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if len(out.webhook) > 0 && u.CustomWebhookURL != "" {
		if err := s.sendNotifyWebhook(u.CustomWebhookURL, heading, out.webhook); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if len(out.push) > 0 {
		if err := s.sendPush(userID, pushDigest(heading, out.push, s.notifyLink())); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// sendNotifyEmail / sendNotifyDiscord are replaced in tests.
func (s *Server) sendNotifyEmail(to, subject, text, htmlBody string) error {
	if s.notifyEmailHook != nil {
		return s.notifyEmailHook(to, subject, text, htmlBody)
	}
	return s.sendEmailHTML(to, subject, text, htmlBody)
}

func (s *Server) sendNotifyDiscord(webhookURL, heading string, items []notifyItem) error {
	if s.notifyDiscordHook != nil {
		return s.notifyDiscordHook(webhookURL, heading, items)
	}
	return s.sendDiscordDigest(webhookURL, heading, items)
}

// pushDigest: one notification per bundle; a single event is its own title
func pushDigest(heading string, items []notifyItem, link string) pushMessage {
	if link == "" {
		link = "/"
	}
	if len(items) == 1 {
		return pushMessage{Title: "MindSift", Body: items[0].text, URL: link, Tag: "digest"}
	}
	lines := make([]string, 0, 5)
	for i, it := range items {
		if i == 4 {
			lines = append(lines, fmt.Sprintf("… und %d weitere", len(items)-4))
			break
		}
		lines = append(lines, "• "+it.text)
	}
	return pushMessage{Title: "MindSift: " + heading, Body: strings.Join(lines, "\n"), URL: link, Tag: "digest"}
}

func (s *Server) sendNotifyWebhook(webhookURL, heading string, items []notifyItem) error {
	if s.notifyWebhookHook != nil {
		return s.notifyWebhookHook(webhookURL, heading, items)
	}
	return s.sendWebhookDigest(webhookURL, heading, items)
}

// sendWebhookDigest posts the bundle as JSON: {"event":"digest","heading":…,"items":[{kind,title,text}],…}.
func (s *Server) sendWebhookDigest(webhookURL, heading string, items []notifyItem) error {
	if s.cfg.DemoMode {
		return errDemoOutgoing
	}
	allowPrivate := s.allowPrivateWebhooks()
	if err := validateWebhookURL(webhookURL, false, allowPrivate); err != nil {
		return err
	}
	list := make([]map[string]string, 0, len(items))
	for _, it := range items {
		list = append(list, map[string]string{"kind": it.kind, "title": it.title, "text": it.text})
	}
	body, _ := json.Marshal(map[string]interface{}{
		"event":     "digest",
		"heading":   heading,
		"items":     list,
		"link":      s.notifyLink(),
		"timestamp": domain.NowISO(),
	})
	resp, err := guardedClient(allowPrivate).Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP Status %d", resp.StatusCode)
	}
	return nil
}

func (s *Server) notifyLink() string {
	if !s.cfg.BaseURLSet {
		return ""
	}
	return strings.TrimRight(s.cfg.BaseURL, "/") + "/"
}

// sendDiscordDigest posts one embed with a line per item (at most 10).
func (s *Server) sendDiscordDigest(webhookURL, heading string, items []notifyItem) error {
	if s.cfg.DemoMode {
		return errDemoOutgoing
	}
	allowPrivate := s.allowPrivateWebhooks()
	if err := validateWebhookURL(webhookURL, true, allowPrivate); err != nil {
		return err
	}
	lines := make([]string, 0, 11)
	for i, it := range items {
		if i == 10 {
			lines = append(lines, fmt.Sprintf("… und %d weitere", len(items)-10))
			break
		}
		lines = append(lines, "• "+it.text)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"embeds": []map[string]interface{}{{
			"title":       "MindSift: " + heading,
			"description": strings.Join(lines, "\n"),
			"color":       2450411,
		}},
	})
	resp, err := guardedClient(allowPrivate).Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP Status %d", resp.StatusCode)
	}
	return nil
}

// digestMail: what happened since the last mail (shares, completed shared tasks, watched tasks).
func (s *Server) digestMail(name string, items []notifyItem, now time.Time) mailContent {
	entries := make([]mailItem, 0, len(items))
	for _, it := range items {
		entries = append(entries, mailItem{Title: it.text})
	}
	intro := "In MindSift ist etwas passiert, das dich betrifft:"
	if len(items) > 1 {
		intro = "In MindSift ist seit der letzten Nachricht einiges passiert, das dich betrifft:"
	}
	c := mailContent{
		Preheader: items[0].text,
		Greeting:  mailGreeting(now, name),
		Intro:     intro,
		Sections:  []mailSection{{Items: entries}},
		Footer:    mailFooterAlarms,
	}
	if link := s.notifyLink(); link != "" {
		c.Button = &mailButton{Label: "In MindSift öffnen", URL: link}
	}
	return c
}

// summaryMail: the morning overview, grouped into overdue / today / tomorrow.
func (s *Server) summaryMail(name string, items []notifyItem, now time.Time) mailContent {
	groups := []struct{ key, title, tone string }{
		{"overdue", "Überfällig", "danger"},
		{"today", "Heute", ""},
		{"tomorrow", "Morgen", "muted"},
	}
	var sections []mailSection
	counts := map[string]int{}
	outro := ""
	for _, g := range groups {
		sec := mailSection{Title: g.title, Tone: g.tone}
		for _, it := range items {
			if it.group != g.key {
				continue
			}
			meta := it.when
			if it.list != "" {
				if meta != "" {
					meta += " · "
				}
				meta += it.list
			}
			sec.Items = append(sec.Items, mailItem{Title: it.title, Meta: meta})
		}
		counts[g.key] = len(sec.Items)
		if len(sec.Items) > 0 {
			sections = append(sections, sec)
		}
	}
	for _, it := range items {
		if it.group == "more" {
			outro = it.text + "."
		}
	}
	var parts []string
	if n := counts["overdue"]; n > 0 {
		parts = append(parts, fmt.Sprintf("%d überfällig", n))
	}
	if n := counts["today"]; n > 0 {
		parts = append(parts, fmt.Sprintf("%d heute", n))
	}
	if n := counts["tomorrow"]; n > 0 {
		parts = append(parts, fmt.Sprintf("%d morgen", n))
	}
	c := mailContent{
		Preheader: "Deine Aufgaben: " + strings.Join(parts, ", "),
		Greeting:  mailGreeting(now, name),
		Intro:     "Hier ist dein Überblick für heute – " + strings.Join(parts, ", ") + ".",
		Sections:  sections,
		Outro:     outro,
		Footer:    "Du bekommst diese Zusammenfassung, weil du sie eingeschaltet hast. Uhrzeit und Kanäle stellst du in MindSift unter Kontoeinstellungen → Alarme ein.",
	}
	if link := s.notifyLink(); link != "" {
		c.Button = &mailButton{Label: "Aufgaben öffnen", URL: link}
	}
	return c
}

// --- Daily summary ---

// sendDailySummaries sends each user who wants one their summary in the 30 minutes after the chosen
// time, once a day. Nothing due → no message.
func (s *Server) sendDailySummaries(now time.Time) {
	day := now.Format("2006-01-02")
	for _, uid := range s.store.ActiveUserIDs() {
		set := s.store.NotificationSettingsOf(uid)
		ds := set.DailySummary
		if set.Paused || !ds.Enabled || (!ds.Email && !ds.Discord && !ds.Webhook && !ds.Push) {
			continue
		}
		at, err := time.ParseInLocation("2006-01-02 15:04", day+" "+ds.Time, now.Location())
		if err != nil || now.Before(at) || now.Sub(at) >= 30*time.Minute {
			continue
		}
		items := s.summaryItems(uid, now)
		if len(items) == 0 || !s.store.ClaimDailySummary(uid, day) {
			continue
		}
		var out channelItems
		out.add(domain.ChannelChoice{Email: ds.Email, Discord: ds.Discord, Webhook: ds.Webhook, Push: ds.Push}, items...)
		if err := s.deliver(uid, "Deine Aufgaben für heute", out, true, now); err != nil {
			slog.Warn("Tageszusammenfassung konnte nicht verschickt werden", "user_id", uid, "error", err)
		}
	}
}

// summaryItems: overdue, today, tomorrow (with time), plus how many follow in the next 7 days.
func (s *Server) summaryItems(userID string, now time.Time) []notifyItem {
	today := now.Format("2006-01-02")
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	tasks, err := s.store.OpenTasksDueBefore(userID, now.AddDate(0, 0, 8).Format("2006-01-02"))
	if err != nil {
		return nil
	}
	sort.SliceStable(tasks, func(i, j int) bool { return tasks[i].DueDate < tasks[j].DueDate })
	var items []notifyItem
	later := 0
	for _, t := range tasks {
		d := t.DueDate
		if len(d) > 10 {
			d = d[:10]
		}
		label := t.Title
		if t.ListTitle != "" {
			label += " (" + t.ListTitle + ")"
		}
		clock := ""
		if len(t.DueDate) >= 16 {
			clock = ", " + t.DueDate[11:16] + " Uhr"
		}
		at := strings.TrimPrefix(clock, ", ")
		switch {
		case d < today:
			since := "seit " + domain.HumanDue(t.DueDate)
			items = append(items, notifyItem{kind: "due", title: t.Title, text: "Überfällig " + since + ": " + label, group: "overdue", when: since, list: t.ListTitle})
		case d == today:
			items = append(items, notifyItem{kind: "due", title: t.Title, text: "Heute" + clock + ": " + label, group: "today", when: at, list: t.ListTitle})
		case d == tomorrow:
			items = append(items, notifyItem{kind: "due", title: t.Title, text: "Morgen" + clock + ": " + label, group: "tomorrow", when: at, list: t.ListTitle})
		default:
			later++
		}
	}
	if len(items) > 0 && later > 0 {
		items = append(items, notifyItem{kind: "due", text: fmt.Sprintf("Außerdem %d weitere Aufgaben in den nächsten 7 Tagen", later), group: "more"})
	}
	return items
}

// --- Watching tasks ---

// handleWatchTask: POST (watch) / DELETE (stop) /tasks/{id}/watch
func (s *Server) handleWatchTask(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	taskID := chi.URLParam(r, "id")
	if _, err := s.store.GetThoughtByID(userID, taskID); err != nil {
		writeError(w, http.StatusNotFound, "Aufgabe nicht gefunden")
		return
	}
	on := r.Method == http.MethodPost
	if err := s.store.WatchTask(taskID, userID, on); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"watching": on})
}

// markWatching sets IsWatching on tasks for the requesting user.
func (s *Server) markWatching(userID string, thoughts []domain.Thought) {
	watched := s.store.WatchedTaskIDs(userID)
	if len(watched) == 0 {
		return
	}
	for i := range thoughts {
		thoughts[i].IsWatching = watched[thoughts[i].ID]
	}
}
