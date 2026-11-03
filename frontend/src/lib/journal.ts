// Journal helpers: dates are local calendar days as YYYY-MM-DD (the server stores them as given).

export const JOURNAL_ENABLED_KEY = 'mindsift_journal_enabled';

export function isJournalEnabled(): boolean {
  try {
    return localStorage.getItem(JOURNAL_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setJournalEnabled(on: boolean) {
  try {
    localStorage.setItem(JOURNAL_ENABLED_KEY, on ? 'true' : 'false');
  } catch {
    // storage blocked: the setting simply does not stick
  }
}

export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISODate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** "Fr, 30. Okt. 2026" for compact labels */
export function shortDateLabel(date: string): string {
  return parseISODate(date).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Weeks of a month for a Monday-first grid; days outside the month are null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toISODate(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Workspace state for this browser tab: is the journal open, which regular note was open last
const WORKSPACE_SESSION_KEY = 'mindsift_workspace_view';

export function readWorkspaceSession(): { journal: boolean; docId: string | null } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(WORKSPACE_SESSION_KEY) || '{}');
    return { journal: raw.journal === true, docId: typeof raw.docId === 'string' ? raw.docId : null };
  } catch {
    return { journal: false, docId: null };
  }
}

export function writeWorkspaceSession(state: { journal: boolean; docId: string | null }) {
  try {
    sessionStorage.setItem(WORKSPACE_SESSION_KEY, JSON.stringify(state));
  } catch {
    // storage blocked: the view simply starts fresh
  }
}
