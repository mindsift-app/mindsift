package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- MULTI-CHANNEL ALARM DISPATCHER (EMAIL, DISCORD, CUSTOM WEBHOOK, PUSH, DESKTOP) ---

// Footers: why a mail came
func mailFooterAlarms(lang string) string {
	return i18n.T(lang, "Du bekommst diese E-Mail, weil du E-Mail-Benachrichtigungen eingeschaltet hast. Ändern kannst du das in MindSift unter Kontoeinstellungen → Alarme.")
}

func mailFooterAccount(lang string) string {
	return i18n.T(lang, "Diese E-Mail betrifft dein MindSift-Konto und kommt deshalb unabhängig von deinen Benachrichtigungen.")
}

// priorityTone: how a task's priority is coloured in mails (domain.PriorityLabel gives the text)
func priorityTone(p string) string {
	switch p {
	case "urgent":
		return "danger"
	case "high":
		return "warning"
	}
	return ""
}

// earlyReminder: the alarm comes a day or more ahead (a reminder of the task or the lead time "1 day");
// its texts name the due date instead of saying the task is due now
func earlyReminder(a storage.DueTaskAlarm) bool { return a.NotifyBeforeMinutes >= 24*60 }

// dueAlarmMail: one task is due now, or soon for an early reminder. now is the time of the alarm run:
// the greeting follows it, not the clock.
func (s *Server) dueAlarmMail(lang string, a storage.DueTaskAlarm, due string, now time.Time) mailContent {
	meta := i18n.T(lang, "Fällig: {due}", "due", due)
	if a.Priority != "" && a.Priority != "normal" {
		meta += " · " + domain.PriorityLabel(lang, a.Priority)
	}
	preheader := i18n.T(lang, "Fällig: {due}", "due", a.Title)
	intro := i18n.T(lang, "Eine deiner Aufgaben ist jetzt fällig:")
	if earlyReminder(a) {
		preheader = i18n.T(lang, "Erinnerung: {title}", "title", a.Title)
		intro = i18n.T(lang, "Erinnerung: Diese Aufgabe ist am {due} fällig:", "due", due)
	}
	c := mailContent{
		Lang:      lang,
		Preheader: preheader,
		Greeting:  mailGreeting(lang, now, a.UserName),
		Intro:     intro,
		Sections:  []mailSection{{Items: []mailItem{{Title: a.Title, Meta: meta, Body: a.Notes, Tone: priorityTone(a.Priority)}}}},
		Footer:    mailFooterAlarms(lang),
	}
	if link := s.notifyLink(); link != "" {
		c.Button = &mailButton{Label: i18n.T(lang, "In MindSift öffnen"), URL: link}
	}
	return c
}

// deliveryProblem: why a test message did not reach the person's own Discord or webhook target, as far
// as it may be told (the HTTP status, a refused address); network details such as resolved addresses stay
// in the server log.
func deliveryProblem(w http.ResponseWriter, err error) string {
	if clientSafe(err) {
		return trErr(w, err)
	}
	slog.Warn("Test message not delivered", "error", err)
	return tr(w, "Ziel nicht erreichbar")
}

func (s *Server) sendDiscordNotification(lang, webhookURL, title, description, dueDate, priority string) error {
	return s.postWebhook("discord", webhookURL, map[string]any{
		"content": "⏰ **" + i18n.T(lang, "MindSift Aufgaben-Alarm") + "**",
		"embeds": []map[string]any{
			{
				"title":       title,
				"description": description + "\n\n**" + i18n.T(lang, "Fällig") + ":** " + dueDate + " | **" + i18n.T(lang, "Priorität") + ":** " + domain.PriorityLabel(lang, priority),
				"color":       2450411,
				"footer": map[string]string{
					"text": i18n.T(lang, "MindSift Alarm-System"),
				},
			},
		},
	})
}

// sendCustomWebhookNotification posts an alarm to the person's own webhook; extra adds fields (nil: none).
func (s *Server) sendCustomWebhookNotification(webhookURL, event, title, notes, dueDate, priority string, extra map[string]any) error {
	payload := map[string]any{
		"event":     event,
		"title":     title,
		"notes":     notes,
		"dueDate":   dueDate,
		"priority":  priority,
		"timestamp": domain.NowISO(),
	}
	for k, v := range extra {
		payload[k] = v
	}
	return s.postWebhook("webhook", webhookURL, payload)
}

// postWebhook posts payload as JSON to a person's Discord webhook (channel "discord") or own webhook
// ("webhook"), for alarms and bundled notifications alike: nothing in the demo, only to an address
// validateWebhookURL allows, through the guarded client. A status of 400 or more is an error people may
// be shown (the test message in the settings).
func (s *Server) postWebhook(channel, webhookURL string, payload map[string]any) error {
	if s.cfg.DemoMode {
		return errDemoOutgoing
	}
	allowPrivate := s.allowPrivateWebhooks()
	if err := validateWebhookURL(webhookURL, channel == "discord", allowPrivate); err != nil {
		return err
	}
	if s.webhookOutHook != nil { // tests
		return s.webhookOutHook(channel, webhookURL, payload)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	client := s.webhookHTTPClient
	if client == nil {
		client = guardedClient(allowPrivate)
	}
	resp, err := client.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return i18n.NewError("HTTP-Status {status}", "status", strconv.Itoa(resp.StatusCode))
	}
	return nil
}

// alarmDue reports whether the alarm for a due date should go out now: from the due time (09:00 for
// all-day tasks) minus the lead time or reminder on, read in the server's time zone (clock). Unreadable
// dates never fire.
func alarmDue(dueDate string, notifyBeforeMinutes int, now time.Time) bool {
	at, ok := domain.DueAlarmAt(dueDate, notifyBeforeMinutes, clock.Location())
	return ok && !now.Before(at)
}

func (s *Server) startAlarmTicker() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
		}
		done := s.demoPass()
		s.checkAlarms(time.Now())
		done()
	}
}

// errChannelNotSetUp: a chosen alarm channel has nothing to deliver to (no address, no webhook, no
// device); it is skipped, not tried again.
var errChannelNotSetUp = errors.New("channel not set up")

// checkAlarms sends the alarms whose time has come (and puts them into the notification center). The
// run has its own circuit breaker (outages): a mail server, webhook host or push service that is down is
// tried once, the alarms after it skip that channel and get it in a later run.
func (s *Server) checkAlarms(now time.Time) {
	alarms, err := s.store.GetDueTasksForAlarm()
	if err != nil {
		slog.Error("Reading the due task alarms failed", "error", err)
		return
	}
	run := &outages{}
	for _, a := range alarms {
		if !alarmDue(a.DueDate, a.NotifyBeforeMinutes, now) {
			continue
		}
		// The bell gets every due task once per due date and reminder, whatever the channels or a pause
		centerLang := s.userLanguage(a.UserID)
		centerText := dueCenterText
		if earlyReminder(a) {
			centerText = remindCenterText
		}
		centerKey := "due:" + a.TaskID + ":" + a.DueDate
		if a.Reminder != storage.ReminderLeadTime {
			centerKey += ":" + strconv.Itoa(a.Reminder)
		}
		s.storeCenterEntry(a.UserID, storage.CenterEntry{
			Kind: "due", Title: a.Title, TargetType: "task", TargetID: a.TaskID,
			Text: i18n.T(centerLang, centerText, "title", a.Title, "due", domain.HumanDue(centerLang, a.DueDate)),
		}, centerKey, storage.CenterOnce, "")
		if s.cfg.DemoMode {
			continue
		}
		// Channels come from the notification settings (row "due"); a pause holds the alarm back
		set := s.store.NotificationSettingsOf(a.UserID)
		if set.Paused {
			continue
		}
		channels := []string{}
		if set.Events.Due.Email {
			channels = append(channels, "email")
		}
		if set.Events.Due.Discord {
			channels = append(channels, "discord")
		}
		if set.Events.Due.Webhook {
			channels = append(channels, "webhook")
		}
		if set.Events.Due.Push {
			channels = append(channels, "push")
		}
		if set.Events.Due.Desktop {
			channels = append(channels, "desktop")
		}
		a.AlarmChannels = channels
		if len(a.AlarmChannels) == 0 {
			continue
		}

		lang := s.userLanguage(a.UserID)
		due := domain.HumanDue(lang, a.DueDate)
		desc := a.Notes
		if desc == "" && earlyReminder(a) {
			desc = i18n.T(lang, "Aufgabe ist am {due} fällig.", "due", due)
		} else if desc == "" {
			desc = i18n.T(lang, "Aufgabe ist jetzt fällig.")
		}
		pushTitle, subject := "⏰ "+i18n.T(lang, "Aufgabe fällig"), "⏰ "+i18n.T(lang, "Fällig: {due}", "due", a.Title)
		if earlyReminder(a) {
			pushTitle, subject = "🔔 "+i18n.T(lang, "Erinnerung an eine Aufgabe"), "🔔 "+i18n.T(lang, "Erinnerung: {title}", "title", a.Title)
		}

		// Each chosen channel once: one that got through in an earlier run is left out, one that failed
		// is tried again in the next run (up to MaxAlarmFailures runs), one that is not set up (no
		// address, no webhook, no device) is skipped. One the circuit breaker skipped (its target failed
		// earlier in this run) is tried again in the next run too, but counts no failure: it was not tried
		var delivered []string
		missing, tried := false, false
		for _, ch := range a.AlarmChannels {
			if slices.Contains(a.Delivered, ch) {
				continue
			}
			var err error
			switch ch {
			case "discord":
				err = errChannelNotSetUp
				if a.DiscordWebhookURL != "" {
					err = run.send(webhookTarget(a.DiscordWebhookURL), func() error {
						return s.sendDiscordNotification(lang, a.DiscordWebhookURL, a.Title, desc, due, a.Priority)
					})
				}
			case "push":
				err = s.sendPushVia(a.UserID, pushMessage{Title: pushTitle, Body: a.Title + " – " + due, URL: "/", Tag: "task-" + a.TaskID}, run)
				if errors.Is(err, errNoPushDevice) {
					err = errChannelNotSetUp
				}
			case "desktop":
				// The desktop app's system notification; a click opens the task (no notifier outside the
				// app's local instances: not set up)
				err = s.notifyDesktop(DesktopNotification{Title: pushTitle, Body: a.Title + " – " + due, TaskID: a.TaskID, Tag: "task-" + a.TaskID})
			case "webhook":
				err = errChannelNotSetUp
				if a.CustomWebhookURL != "" {
					err = run.send(webhookTarget(a.CustomWebhookURL), func() error {
						return s.sendCustomWebhookNotification(a.CustomWebhookURL, "task_due", a.Title, desc, a.DueDate, a.Priority, map[string]any{"remindBeforeMinutes": a.NotifyBeforeMinutes})
					})
				}
			case "email":
				// Always the confirmed login address; there is no address of its own for alarms
				err = errChannelNotSetUp
				if a.UserEmail != "" {
					err = run.send("email", func() error { return s.sendMailContent(a.UserEmail, subject, s.dueAlarmMail(lang, a, due, now)) })
				}
			}
			switch {
			case err == nil:
				delivered = append(delivered, ch)
			case errors.Is(err, errChannelNotSetUp):
				slog.Info("Task alarm channel not set up, skipped", "channel", ch, "task_id", a.TaskID, "user_id", a.UserID)
			case skipped(err):
				missing = true
				slog.Info("Task alarm held back for the next run", "channel", ch, "task_id", a.TaskID, "user_id", a.UserID, "error", err)
			default:
				missing, tried = true, true
				slog.Warn("Task alarm not delivered, will try again", "channel", ch, "task_id", a.TaskID, "user_id", a.UserID, "error", err)
			}
		}

		if !missing {
			if err := s.store.MarkTaskAlarmSent(a.TaskID, a.UserID, a.Reminder); err != nil {
				slog.Error("Marking the alarm as sent failed (it will be sent again)", "task_id", a.TaskID, "error", err)
			}
			continue
		}
		if len(delivered) > 0 {
			logFailed("Recording the channels an alarm reached", s.store.MarkTaskAlarmDelivered(a.TaskID, a.UserID, a.Reminder, delivered), "task_id", a.TaskID)
		}
		if !tried {
			continue // only skipped: the next run sends it, no failure counted
		}
		if gaveUp, _ := s.store.RecordTaskAlarmFailure(a.TaskID, a.UserID, a.Reminder); gaveUp {
			slog.Warn("Task alarm given up after 3 failed attempts", "task_id", a.TaskID, "user_id", a.UserID, "title", a.Title)
		}
	}
}
