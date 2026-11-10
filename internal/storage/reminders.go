package storage

import (
	"errors"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Reminders of a task (thoughts.reminders): minutes before its due date that replace the lead time of
// everyone who gets its due alarm. "Sent" is kept per task, person and reminder in task_alarms_sent;
// ReminderLeadTime stands for the person's own lead time.

// ReminderLeadTime marks the alarm at a person's own lead time (a task without reminders)
const ReminderLeadTime = -1

// ErrInvalidReminders: a reminder that is not one of the choices (domain.AllowedReminders)
var ErrInvalidReminders = errors.New("Unbekannte Erinnerung (erlaubt: 0, 15, 30, 60, 120 Minuten, 1, 2, 3, 7, 14 Tage, 1 Monat vorher)")

func (s *Store) migrateReminders() error {
	if err := s.execSchemaStatement(`ALTER TABLE thoughts ADD COLUMN reminders TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	// "Sent" per reminder: the table gets the reminder as part of its key; rows so far were the lead time
	return s.execInTx(
		stmt(`DROP TRIGGER IF EXISTS task_alarm_rearm`),
		stmt(`CREATE TABLE task_alarms_sent_new (
			task_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			reminder INTEGER NOT NULL DEFAULT -1,
			sent INTEGER NOT NULL DEFAULT 0,
			failures INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (task_id, user_id, reminder)
		)`),
		stmt(`INSERT INTO task_alarms_sent_new (task_id, user_id, reminder, sent, failures)
			SELECT task_id, user_id, -1, sent, failures FROM task_alarms_sent`),
		stmt(`DROP TABLE task_alarms_sent`),
		stmt(`ALTER TABLE task_alarms_sent_new RENAME TO task_alarms_sent`),
		stmt(`CREATE TRIGGER IF NOT EXISTS task_alarm_rearm AFTER UPDATE OF alarm_sent ON thoughts
			WHEN OLD.alarm_sent = 1 AND NEW.alarm_sent = 0
			BEGIN DELETE FROM task_alarms_sent WHERE task_id = NEW.id; END`),
	)
}

// SetTaskReminders replaces the reminders of a task (editors of its list or its owner); empty = the lead
// time of each person again. Reminders already sent for the current due date stay sent.
func (s *Store) SetTaskReminders(userID, taskID string, reminders []int) ([]int, error) {
	clean, ok := domain.NormalizeReminders(reminders)
	if !ok {
		return nil, ErrInvalidReminders
	}
	t, err := s.GetThoughtByID(userID, taskID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureTaskListWritable(userID, t.TaskListID); err != nil {
		return nil, err
	}
	_, err = s.db.Exec(`UPDATE thoughts SET reminders = ? WHERE id = ?`, domain.FormatReminders(clean), taskID)
	return clean, err
}
