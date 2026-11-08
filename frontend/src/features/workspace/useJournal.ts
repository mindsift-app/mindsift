import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, JournalDay } from '../../lib/types';
import { api } from '../../lib/api';
import { isJournalEnabled, todayISO } from '../../lib/journal';

// Journal of the workspace: the days with a note, the day shown and jumps to a day (can be switched off per device)
export function useJournal(setDocs: React.Dispatch<React.SetStateAction<Document[]>>) {
  const [journalEnabled] = useState(isJournalEnabled);
  const [journalDays, setJournalDays] = useState<JournalDay[]>([]);
  const [journalExtra, setJournalExtra] = useState<string[]>([]);
  const [journalActive, setJournalActive] = useState(todayISO);
  const [journalJump, setJournalJump] = useState<{ date: string; nonce: number } | null>(null);
  const reloadJournal = useCallback(() => {
    if (!journalEnabled) return;
    api.getJournal().then(setJournalDays).catch(() => {});
  }, [journalEnabled]);
  useEffect(() => {
    reloadJournal();
  }, [reloadJournal]);
  // After typing, refresh which days have text (calendar dots) – at most every few seconds
  const journalReloadTimer = useRef<number | null>(null);
  const reloadJournalSoon = useCallback(() => {
    if (journalReloadTimer.current !== null) return;
    journalReloadTimer.current = window.setTimeout(() => {
      journalReloadTimer.current = null;
      reloadJournal();
    }, 3000);
  }, [reloadJournal]);
  useEffect(() => () => {
    if (journalReloadTimer.current !== null) window.clearTimeout(journalReloadTimer.current);
  }, []);
  const journalDocIds = useMemo(() => new Set(journalDays.map((d) => d.docId)), [journalDays]);

  const openJournalDay = useCallback(async (date: string): Promise<Document | null> => {
    try {
      const doc = await api.openJournalDay(date);
      setDocs((prev) => (prev.some((d) => d.id === doc.id) ? prev : [doc, ...prev]));
      setJournalDays((prev) =>
        [
          ...prev.filter((d) => d.date !== date),
          { date, docId: doc.id, empty: !(doc.content || '').trim() },
        ].sort((a, b) => b.date.localeCompare(a.date))
      );
      return doc;
    } catch {
      return null;
    }
  }, [setDocs]);

  const jumpToJournalDay = useCallback((date: string) => {
    setJournalExtra((prev) => (prev.includes(date) ? prev : [...prev, date]));
    setJournalActive(date);
    setJournalJump({ date, nonce: Date.now() });
  }, []);

  // The day's last bullet was deleted: it leaves the journal at once (today stays, it is always shown)
  const removeJournalDay = useCallback((date: string) => {
    setJournalExtra((prev) => prev.filter((d) => d !== date));
    setJournalDays((prev) => prev.map((d) => (d.date === date ? { ...d, empty: true } : d)));
  }, []);

  return {
    journalEnabled,
    journalDays,
    journalExtra,
    journalActive,
    setJournalActive,
    journalJump,
    reloadJournal,
    reloadJournalSoon,
    journalDocIds,
    openJournalDay,
    jumpToJournalDay,
    removeJournalDay,
  };
}
