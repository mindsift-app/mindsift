package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
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

// notify puts an event into the notification center of every recipient but the actor, and queues it
// for those that want it by mail, Discord, webhook or push (settings, pause, own-change rule). payload
// gives the event's texts in a recipient's language; besides "title" and "text" it may carry what the
// center needs (see centerFrom).
//
// Everything an event stores for its recipients goes in one transaction, and their languages and
// settings are read in one query each: it used to be about six statements per recipient, among them a
// write of its own, so a task completed in a list shared with 50 people waited 50 times for the
// database's write lock (load test 2026-11-15).
func (s *Server) notify(kind, actorID string, recipients []string, payload func(lang string) map[string]string) {
	var b notifyBatch
	s.planNotify(&b, kind, actorID, recipients, payload)
	s.storeBatch(&b)
}

// notifyBatch collects what several events store for their recipients, so it goes into one transaction:
// with storeBatch on its own, or with the change the events are about (storage.UpdateTask, CreateTask).
type notifyBatch struct {
	center []storage.CenterAdd
	queue  []storage.QueuedAdd
}

// storeBatch stores a batch in a transaction of its own and tells the recipients' open apps.
func (s *Server) storeBatch(b *notifyBatch) {
	if len(b.center) == 0 && len(b.queue) == 0 {
		return
	}
	added, err := s.store.StoreNotifications(b.center, b.queue)
	if err != nil {
		slog.Warn("Storing notifications failed", "entries", len(b.center), "queued", len(b.queue), "error", err)
		return
	}
	s.sendBatch(b, added)
}

// sendBatch tells the recipients' open apps about the center entries of a batch as stored (in its order).
func (s *Server) sendBatch(b *notifyBatch, added []storage.CenterEntry) {
	for i, e := range added {
		if i < len(b.center) {
			s.wsHub.BroadcastToUser(b.center[i].UserID, "NOTIFICATION", e)
		}
	}
}

// planNotify is notify without storing: it adds the event's entries and queued messages to b.
func (s *Server) planNotify(b *notifyBatch, kind, actorID string, recipients []string, payload func(lang string) map[string]string) {
	seen := map[string]bool{}
	ids := make([]string, 0, len(recipients))
	for _, uid := range recipients {
		// The actor only ever hears about watched tasks (below), so a personal task reads nothing here
		if uid == actorID && kind != "watched" {
			continue
		}
		if uid != "" && !seen[uid] {
			seen[uid] = true
			ids = append(ids, uid)
		}
	}
	if len(ids) == 0 {
		return
	}
	langs := s.userLanguages(ids)
	// The texts depend on the language only
	texts := map[string]map[string]string{}
	textsFor := func(uid string) map[string]string {
		lang := langs[uid]
		p, ok := texts[lang]
		if !ok {
			p = payload(lang)
			texts[lang] = p
		}
		return p
	}
	var settings map[string]domain.NotificationSettings
	if !s.cfg.DemoMode {
		settings = s.store.NotificationSettingsOfUsers(ids)
	}
	for _, uid := range ids {
		if uid != actorID {
			b.center = append(b.center, centerAdd(uid, kind, textsFor(uid)))
		}
		if s.cfg.DemoMode {
			continue
		}
		set := settings[uid]
		if set.Paused {
			continue
		}
		if uid == actorID && (kind != "watched" || !set.IncludeOwnWatched) {
			continue
		}
		if !set.Channels(kind).Any() {
			continue
		}
		b.queue = append(b.queue, storage.QueuedAdd{UserID: uid, Kind: kind, Payload: textsFor(uid)})
	}
}

// userLanguages is userLanguage for several people, with two queries in all.
func (s *Server) userLanguages(userIDs []string) map[string]string {
	chosen := s.store.Languages(userIDs)
	fallback := ""
	out := make(map[string]string, len(userIDs))
	for _, uid := range userIDs {
		if v := chosen[uid]; i18n.Valid(v) {
			out[uid] = v
			continue
		}
		if fallback == "" {
			fallback = s.defaultLanguage()
		}
		out[uid] = fallback
	}
	return out
}

// Payload keys for the notification center
const (
	centerTarget  = "targetType" // task | note | list | tasklist | folder
	centerID      = "targetId"
	centerBlock   = "blockId"
	centerText    = "centerText"    // shorter text for the center (otherwise "text")
	centerGeneric = "centerGeneric" // text when two different changes merge into one entry
	centerGroupID = "centerGroup"   // one entry per key: a newer one replaces it
)

// centerAdd is the entry an event's texts make in a person's notification center (replacing an earlier
// one of its group, see storage.StoreNotifications).
func centerAdd(userID, kind string, p map[string]string) storage.CenterAdd {
	text := p[centerText]
	if text == "" {
		text = p["text"]
	}
	e := storage.CenterEntry{Kind: kind, Title: p["title"], Text: text, TargetType: p[centerTarget], TargetID: p[centerID], BlockID: p[centerBlock]}
	return storage.CenterAdd{UserID: userID, Entry: e, GroupKey: p[centerGroupID], Generic: p[centerGeneric]}
}

// storeCenterEntry adds an entry; replacing an unread one with a different text merges them into the
// generic text (when given).
func (s *Server) storeCenterEntry(userID string, e storage.CenterEntry, group string, mode storage.CenterGroup, generic string) {
	added, ok, replaced, err := s.store.AddCenterEntry(userID, e, group, mode)
	if err != nil {
		slog.Warn("Storing a notification center entry failed", "user_id", userID, "error", err)
		return
	}
	if !ok {
		return
	}
	if replaced != "" && replaced != added.Text && generic != "" {
		added.Text = generic
		logFailed("Updating the text of a notification", s.store.SetCenterEntryText(userID, added.ID, generic), "user_id", userID)
	}
	s.wsHub.BroadcastToUser(userID, "NOTIFICATION", added)
}

func (s *Server) actorName(lang, userID string) string {
	// One line: the name goes into mails, push messages and chat posts (stored names from before the
	// cleaning on save may still carry line breaks)
	if u, err := s.store.GetUserByID(userID); err == nil && u != nil && domain.CleanDisplayName(u.DisplayName) != "" {
		return domain.CleanDisplayName(u.DisplayName)
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
// a key of sharedTexts, objectID the shared note, folder or list (where the center leads).
func (s *Server) notifyShared(actorID, targetType, targetID, what, objectID, title string) {
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
			"title":      title,
			"text":       i18n.T(lang, sharedTexts[what], "name", s.actorName(lang, actorID), "title", title),
			centerTarget: what,
			centerID:     objectID,
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
	changeReminders  = "{name} hat die Erinnerungen von „{title}“ geändert"
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
	partReminders    = "Erinnerungen"
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
	add(domain.FormatReminders(before.Reminders) != domain.FormatReminders(after.Reminders), changeReminders, partReminders)
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
	if cols, ok := s.store.TaskListColumns(actorID, listID); ok {
		for _, c := range cols {
			if c.ID == columnID {
				return c.Name
			}
		}
	}
	return columnID
}

// planTaskChange adds the events about a change of a task to b: watchers (any change), list members
// (task completed, task added to the list) and people newly assigned to it. The caller stores b with the
// change (storage.UpdateTask, DeleteTask, ReconcileDocTaskLinksNotify) or on its own (storeBatch).
// Returns the task's watchers. audience: who sees the task now (taskAudience of after, else before) when
// the caller has it, nil to read it here when needed.
func (s *Server) planTaskChange(b *notifyBatch, actorID string, before, after *domain.Thought, deleted bool, audience []string) []string {
	t := after
	if t == nil {
		t = before
	}
	if t == nil {
		return nil
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
	// The center links to the task (unless it is gone)
	target := func(p map[string]string) map[string]string {
		if !deleted {
			p[centerTarget], p[centerID] = "task", t.ID
		}
		return p
	}
	payload := func(lang string) map[string]string {
		var msg string
		generic := text(lang, changeOther)
		short := generic
		switch len(changes) {
		case 0:
			msg = generic
		case 1:
			msg = text(lang, changes[0].sentence)
			short = msg
		default:
			parts := make([]string, 0, len(changes))
			for _, c := range changes {
				parts = append(parts, text(lang, c.part))
			}
			msg = i18n.T(lang, changeSeveral, "name", s.actorName(lang, actorID), "title", title, "changes", strings.Join(parts, ", "))
		}
		// In the center a watched task keeps one short entry, its latest change
		return target(map[string]string{"title": title, "text": msg, "key": key,
			centerText: short, centerGeneric: generic, centerGroupID: "watched:" + t.ID})
	}
	single := func(msg string) func(lang string) map[string]string {
		return func(lang string) map[string]string {
			return target(map[string]string{"title": title, "text": text(lang, msg)})
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
		s.planNotify(b, "assigned", actorID, added, single(taskAssignedText))
	}
	watchers := s.store.TaskWatchers(t.ID)
	watching := map[string]bool{}
	var tellWatchers []string
	for _, w := range watchers {
		watching[w] = true
		if !assigned[w] || len(changes) != 1 || changes[0].sentence != changeAssignees {
			tellWatchers = append(tellWatchers, w)
		}
	}
	s.planNotify(b, "watched", actorID, tellWatchers, payload)

	moved := before != nil && after != nil && !deleted && after.TaskListID != "" && before.TaskListID != after.TaskListID
	done := false
	for _, c := range changes {
		done = done || c.sentence == changeDone
	}
	if (done || moved) && t.TaskListID != "" && audience == nil {
		audience = s.taskAudience(t)
	}
	if done && t.TaskListID != "" && othersIn(audience, actorID) {
		var members []string
		muted := s.store.TaskListMutedBy(t.TaskListID, audience)
		for _, uid := range audience {
			// Watchers already hear about it; a muted list stays quiet
			if !watching[uid] && !muted[uid] {
				members = append(members, uid)
			}
		}
		s.planNotify(b, "taskDone", actorID, members, single(changeDone))
	}
	// Moved into a shared list: new there for its members
	if moved && isTask(after) {
		s.planTaskAdded(b, actorID, after, watching, audience)
	}
	return watchers
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
	var b notifyBatch
	s.planTaskAdded(&b, actorID, t, skip, s.taskAudience(t))
	s.storeBatch(&b)
}

// insertTask creates a task in one write (storage.CreateTask) together with the notifications about it:
// its list's members hear that it was added, people mentioned in its description that they were. Then
// everyone who sees it gets it in their open apps.
func (s *Server) insertTask(userID, content, priority, source, dueDate, taskListID, notes string, actor *apiActor) (*domain.Thought, error) {
	var b notifyBatch
	plan := func(t *domain.Thought, members []string) ([]storage.CenterAdd, []storage.QueuedAdd) {
		audience := append(slices.Clone(members), t.UserID)
		if t.TaskListID != "" {
			s.planTaskAdded(&b, userID, t, nil, audience)
		}
		s.planTaskMentions(&b, userID, nil, t, audience)
		return b.center, b.queue
	}
	task, members, added, err := s.store.CreateTask(userID, content, priority, source, dueDate, taskListID, notes, plan)
	if err != nil {
		return nil, err
	}
	s.recordThoughtOrigin(task, actor, true)
	s.wsHub.BroadcastToUsers(append(members, task.UserID), "TASK_CREATED", task)
	s.sendBatch(&b, added)
	return task, nil
}

// planTaskAdded adds to b that a task was added to its list, for the list's members (audience, as
// taskAudience gives it) but those in skip.
func (s *Server) planTaskAdded(b *notifyBatch, actorID string, t *domain.Thought, skip map[string]bool, audience []string) {
	if !othersIn(audience, actorID) {
		return // a personal list: nobody to tell
	}
	list := s.store.TaskListTitle(actorID, t.TaskListID)
	muted := s.store.TaskListMutedBy(t.TaskListID, audience)
	var members []string
	for _, uid := range audience {
		if !skip[uid] && !muted[uid] {
			members = append(members, uid)
		}
	}
	title := taskTitle(t)
	s.planNotify(b, "taskCreated", actorID, members, func(lang string) map[string]string {
		return map[string]string{
			"title":      title,
			"text":       i18n.T(lang, taskAddedToList, "name", s.actorName(lang, actorID), "title", title, "list", list),
			centerTarget: "task",
			centerID:     t.ID,
		}
	})
}

// othersIn: someone besides the actor is among the people (so the list's title, mutes and the like are
// worth reading).
func othersIn(people []string, actorID string) bool {
	for _, id := range people {
		if id != actorID {
			return true
		}
	}
	return false
}

// --- Background jobs ---

func (s *Server) startNotificationJobs() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		var now time.Time
		select {
		case <-s.stop:
			return
		case now = <-ticker.C:
		}
		s.flushNotifications(now)
		s.sendDailySummaries(now)
		if now.Minute()%30 == 0 {
			s.store.PruneCenter(now)
		}
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
		// The channels each event goes out on in this run: those chosen for its kind but the ones that
		// got it in an earlier run while another failed
		pending := make([]domain.ChannelChoice, len(queued))
		// Events with the same key (the same change to the same task) go out once, as the latest
		last := map[string]int{}
		for i, q := range queued {
			if k := q.Payload["key"]; k != "" {
				last[q.Kind+"|"+k] = i
			}
		}
		for i, q := range queued {
			if set.Paused {
				continue
			}
			if k := q.Payload["key"]; k != "" && last[q.Kind+"|"+k] != i {
				continue
			}
			pending[i] = withoutChannels(set.Channels(q.Kind), q.Delivered)
			item := notifyItem{kind: q.Kind, title: q.Payload["title"], text: q.Payload["text"]}
			out.add(pending[i], item)
		}
		failed := s.deliver(uid, headingNews, out, false, now)
		// An event is done once every channel it went out on got it (or has nothing to deliver to); one
		// with a failed channel stays queued for that channel alone, up to notifyMaxAttempts runs
		var done, dropped []int64
		retry := map[int64][]string{}
		for i, q := range queued {
			delivered := slices.Clone(q.Delivered)
			missing := false
			for _, c := range channelNames(pending[i]) {
				if failed[c] != nil {
					missing = true
				} else {
					delivered = append(delivered, c)
				}
			}
			switch {
			case !missing:
				done = append(done, q.ID)
			case q.Attempts+1 >= notifyMaxAttempts:
				dropped = append(dropped, q.ID)
			default:
				retry[q.ID] = delivered
			}
		}
		for c, err := range failed {
			slog.Warn("Notifications not delivered", "channel", c, "user_id", uid, "retry", len(retry), "dropped", len(dropped), "error", err)
		}
		if len(dropped) > 0 {
			slog.Warn("Notifications dropped after several failed attempts", "user_id", uid, "count", len(dropped))
		}
		// Left in the queue they would go out a second time
		logFailed("Removing delivered notifications from the queue", s.store.DeleteQueuedNotifications(append(done, dropped...)), "user_id", uid)
		if len(retry) > 0 {
			logFailed("Counting a failed attempt to notify", s.store.RetryQueuedNotifications(retry), "user_id", uid)
		}
	}
}

// channelNames lists the chosen channels by the names the queue and the logs use.
func channelNames(ch domain.ChannelChoice) []string {
	var out []string
	for _, c := range []struct {
		on   bool
		name string
	}{{ch.Email, "email"}, {ch.Discord, "discord"}, {ch.Webhook, "webhook"}, {ch.Push, "push"}} {
		if c.on {
			out = append(out, c.name)
		}
	}
	return out
}

// onlyChannels is the choice limited to the named channels (those a daily summary failed on).
func onlyChannels(ch domain.ChannelChoice, names []string) domain.ChannelChoice {
	ch.Email = ch.Email && slices.Contains(names, "email")
	ch.Discord = ch.Discord && slices.Contains(names, "discord")
	ch.Webhook = ch.Webhook && slices.Contains(names, "webhook")
	ch.Push = ch.Push && slices.Contains(names, "push")
	return ch
}

// withoutChannels is the choice without the named channels (those that got an event already).
func withoutChannels(ch domain.ChannelChoice, names []string) domain.ChannelChoice {
	ch.Email = ch.Email && !slices.Contains(names, "email")
	ch.Discord = ch.Discord && !slices.Contains(names, "discord")
	ch.Webhook = ch.Webhook && !slices.Contains(names, "webhook")
	ch.Push = ch.Push && !slices.Contains(names, "push")
	return ch
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

// deliver sends the items to the user's mail address, Discord webhook, own webhook and/or devices
// (push) and returns the channels that failed, with their error (none: every channel got through). A
// channel with nothing to deliver to (no address, no webhook, no push device) is skipped, not failed.
// now is the time the run is for (greeting "Guten Morgen" follows the summary time, not the clock).
func (s *Server) deliver(userID, heading string, out channelItems, summary bool, now time.Time) map[string]error {
	emailItems, discordItems := out.email, out.discord
	u, err := s.store.GetUserByID(userID)
	if err != nil || u == nil || !u.IsActive {
		return nil // account gone: nothing to deliver
	}
	lang := s.userLanguage(userID)
	heading = i18n.T(lang, heading)
	failed := map[string]error{}
	fail := func(channel string, err error) {
		if err != nil {
			failed[channel] = err
		}
	}
	// An account without an address (first admin from ADMIN_USER without ADMIN_EMAIL) gets no mails
	if len(emailItems) > 0 && u.Email != "" {
		to := u.Email // the confirmed login address
		subject := "MindSift: " + heading
		if len(emailItems) == 1 {
			subject = "MindSift: " + emailItems[0].text
		}
		c := s.digestMail(lang, u.DisplayName, emailItems, now)
		if summary {
			c = s.summaryMail(lang, u.DisplayName, emailItems, now)
		}
		text, htmlBody := renderMail(c)
		fail("email", s.sendNotifyEmail(to, subject, text, htmlBody))
	}
	if len(discordItems) > 0 && u.DiscordWebhookURL != "" {
		fail("discord", s.sendNotifyDiscord(lang, u.DiscordWebhookURL, heading, discordItems))
	}
	if len(out.webhook) > 0 && u.CustomWebhookURL != "" {
		fail("webhook", s.sendNotifyWebhook(u.CustomWebhookURL, heading, out.webhook))
	}
	if len(out.push) > 0 {
		// Without a device there is nothing to deliver, and nothing to try again
		if err := s.sendPush(userID, pushDigest(lang, heading, out.push, s.notifyLink())); !errors.Is(err, errNoPushDevice) {
			fail("push", err)
		}
	}
	return failed
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
	body, _ := json.Marshal(map[string]any{
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
	body, _ := json.Marshal(map[string]any{
		"embeds": []map[string]any{{
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

// dailySummaryWindow: the summary goes out in this time after the chosen time, a failed channel is tried
// again in every run within it.
const dailySummaryWindow = 30 * time.Minute

// sendDailySummaries sends each user who wants one their summary in the 30 minutes after the chosen
// time (server time zone), once a day. Nothing due → no message.
func (s *Server) sendDailySummaries(now time.Time) {
	now = clock.In(now)
	day := now.Format("2006-01-02")
	for _, uid := range s.store.ActiveUserIDs() {
		set := s.store.NotificationSettingsOf(uid)
		ds := set.DailySummary
		if set.Paused || !ds.Enabled || (!ds.Email && !ds.Discord && !ds.Webhook && !ds.Push) {
			continue
		}
		at, err := time.ParseInLocation("2006-01-02 15:04", day+" "+ds.Time, now.Location())
		if err != nil || now.Before(at) {
			continue
		}
		retry, claimed := s.store.DailySummaryRetry(uid, day)
		if now.Sub(at) >= dailySummaryWindow {
			if len(retry) > 0 {
				slog.Warn("Daily summary given up on channels that kept failing", "channels", strings.Join(retry, ","), "user_id", uid)
				logFailed("Clearing the channels of a daily summary given up", s.store.SetDailySummaryRetry(uid, day, nil), "user_id", uid)
			}
			continue
		}
		if claimed && len(retry) == 0 {
			continue // sent today, every channel got it
		}
		items := s.summaryItems(uid, now)
		if len(items) == 0 {
			if claimed { // nothing left to tell (tasks done since): no retry
				logFailed("Clearing the channels of a daily summary", s.store.SetDailySummaryRetry(uid, day, nil), "user_id", uid)
			}
			continue
		}
		// Claimed before it goes out, so no channel gets it twice; a retry goes out on the channels that
		// failed only (and are still chosen)
		choice := domain.ChannelChoice{Email: ds.Email, Discord: ds.Discord, Webhook: ds.Webhook, Push: ds.Push}
		if claimed {
			choice = onlyChannels(choice, retry)
		} else if !s.store.ClaimDailySummary(uid, day) {
			continue
		}
		var out channelItems
		out.add(choice, items...)
		failed := s.deliver(uid, headingSummary, out, true, now)
		var again []string
		for _, c := range channelNames(choice) {
			if err := failed[c]; err != nil {
				again = append(again, c)
				slog.Warn("Sending the daily summary failed, will try again", "channel", c, "user_id", uid, "until", at.Add(dailySummaryWindow).Format("15:04"), "error", err)
			}
		}
		if claimed || len(again) > 0 {
			logFailed("Recording the channels of a daily summary to try again", s.store.SetDailySummaryRetry(uid, day, again), "user_id", uid)
		}
	}
}

// summaryItems: overdue, today, tomorrow (with time), plus how many follow in the next 7 days.
func (s *Server) summaryItems(userID string, now time.Time) []notifyItem {
	now = clock.In(now)
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
		writeInternal(w, err)
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
