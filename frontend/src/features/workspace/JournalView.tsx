import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WikiLinkClickHandler } from '../../lib/wikiLink';
import { ArrowLeft, CalendarDays, ChevronDown, Users } from 'lucide-react';
import { Document, JournalDay, User } from '../../lib/types';
import { shortDateLabel, todayISO } from '../../lib/journal';
import { DocHeaderStatus, DocSaveStatus, DocumentEditor } from './DocumentEditor';
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
  onWikiLinkClick?: WikiLinkClickHandler;
  onOpenDocBlock?: (docId: string, blockId?: string) => void;
  onOpenTask?: (taskId: string) => void;
  onBackMobile: () => void;
  /** A day was saved (its calendar dot may change) */
  onDaySaved: () => void;
  /** The last bullet of a day was deleted: the day leaves the journal (today stays) */
  onDayEmptied: (date: string) => void;
  /** Large screens: the active day's actions go into the tab bar (or the focus mode header), like a note's */
  actionsTarget?: HTMLElement | null;
  focusMode?: boolean;
  focusBarPinned?: boolean;
  onToggleFocusMode?: () => void;
  /** Save and live status of the active day, for the tab bar */
  onActiveSaveStatusChange?: (status: DocSaveStatus, errorMsg?: string) => void;
  onActiveHeaderStatusChange?: (status: DocHeaderStatus | null) => void;
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
  onDayEmptied,
  actionsTarget,
  focusMode = false,
  focusBarPinned = false,
  onToggleFocusMode,
  onActiveSaveStatusChange,
  onActiveHeaderStatusChange,
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

  // Focus mode: the text starts where it was in the workspace; unpinned, the header that slides in over
  // it keeps at least its height (45 px) free (large screens only, the header is not shown below)
  const workspaceTopRef = useRef(0);
  const [focusTopGap, setFocusTopGap] = useState(0);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    // Positions without transforms: the view's fade-in moves it a few pixels while it is measured
    const pageTop = (el: HTMLElement | null) => {
      let top = 0;
      for (let e = el; e; e = e.offsetParent as HTMLElement | null) top += e.offsetTop;
      return top;
    };
    if (!focusMode) {
      workspaceTopRef.current = pageTop(root);
      setFocusTopGap(0);
      return;
    }
    if (!window.matchMedia?.('(min-width: 1024px)').matches) return;
    setFocusTopGap(Math.max(focusBarPinned ? 0 : 41, workspaceTopRef.current - pageTop(root)));
  }, [focusMode, focusBarPinned]);
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

  // Save status of every day on screen; the tab bar shows the active day's, also right after the active day
  // changed or left the list (otherwise a "saving" from before would stay there)
  const saveStatusByDate = useRef(new Map<string, { status: DocSaveStatus; err?: string }>());
  const activeDateRef = useRef(activeDate);
  activeDateRef.current = activeDate;
  const onActiveSaveStatusChangeRef = useRef(onActiveSaveStatusChange);
  onActiveSaveStatusChangeRef.current = onActiveSaveStatusChange;
  const handleDaySaveStatus = useCallback(
    (date: string, status: DocSaveStatus, err?: string) => {
      saveStatusByDate.current.set(date, { status, err });
      if (status === 'saved') onDaySaved();
      if (date === activeDateRef.current) onActiveSaveStatusChangeRef.current?.(status, err);
    },
    [onDaySaved]
  );
  const activeShown = shown.includes(activeDate);
  useEffect(() => {
    const s = activeShown ? saveStatusByDate.current.get(activeDate) : undefined;
    onActiveSaveStatusChangeRef.current?.(s?.status ?? 'saved', s?.err);
  }, [activeDate, activeShown]);

  // The active day left the journal (its last bullet was deleted): the day now at the top becomes active
  const activeListed = dates.includes(activeDate);
  useEffect(() => {
    if (!activeListed) onScroll();
  }, [activeListed, onScroll]);

  const activeDocId = docIdByDate.get(activeDate);
  const activeDoc = activeDocId ? getDoc(activeDocId) : undefined;
  const sharedCount = activeDoc?.sharedWith?.length ?? 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-editor view-enter">
      {/* One header for all days: the day in view and its sharing. Large screens have the tab bar for
          that (and the calendar in the sidebar), like notes */}
      <div className="lg:hidden shrink-0 flex items-center gap-2 px-4 sm:px-6 py-2 border-b border-border">
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
          <span className="truncate">{t('journal.header', { date: shortDateLabel(activeDate) })}</span>
          <ChevronDown className={`lg:hidden w-3.5 h-3.5 text-muted shrink-0 transition-transform ${showCalendar ? 'rotate-180' : ''}`} />
        </button>
        {activeDate !== today && (
          <button
            type="button"
            onClick={() => onJump(today)}
            className="btn-action shrink-0 h-11 sm:h-7 px-2.5 text-xs"
          >
            {t('common:date.today')}
          </button>
        )}
        <button
          type="button"
          disabled={!activeDoc || !activeDoc.isOwner}
          onClick={() => activeDoc && onOpenShareModal(activeDoc)}
          className="btn-icon shrink-0 h-11 w-11 sm:h-7 sm:w-auto sm:px-2 gap-1 disabled:opacity-40"
          title={activeDoc ? t('journal.shareDay', { title: activeDoc.title }) : t('journal.share')}
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

      {/* Focus mode keeps the days at the height they have in the workspace, like a note (DocumentEditor) */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto"
        style={focusMode && focusTopGap > 0 ? { paddingTop: focusTopGap } : undefined}
      >
        {shown.map((date, idx) => {
          const docId = docIdByDate.get(date);
          return (
            <section
              key={date}
              data-journal-date={date}
              ref={(el) => {
                if (el) sectionRefs.current.set(date, el);
                else sectionRefs.current.delete(date);
              }}
              className="min-h-[8rem]"
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
                  onSaveStatusChange={(status, err) => handleDaySaveStatus(date, status, err)}
                  onHeaderStatusChange={date === activeDate ? onActiveHeaderStatusChange : undefined}
                  actionsTarget={date === activeDate ? actionsTarget : undefined}
                  focusMode={focusMode}
                  focusBarPinned={focusBarPinned}
                  onToggleFocusMode={date === activeDate ? onToggleFocusMode : undefined}
                  onEmptied={() => onDayEmptied(date)}
                />
              ) : (
                <div className="px-4 sm:px-8 py-6 text-xs text-muted">{t('journal.opening', { date: shortDateLabel(date) })}</div>
              )}
              {/* Between the days a line across the text that fades out to both sides (focus mode: the note's width) */}
              {idx < shown.length - 1 && (
                <div className={`pl-2 pr-1 sm:px-8 ${focusMode ? 'max-w-[calc(theme(maxWidth.6xl)-2rem-2px)] mx-auto' : ''}`} aria-hidden>
                  <div className="h-px bg-[linear-gradient(to_right,transparent,var(--border-color)_20%,var(--border-color)_80%,transparent)]" />
                </div>
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
