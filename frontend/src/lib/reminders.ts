import i18n from '../i18n';

// Reminders of a task (Thought.reminders): minutes before its due date that replace each person's lead
// time. The same choices as the server (domain.AllowedReminders); whole days count as calendar days.
export const REMINDER_CHOICES = [43200, 20160, 10080, 4320, 2880, 1440, 120, 60, 30, 15, 0];

// All-day tasks remind at 09:00 minus whole days, so only those make sense without a time
export const isDayReminder = (minutes: number) => minutes % 1440 === 0;

export const reminderLabel = (minutes: number, allDay = false): string =>
  minutes === 0 && allDay ? i18n.t('tasks:detail.reminder.m0AllDay') : i18n.t(`tasks:detail.reminder.m${minutes}`);

// "2 Wochen vorher, 1 Tag vorher" (earliest first)
export const remindersText = (reminders: number[], allDay = false): string =>
  [...reminders].sort((a, b) => b - a).map((m) => reminderLabel(m, allDay)).join(', ');
