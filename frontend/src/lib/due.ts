// Due dates come as "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM" (with time), in the server's time zone.
// Both sort correctly as plain strings.

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD (toISOString would give the UTC day). */
export const localDay = (d: Date = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const addDays = (days: number, from: Date = new Date()): string => {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return localDay(d);
};

export const splitDue = (due?: string): { date: string; time: string } => {
  if (!due) return { date: '', time: '' };
  const [date, time = ''] = due.split('T');
  return { date, time: time.slice(0, 5) };
};

export const joinDue = (date: string, time: string): string => (date ? (time ? `${date}T${time}` : date) : '');

/** A task with a time is overdue once that minute has passed, an all-day task from the next day on. */
export const isOverdue = (due: string | undefined, now: Date = new Date()): boolean => {
  if (!due) return false;
  const { date, time } = splitDue(due);
  const today = localDay(now);
  if (date !== today) return date < today;
  return !!time && time < `${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

export const isDueToday = (due: string | undefined, now: Date = new Date()): boolean =>
  !!due && splitDue(due).date === localDay(now);

const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];

/** Short label: "Heute, 14:30", "Morgen", "Gestern", "Fr., 30.10." or "30.10.2027" in another year. */
export const formatDue = (due: string | undefined, now: Date = new Date()): string => {
  if (!due) return '';
  const { date, time } = splitDue(due);
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return due;
  let label: string;
  if (date === localDay(now)) label = 'Heute';
  else if (date === addDays(1, now)) label = 'Morgen';
  else if (date === addDays(-1, now)) label = 'Gestern';
  else if (y === now.getFullYear()) label = `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${pad(d)}.${pad(m)}.`;
  else label = `${pad(d)}.${pad(m)}.${y}`;
  return time ? `${label}, ${time}` : label;
};

/** When something went to a trash, e.g. "01.11.2026, 14:05". */
export const formatDeletedAt = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
