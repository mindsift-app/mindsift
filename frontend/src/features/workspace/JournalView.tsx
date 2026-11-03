import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronDown, Users } from 'lucide-react';
import { Document, JournalDay, User } from '../../lib/types';
import { shortDateLabel, todayISO } from '../../lib/journal';
import { DocumentEditor } from './DocumentEditor';
import { JournalCalendar } from './JournalCalendar';
import { useTranslation } from 'react-i18next';

const PAGE = 7;

interface JournalViewProps {
  days: JournalDay[];
  /** Days jumped to over the calendar (shown even while still empty) */
  extraDates: string[];
  activeDate: string;
  onActiveDateChange: (date: string) => void;
  /** Set by the calendar; the view scrolls there (nonce: the same day again) */
  jumpRequest: { date: string; nonce: number } | null;
  /** Opens (creates on first use) the note of a day */
  onOpenDay: (date: string) => Promise<Document | null>;
  onJump: (date: string) => void;
  getDoc: (id: string) => Document | undefined;
  currentUser?: User | null;
  availableFolders: string[];
  onOpenShareModal: (doc: Document) => void;
  onDocMetadataChange: (updated: Document) => void;
  onDeleteDoc: (docId: string) => void;
  onSelectTag: (tag: string) => void;
  onWikiLinkClick?: (pageTitle: string, blockId?: string) => void;
  onOpenDocBlock?: (docId: string, blockId?: string) => void;
  onOpenTask?: (taskId: string) => void;
  onBackMobile: () => void;
  /** A day was saved (its calendar dot may change) */
  onDaySaved: () => void;
}

// The journal: one note per day below each other, today on top, older days load while scrolling.
export const JournalView: React.FC<JournalViewProps> = ({
  days,
  extraDates,
  activeDate,
  onActiveDateChange,
  jumpRequest,
  onOpenDay,
  onJump,
  getDoc,
  currentUser,
  availableFolders,
  onOpenShareModal,
  onDocMetadataChange,
  onDeleteDoc,
  onSelectTag,
  onWikiLinkClick,
  onOpenDocBlock,
  onOpenTask,
  onBackMobile,
  onDaySaved,
}) => {
  const { t } = useTranslation('workspace');
  const today = todayISO();
  const docIdByDate = useMemo(() => new Map(days.map((d) => [d.date, d.docId])), [days]);
  const entryDates = useMemo(() => new Set(days.filter((d) => !d.empty).map((d) => d.date)), [days]);

  // Today, every day with text and the days jumped to – newest first
  const dates = useMemo(() => {
    const set = new Set<string>([today, ...extraDates]);
    days.forEach((d) => {
      if (!d.empty) set.add(d.date);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [days, extraDates, today]);

  const [limit, setLimit] = useState(PAGE);
  const shown = dates.slice(0, limit);
  const [showCalendar, setShowCalendar] = useState(false);

  // Days on screen without a note yet (today, a day jumped to) get one
  const opening = useRef(new Set<string>());
  useEffect(() => {
    shown.forEach((date) => {
      if (!docIdByDate.has(date) && !opening.current.has(date)) {
        opening.current.add(date);
        void onOpenDay(date).finally(() => opening.current.delete(date));
      }
    });
  }, [shown, docIdByDate, onOpenDay]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  // Jump: make sure the day is rendered, then scroll to it once its note is there
  const pendingJump = useRef<string | null>(null);
  const handledJump = useRef(0);
  useEffect(() => {
    if (!jumpRequest || handledJump.current === jumpRequest.nonce) return;
    const idx = dates.indexOf(jumpRequest.date);
    if (idx === -1) return; // the parent adds the day first
    handledJump.current = jumpRequest.nonce;
    if (idx >= limit) setLimit(idx + PAGE);
    pendingJump.current = jumpRequest.date;
  }, [jumpRequest, dates, limit]);
  useEffect(() => {
    const date = pendingJump.current;
    if (!date) return;
    const el = sectionRefs.current.get(date);
    if (el && docIdByDate.has(date)) {
      pendingJump.current = null;
      el.scrollIntoView({ block: 'start' });
    }
  });

  // The day at the top of the scroll area is the active one (calendar, share button)
  const onScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + 48;
    let current = shown[0];
    for (const date of shown) {
      const el = sectionRefs.current.get(date);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= top) current = date;
      else break;
    }
    if (current && current !== activeDate) onActiveDateChange(current);
  }, [shown, activeDate, onActiveDateChange]);

  // Load older days when the end comes into view
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root || typeof IntersectionObserver === 'undefined' || limit >= dates.length) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setLimit((l) => l + PAGE);
      },
      { root, rootMargin: '400px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [limit, dates.length]);

  const activeDocId = docIdByDate.get(activeDate);
  const activeDoc = activeDocId ? getDoc(activeDocId) : undefined;
  const sharedCount = activeDoc?.sharedWith?.length ?? 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-editor view-enter">
      {/* One header for all days: the day in view and its sharing */}
      <div className="shrink-0 flex items-center gap-2 px-4 sm:px-6 py-2 border-b border-border">
        <button
          type="button"
          onClick={onBackMobile}
          className="lg:hidden btn-icon shrink-0 h-11 w-11"
          title={t('editor.backToSidebar')}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowCalendar((v) => !v)}
          className="lg:pointer-events-none flex-1 min-w-0 flex items-center gap-1.5 text-xs text-main font-medium text-left cursor-pointer"
          aria-expanded={showCalendar}
          title={t('journal.calendarTitle')}
        >
          <CalendarDays className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="truncate">Journal · {shortDateLabel(activeDate)}</span>
          <ChevronDown className={`lg:hidden w-3.5 h-3.5 text-muted shrink-0 transition-transform ${showCalendar ? 'rotate-180' : ''}`} />
        </button>
        {activeDate !== today && (
          <button
            type="button"
            onClick={() => onJump(today)}
            className="btn-action shrink-0 h-11 sm:h-7 px-2.5 text-xs"
          >
            Heute
          </button>
        )}
        <button
          type="button"
          disabled={!activeDoc || !activeDoc.isOwner}
          onClick={() => activeDoc && onOpenShareModal(activeDoc)}
          className="btn-icon shrink-0 h-11 w-11 sm:h-7 sm:w-auto sm:px-2 gap-1 disabled:opacity-40"
          title={activeDoc ? `${activeDoc.title} teilen` : 'Teilen'}
        >
          <Users className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-xs">{sharedCount > 0 ? t('tasks:tabs.sharedCount', { count: sharedCount }) : t('journal.share')}</span>
        </button>
      </div>

      {showCalendar && (
        <div className="lg:hidden shrink-0 px-4 py-3 border-b border-border bg-sidebar animate-in fade-in slide-in-from-top-2 duration-200">
          <JournalCalendar
            activeDate={activeDate}
            entryDates={entryDates}
            onSelect={(date) => {
              setShowCalendar(false);
              onJump(date);
            }}
          />
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto">
        {shown.map((date) => {
          const docId = docIdByDate.get(date);
          return (
            <section
              key={date}
              data-journal-date={date}
              ref={(el) => {
                if (el) sectionRefs.current.set(date, el);
                else sectionRefs.current.delete(date);
              }}
              className="border-b border-border last:border-b-0 min-h-[8rem]"
            >
              {docId ? (
                <DocumentEditor
                  key={docId}
                  variant="journal"
                  docId={docId}
                  currentUser={currentUser}
                  initialDoc={getDoc(docId) || null}
                  availableFolders={availableFolders}
                  onDocMetadataChange={onDocMetadataChange}
                  onDeleteDoc={onDeleteDoc}
                  onOpenShareModal={onOpenShareModal}
                  onSelectTag={onSelectTag}
                  onWikiLinkClick={onWikiLinkClick}
                  onOpenDocBlock={onOpenDocBlock}
                  onOpenTask={onOpenTask}
                  onSaveStatusChange={(status) => {
                    if (status === 'saved') onDaySaved();
                  }}
                />
              ) : (
                <div className="px-4 sm:px-8 py-6 text-xs text-muted">{t('journal.opening', { date: shortDateLabel(date) })}</div>
              )}
            </section>
          );
        })}
        {limit < dates.length && <div ref={sentinelRef} className="h-12" />}
        {/* Room below the oldest day, so every day can be scrolled to the top */}
        <div className="h-[60vh]" aria-hidden />
      </div>
    </div>
  );
};
