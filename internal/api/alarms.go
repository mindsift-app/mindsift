package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- MULTI-CHANNEL ALARM DISPATCHER (EMAIL, DISCORD, CUSTOM WEBHOOK) ---

// sendMailContent sends a mail in the common MindSift look (mailtemplate.go), as text and HTML.
func (s *Server) sendMailContent(toEmail, subject string, c mailContent) error {
	text, htmlBody := renderMail(c)
	return s.sendEmailHTML(toEmail, subject, text, htmlBody)
}

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

// dueAlarmMail: one task is due now.
func (s *Server) dueAlarmMail(lang string, a storage.DueTaskAlarm, due string) mailContent {
	meta := i18n.T(lang, "Fällig: {due}", "due", due)
	if a.Priority != "" && a.Priority != "normal" {
		meta += " · " + domain.PriorityLabel(lang, a.Priority)
	}
	c := mailContent{
		Lang:      lang,
		Preheader: i18n.T(lang, "Fällig: {due}", "due", a.Title),
		Greeting:  mailGreeting(lang, time.Now(), a.UserName),
		Intro:     i18n.T(lang, "Eine deiner Aufgaben ist jetzt fällig:"),
		Sections:  []mailSection{{Items: []mailItem{{Title: a.Title, Meta: meta, Body: a.Notes, Tone: priorityTone(a.Priority)}}}},
		Footer:    mailFooterAlarms(lang),
	}
	if link := s.notifyLink(); link != "" {
		c.Button = &mailButton{Label: i18n.T(lang, "In MindSift öffnen"), URL: link}
	}
	return c
}

// sendEmailHTML sends text plus an optional HTML version (multipart/alternative).
func (s *Server) sendEmailHTML(toEmail, subject, bodyText, html string) error {
	if s.cfg.DemoMode {
		return errDemoOutgoing
	}
	cfg, err := s.smtpSettings()
	if err != nil {
		return err
	}
	if s.notifyEmailHook != nil { // tests
		return s.notifyEmailHook(toEmail, subject, bodyText, html)
	}
	if err := sendMail(cfg, toEmail, subject, bodyText, html); err != nil {
		step := ""
		if se, ok := err.(*smtpStepError); ok {
			step = se.Step
		}
		slog.Warn("E-Mail-Versand fehlgeschlagen", "smtp_step", step, "host", cfg.Host, "port", cfg.Port, "to", toEmail, "error", err)
		return err
	}
	return nil
}

func (s *Server) sendDiscordNotification(lang, webhookURL, title, description, dueDate, priority string) error {
	if s.cfg.DemoMode {
		return errDemoOutgoing
	}
	allowPrivate := s.allowPrivateWebhooks()
	if err := validateWebhookURL(webhookURL, true, allowPrivate); err != nil {
		return err
	}
	httpClient := guardedClient(allowPrivate)
	payload := map[string]interface{}{
		"content": "⏰ **" + i18n.T(lang, "MindSift Aufgaben-Alarm") + "**",
		"embeds": []map[string]interface{}{
			{
				"title":       title,
				"description": description + "\n\n**" + i18n.T(lang, "Fällig") + ":** " + dueDate + " | **" + i18n.T(lang, "Priorität") + ":** " + domain.PriorityLabel(lang, priority),
				"color":       2450411,
				"footer": map[string]string{
					"text": i18n.T(lang, "MindSift Alarm-System"),
				},
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := httpClient.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP Status %d", resp.StatusCode)
	}
	return nil
}

func (s *Server) sendCustomWebhookNotification(webhookURL, event, title, notes, dueDate, priority string) error {
	if s.cfg.DemoMode {
		return errDemoOutgoing
	}
	allowPrivate := s.allowPrivateWebhooks()
	if err := validateWebhookURL(webhookURL, false, allowPrivate); err != nil {
		return err
	}
	httpClient := guardedClient(allowPrivate)
	payload := map[string]interface{}{
		"event":     event,
		"title":     title,
		"notes":     notes,
		"dueDate":   dueDate,
		"priority":  priority,
		"timestamp": domain.NowISO(),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := httpClient.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP Status %d", resp.StatusCode)
	}
	return nil
}

// alarmDue reports whether the alarm for a due date should go out now: from the due time (09:00 for
// all-day tasks) minus the user's lead time on. Unreadable dates never fire.
func alarmDue(dueDate string, notifyBeforeMinutes int, now time.Time) bool {
	at, ok := domain.DueAlarmAt(dueDate, notifyBeforeMinutes, now.Location())
	return ok && !now.Before(at)
}

func (s *Server) startAlarmTicker() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		alarms, err := s.store.GetDueTasksForAlarm()
		if err != nil || len(alarms) == 0 {
			continue
		}

		now := time.Now()

		for _, a := range alarms {
			if !alarmDue(a.DueDate, a.NotifyBeforeMinutes, now) {
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
			if a.AlarmEmail == "" {
				a.AlarmEmail = a.UserEmail
			}
			a.AlarmChannels = channels
			if len(a.AlarmChannels) == 0 {
				continue
			}

			sentAny := false
			lang := s.userLanguage(a.UserID)
			due := domain.HumanDue(lang, a.DueDate)
			desc := a.Notes
			if desc == "" {
				desc = i18n.T(lang, "Aufgabe ist jetzt fällig.")
			}

			for _, ch := range a.AlarmChannels {
				switch ch {
				case "discord":
					if a.DiscordWebhookURL != "" {
						if err := s.sendDiscordNotification(lang, a.DiscordWebhookURL, a.Title, desc, due, a.Priority); err == nil {
							sentAny = true
						}
					}
				case "push":
					if err := s.sendPush(a.UserID, pushMessage{Title: "⏰ " + i18n.T(lang, "Aufgabe fällig"), Body: a.Title + " – " + due, URL: "/", Tag: "task-" + a.TaskID}); err == nil {
						sentAny = true
					}
				case "webhook":
					if a.CustomWebhookURL != "" {
						if err := s.sendCustomWebhookNotification(a.CustomWebhookURL, "task_due", a.Title, desc, a.DueDate, a.Priority); err == nil {
							sentAny = true
						}
					}
				case "email":
					if a.AlarmEmail != "" {
						if err := s.sendMailContent(a.AlarmEmail, "⏰ "+i18n.T(lang, "Fällig: {due}", "due", a.Title), s.dueAlarmMail(lang, a, due)); err == nil {
							sentAny = true
						}
					}
				}
			}

			if sentAny {
				if err := s.store.MarkTaskAlarmSent(a.TaskID); err != nil {
					slog.Error("Alarm als gesendet markieren fehlgeschlagen (wird erneut gesendet)", "task_id", a.TaskID, "error", err)
				}
			} else if gaveUp, _ := s.store.RecordTaskAlarmFailure(a.TaskID); gaveUp {
				slog.Warn("Aufgaben-Alarm nach 3 Fehlversuchen aufgegeben", "task_id", a.TaskID, "title", a.Title)
			}
		}
	}
}
