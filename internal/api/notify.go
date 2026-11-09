package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
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

// notify queues an event for the recipients that want it (settings, pause, own-change rule). payload
// gives the event's texts in a recipient's language.
func (s *Server) notify(kind, actorID string, recipients []string, payload func(lang string) map[string]string) {
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
		if err := s.store.QueueNotification(uid, kind, payload(s.userLanguage(uid))); err != nil {
			slog.Warn("Queueing a notification failed", "user_id", uid, "error", err)
		}
	}
}

func (s *Server) actorName(lang, userID string) string {
	if u, err := s.store.GetUserByID(userID); err == nil && u != nil && u.DisplayName != "" {
		return u.DisplayName
	}
	return i18n.T(lang, "Jemand")
}

// Texts of shared-with-you events, by what was shared
var sharedTexts = map[string]string{
	"note":     "{name} hat die Notiz „{title}“ mit dir geteilt",
	"folder":   "{name} hat den Ordner „{title}“ mit dir geteilt",
	"list":     "{name} hat die Liste „{title}“ mit dir geteilt",
	"tasklist": "{name} hat die Aufgabenliste „{title}“ mit dir geteilt",
}

// notifyShared tells the people a note, folder or list was shared with (teams: all members). what is
// a key of sharedTexts.
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
	s.notify("shared", actorID, recipients, func(lang string) map[string]string {
		return map[string]string{
			"title": title,
			"text":  i18n.T(lang, sharedTexts[what], "name", s.actorName(lang, actorID), "title", title),
		}
	})
}

// Texts of changes to watched tasks: a sentence when it is the only change, otherwise a short part of
// changeSeveral
const (
	changeDeleted    = "{name} hat „{title}“ gelöscht"
	changeDone       = "{name} hat „{title}“ erledigt"
	changeReopened   = "{name} hat „{title}“ wieder geöffnet"
	changeDue        = "{name} hat die Fälligkeit von „{title}“ auf {due} geändert"
	changeDueRemoved = "{name} hat die Fälligkeit von „{title}“ entfernt"
	changeText       = "{name} hat den Text von „{title}“ geändert"
	changePriority   = "{name} hat die Priorität von „{title}“ auf {priority} geändert"
	changeList       = "{name} hat „{title}“ in eine andere Liste verschoben"
	changeStatus     = "{name} hat „{title}“ nach „{status}“ verschoben"
	changeNotes      = "{name} hat die Beschreibung von „{title}“ geändert"
	changeSubtasks   = "{name} hat die Unteraufgaben von „{title}“ geändert"
	changeTags       = "{name} hat die Tags von „{title}“ geändert"
	changeAssignees  = "{name} hat die Zuweisung von „{title}“ geändert"
	changeRecurrence = "{name} hat die Wiederholung von „{title}“ geändert"
	changeOther      = "{name} hat „{title}“ geändert"
	changeSeveral    = "{name} hat „{title}“ geändert: {changes}"
	taskAssignedText = "{name} hat dir „{title}“ zugewiesen"
	taskAddedToList  = "{name} hat „{title}“ zur Liste „{list}“ hinzugefügt"
	partDone         = "erledigt"
	partReopened     = "wieder geöffnet"
	partDue          = "Fälligkeit: {due}"
	partDueRemoved   = "Fälligkeit entfernt"
	partText         = "Text"
	partPriority     = "Priorität: {priority}"
	partList         = "andere Liste"
	partStatus       = "Status: {status}"
	partNotes        = "Beschreibung"
	partSubtasks     = "Unteraufgaben"
	partTags         = "Tags"
	partAssignees    = "Zuweisung"
	partRecurrence   = "Wiederholung"
)

// taskChange is one changed field of a task: its sentence and its part of a longer list.
type taskChange struct{ sentence, part string }

// taskChanges lists what differs between two states of a task, in a fixed order.
func taskChanges(before, after *domain.Thought) []taskChange {
	var out []taskChange
	add := func(cond bool, sentence, part string) {
		if cond {
			out = append(out, taskChange{sentence, part})
		}
	}
	completed := before.IsCompleted != after.IsCompleted
	add(!before.IsCompleted && after.IsCompleted, changeDone, partDone)
	add(before.IsCompleted && !after.IsCompleted, changeReopened, partReopened)
	add(before.DueDate != after.DueDate && after.DueDate != "", changeDue, partDue)
	add(before.DueDate != after.DueDate && after.DueDate == "", changeDueRemoved, partDueRemoved)
	add(before.Content != after.Content, changeText, partText)
	add(before.Priority != after.Priority, changePriority, partPriority)
	add(before.TaskListID != after.TaskListID, changeList, partList)
	// Completing moves the task to the done column (and back): that is not a change of its own
	add(!completed && before.TaskListID == after.TaskListID && before.KanbanStatus != after.KanbanStatus, changeStatus, partStatus)
	add(before.Notes != after.Notes, changeNotes, partNotes)
	add(!sameSubtasks(before.Subtasks, after.Subtasks), changeSubtasks, partSubtasks)
	// Tags follow the hashtags of the text
	add(before.Content == after.Content && !sameSet(before.Tags, after.Tags), changeTags, partTags)
	add(!sameSet(before.Assignees, after.Assignees), changeAssignees, partAssignees)
	add(before.Recurrence != after.Recurrence, changeRecurrence, partRecurrence)
	return out
}

func sameSubtasks(a, b []domain.SubTask) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Title != b[i].Title || a[i].IsCompleted != b[i].IsCompleted {
			return false
		}
	}
	return true
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	in := map[string]bool{}
	for _, v := range a {
		in[v] = true
	}
	for _, v := range b {
		if !in[v] {
			return false
		}
	}
	return true
}

func taskTitle(t *domain.Thought) string {
	return strings.TrimSpace(strings.SplitN(t.Content, "\n", 2)[0])
}

// isTask: kept entries and those converted to a task are tasks (inbox entries and notes are not)
func isTask(t *domain.Thought) bool {
	return t != nil && (t.Status == domain.StatusKept || (t.Status == domain.StatusConverted && t.ConvertedType == "task"))
}

// columnName is the name of a task list's board column as the actor sees it, else its id.
func (s *Server) columnName(actorID, listID, columnID string) string {
	if tl, err := s.store.GetTaskListByID(actorID, listID); err == nil && tl != nil {
		for _, c := range tl.Columns {
			if c.ID == columnID {
				return c.Name
			}
		}
	}
	return columnID
}

// notifyTaskChange covers watchers (any change), list members (task completed, task added to the list)
// and people newly assigned to the task.
func (s *Server) notifyTaskChange(actorID string, before, after *domain.Thought, deleted bool) {
	t := after
	if t == nil {
		t = before
	}
	if t == nil {
		return
	}
	title := taskTitle(t)
	var changes []taskChange
	switch {
	case deleted:
		changes = []taskChange{{sentence: changeDeleted}}
	case before != nil && after != nil:
		changes = taskChanges(before, after)
	}
	status := ""
	if after != nil && after.KanbanStatus != "" && after.TaskListID != "" {
		for _, c := range changes {
			if c.sentence == changeStatus {
				status = s.columnName(actorID, after.TaskListID, after.KanbanStatus)
			}
		}
	}
	text := func(lang, msg string) string {
		args := []string{"name", s.actorName(lang, actorID), "title", title}
		if after != nil {
			args = append(args, "due", domain.HumanDue(lang, after.DueDate), "priority", domain.PriorityLabel(lang, after.Priority), "status", status)
		}
		return i18n.T(lang, msg, args...)
	}
	// Typing in a note changes a task many times: the same kind of change to it is sent once, the latest
	sentences := make([]string, 0, len(changes))
	for _, c := range changes {
		sentences = append(sentences, c.sentence)
	}
	key := t.ID + "|" + strings.Join(sentences, "|")
	payload := func(lang string) map[string]string {
		var msg string
		switch len(changes) {
		case 0:
			msg = text(lang, changeOther)
		case 1:
			msg = text(lang, changes[0].sentence)
		default:
			parts := make([]string, 0, len(changes))
			for _, c := range changes {
				parts = append(parts, text(lang, c.part))
			}
			msg = i18n.T(lang, changeSeveral, "name", s.actorName(lang, actorID), "title", title, "changes", strings.Join(parts, ", "))
		}
		return map[string]string{"title": title, "text": msg, "key": key}
	}
	single := func(msg string) func(lang string) map[string]string {
		return func(lang string) map[string]string {
			return map[string]string{"title": title, "text": text(lang, msg)}
		}
	}

	// Newly assigned people hear about it as such; a watcher among them needs no second line for it
	assigned := map[string]bool{}
	if before != nil && after != nil && !deleted {
		had := map[string]bool{}
		for _, id := range before.Assignees {
			had[id] = true
		}
		var added []string
		for _, id := range after.Assignees {
			if !had[id] {
				added = append(added, id)
				assigned[id] = true
			}
		}
		s.notify("assigned", actorID, added, single(taskAssignedText))
	}
	watchers := s.store.TaskWatchers(t.ID)
	watching := map[string]bool{}
	var tellWatchers []string
	for _, w := range watchers {
		watching[w] = true
		if !(assigned[w] && len(changes) == 1 && changes[0].sentence == changeAssignees) {
			tellWatchers = append(tellWatchers, w)
		}
	}
	s.notify("watched", actorID, tellWatchers, payload)

	done := false
	for _, c := range changes {
		done = done || c.sentence == changeDone
	}
	if done && t.TaskListID != "" {
		var members []string
		for _, uid := range s.taskAudience(t) {
			// Watchers already hear about it; a muted list stays quiet
			if !watching[uid] && !s.store.IsTaskListMuted(uid, t.TaskListID) {
				members = append(members, uid)
			}
		}
		s.notify("taskDone", actorID, members, single(changeDone))
	}
	// Moved into a shared list: new there for its members
	if before != nil && after != nil && !deleted && after.TaskListID != "" && before.TaskListID != after.TaskListID {
		s.notifyTaskAdded(actorID, after, watching)
	}
	if deleted {
		s.store.ForgetTaskWatchers(t.ID)
	}
}

// assignCreator: a task created in a shared task list starts out assigned to the one who created it (it
// can be changed). Only for new tasks, not for tasks moved into a list.
func (s *Server) assignCreator(userID string, t *domain.Thought) {
	if !isTask(t) || t.TaskListID == "" || len(t.Assignees) > 0 || len(s.store.GetTaskListUserIDs(t.TaskListID)) <= 1 {
		return
	}
	if ids, err := s.store.SetTaskAssignees(userID, t.ID, []string{userID}); err == nil {
		t.Assignees = ids
	}
}

// notifyTaskAdded tells the members of a shared task list that a task was added to it (created there,
// made from an inbox entry or moved there). skip: people who already hear about it otherwise.
func (s *Server) notifyTaskAdded(actorID string, t *domain.Thought, skip map[string]bool) {
	if !isTask(t) || t.TaskListID == "" {
		return
	}
	list := ""
	if tl, err := s.store.GetTaskListByID(actorID, t.TaskListID); err == nil && tl != nil {
		list = tl.Title
	}
	var members []string
	for _, uid := range s.taskAudience(t) {
		if !skip[uid] && !s.store.IsTaskListMuted(uid, t.TaskListID) {
			members = append(members, uid)
		}
	}
	title := taskTitle(t)
	s.notify("taskCreated", actorID, members, func(lang string) map[string]string {
		return map[string]string{
			"title": title,
			"text":  i18n.T(lang, taskAddedToList, "name", s.actorName(lang, actorID), "title", title, "list", list),
		}
	})
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
		slog.Error("Reading notifications failed", "error", err)
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
		// Events with the same key (the same change to the same task) go out once, as the latest
		last := map[string]int{}
		for i, q := range queued {
			if k := q.Payload["key"]; k != "" {
				last[q.Kind+"|"+k] = i
			}
		}
		for i, q := range queued {
			ids = append(ids, q.ID)
			if q.Attempts > maxAttempts {
				maxAttempts = q.Attempts
			}
			if set.Paused {
				continue
			}
			if k := q.Payload["key"]; k != "" && last[q.Kind+"|"+k] != i {
				continue
			}
			item := notifyItem{kind: q.Kind, title: q.Payload["title"], text: q.Payload["text"]}
			out.add(set.Channels(q.Kind), item)
		}
		if err := s.deliver(uid, headingNews, out, false, now); err != nil {
			if maxAttempts+1 >= notifyMaxAttempts {
				slog.Warn("Notifications dropped after several failed attempts", "user_id", uid, "count", len(ids), "error", err)
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

// Headings of bundled messages
const (
	headingNews    = "Neuigkeiten"
	headingSummary = "Deine Aufgaben für heute"
)

// deliver sends the items to the user's mail address, Discord webhook and/or own webhook.
// now is the time the run is for (greeting "Guten Morgen" follows the summary time, not the clock).
func (s *Server) deliver(userID, heading string, out channelItems, summary bool, now time.Time) error {
	emailItems, discordItems := out.email, out.discord
	u, err := s.store.GetUserByID(userID)
	if err != nil || u == nil || !u.IsActive {
		return nil // account gone: nothing to deliver
	}
	lang := s.userLanguage(userID)
	heading = i18n.T(lang, heading)
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
		c := s.digestMail(lang, u.DisplayName, emailItems, now)
		if summary {
			c = s.summaryMail(lang, u.DisplayName, emailItems, now)
		}
		text, htmlBody := renderMail(c)
		if err := s.sendNotifyEmail(to, subject, text, htmlBody); err != nil {
			firstErr = err
		}
	}
	if len(discordItems) > 0 && u.DiscordWebhookURL != "" {
		if err := s.sendNotifyDiscord(lang, u.DiscordWebhookURL, heading, discordItems); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if len(out.webhook) > 0 && u.CustomWebhookURL != "" {
		if err := s.sendNotifyWebhook(u.CustomWebhookURL, heading, out.webhook); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if len(out.push) > 0 {
		if err := s.sendPush(userID, pushDigest(lang, heading, out.push, s.notifyLink())); err != nil && firstErr == nil {
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

func (s *Server) sendNotifyDiscord(lang, webhookURL, heading string, items []notifyItem) error {
	if s.notifyDiscordHook != nil {
		return s.notifyDiscordHook(webhookURL, heading, items)
	}
	return s.sendDiscordDigest(lang, webhookURL, heading, items)
}

// moreLine: the last line of a cut list, "… and 3 more"
func moreLine(lang string, n int) string {
	return i18n.T(lang, "… und {count} weitere", "count", strconv.Itoa(n))
}

// pushDigest: one notification per bundle; a single event is its own title
func pushDigest(lang, heading string, items []notifyItem, link string) pushMessage {
	if link == "" {
		link = "/"
	}
	if len(items) == 1 {
		return pushMessage{Title: "MindSift", Body: items[0].text, URL: link, Tag: "digest"}
	}
	lines := make([]string, 0, 5)
	for i, it := range items {
		if i == 4 {
			lines = append(lines, moreLine(lang, len(items)-4))
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
func (s *Server) sendDiscordDigest(lang, webhookURL, heading string, items []notifyItem) error {
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
			lines = append(lines, moreLine(lang, len(items)-10))
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
func (s *Server) digestMail(lang, name string, items []notifyItem, now time.Time) mailContent {
	entries := make([]mailItem, 0, len(items))
	for _, it := range items {
		entries = append(entries, mailItem{Title: it.text})
	}
	intro := i18n.T(lang, "In MindSift ist etwas passiert, das dich betrifft:")
	if len(items) > 1 {
		intro = i18n.T(lang, "In MindSift ist seit der letzten Nachricht einiges passiert, das dich betrifft:")
	}
	c := mailContent{
		Lang:      lang,
		Preheader: items[0].text,
		Greeting:  mailGreeting(lang, now, name),
		Intro:     intro,
		Sections:  []mailSection{{Items: entries}},
		Footer:    mailFooterAlarms(lang),
	}
	if link := s.notifyLink(); link != "" {
		c.Button = &mailButton{Label: i18n.T(lang, "In MindSift öffnen"), URL: link}
	}
	return c
}

// summaryMail: the morning overview, grouped into overdue / today / tomorrow.
func (s *Server) summaryMail(lang, name string, items []notifyItem, now time.Time) mailContent {
	groups := []struct{ key, title, tone string }{
		{"overdue", i18n.T(lang, "Überfällig"), "danger"},
		{"today", i18n.T(lang, "Heute"), ""},
		{"tomorrow", i18n.T(lang, "Morgen"), "muted"},
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
		parts = append(parts, i18n.T(lang, "{count} überfällig", "count", strconv.Itoa(n)))
	}
	if n := counts["today"]; n > 0 {
		parts = append(parts, i18n.T(lang, "{count} heute", "count", strconv.Itoa(n)))
	}
	if n := counts["tomorrow"]; n > 0 {
		parts = append(parts, i18n.T(lang, "{count} morgen", "count", strconv.Itoa(n)))
	}
	c := mailContent{
		Lang:      lang,
		Preheader: i18n.T(lang, "Deine Aufgaben: {counts}", "counts", strings.Join(parts, ", ")),
		Greeting:  mailGreeting(lang, now, name),
		Intro:     i18n.T(lang, "Hier ist dein Überblick für heute – {counts}.", "counts", strings.Join(parts, ", ")),
		Sections:  sections,
		Outro:     outro,
		Footer:    i18n.T(lang, "Du bekommst diese Zusammenfassung, weil du sie eingeschaltet hast. Uhrzeit und Kanäle stellst du in MindSift unter Kontoeinstellungen → Alarme ein."),
	}
	if link := s.notifyLink(); link != "" {
		c.Button = &mailButton{Label: i18n.T(lang, "Aufgaben öffnen"), URL: link}
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
		if err := s.deliver(uid, headingSummary, out, true, now); err != nil {
			slog.Warn("Sending the daily summary failed", "user_id", uid, "error", err)
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
	lang := s.userLanguage(userID)
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
		at := ""
		if due, hasTime, ok := domain.ParseDue(t.DueDate, now.Location()); ok && hasTime {
			at = i18n.Clock(lang, due)
		}
		// "Heute: …" or "Heute, 15:30 Uhr: …"
		day := func(plain, withTime string) string {
			if at == "" {
				return i18n.T(lang, plain, "task", label)
			}
			return i18n.T(lang, withTime, "time", at, "task", label)
		}
		switch {
		case d < today:
			since := i18n.T(lang, "seit {due}", "due", domain.HumanDue(lang, t.DueDate))
			items = append(items, notifyItem{kind: "due", title: t.Title, text: i18n.T(lang, "Überfällig {since}: {task}", "since", since, "task", label), group: "overdue", when: since, list: t.ListTitle})
		case d == today:
			items = append(items, notifyItem{kind: "due", title: t.Title, text: day("Heute: {task}", "Heute, {time}: {task}"), group: "today", when: at, list: t.ListTitle})
		case d == tomorrow:
			items = append(items, notifyItem{kind: "due", title: t.Title, text: day("Morgen: {task}", "Morgen, {time}: {task}"), group: "tomorrow", when: at, list: t.ListTitle})
		default:
			later++
		}
	}
	if len(items) > 0 && later > 0 {
		more := i18n.T(lang, "Außerdem {count} weitere Aufgaben in den nächsten 7 Tagen", "count", strconv.Itoa(later))
		if later == 1 {
			more = i18n.T(lang, "Außerdem eine weitere Aufgabe in den nächsten 7 Tagen")
		}
		items = append(items, notifyItem{kind: "due", text: more, group: "more"})
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
