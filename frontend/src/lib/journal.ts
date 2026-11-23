import i18n from '../i18n';
import { formatDate } from './format';
import { localDay } from './due';

// Journal helpers: dates are local calendar days as YYYY-MM-DD (the server stores them as given).

const JOURNAL_ENABLED_KEY = 'mindsift_journal_enabled';

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

export function todayISO(): string {
  return localDay();
}

export function parseISODate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// Month names in the language shown when called (common:date.months.0–11)
export const monthNames = (): string[] => Array.from({ length: 12 }, (_, i) => i18n.t(`common:date.months.${i}`));

/** "Fr, 30. Okt. 2026" for compact labels */
export function shortDateLabel(date: string): string {
  return formatDate(parseISODate(date), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
