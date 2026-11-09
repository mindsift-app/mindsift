import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Repeat, X } from 'lucide-react';
import { TaskList, Thought } from '../../lib/types';
import { localDay } from '../../lib/due';
import { formatDate } from '../../lib/format';
import { isPhoneWidth } from '../../lib/breakpoints';
import { startElementDragGhost } from '../../lib/dragGhost';
import { CalendarEntry, entriesByDay, isoWeek, monthGrid, moveDue, sameMonth, shiftDay, weekOf } from '../../lib/calendar';
import { useKanbanTouchDrag } from './useKanbanTouchDrag';
import { renderMentions } from '../../lib/markdown';
import { CountBadge } from '../../components/CountBadge';

type Mode = 'month' | 'week';
const MODE_KEY = 'mindsift:calendar_mode';
const MONTH_CELL_MAX = 3;
// Drag data of a full task row (useTaskDrag), so day cells take those as well
const TASK_DRAG_TYPE = 'application/mindsift-task-id';

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-status-err',
  high: 'bg-status-warn',
  normal: 'bg-accent',
  low: 'bg-faint',
};

interface TaskCalendarProps {
  // The tasks of the open list (filtered by hashtag); done ones show struck through
  tasks: Thought[];
  lists: TaskList[];
  // "Alle Aufgaben": each entry shows the icon of its list
  showListIcon: boolean;
  isTaskReadOnly: (task: Thought) => boolean;
  onOpenTask: (task: Thought) => void;
  // New due date ('' removes it)
  onMoveDue: (task: Thought, due: string) => void;
  // A new task on that day; null when the list cannot take new tasks
  onCreateForDay: ((day: string, title: string) => Promise<boolean>) | null;
  // The full task row (as in the list view) for the day panel; compact puts its buttons below the task
  renderTaskRow: (task: Thought, compact?: boolean) => React.ReactNode;
}

const usePhone = () => {
  const [phone, setPhone] = useState(isPhoneWidth);
  useEffect(() => {
    const onResize = () => setPhone(isPhoneWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return phone;
};

// Calendar view of the tasks: month or week on the desktop (7 columns, no hours), the week on phones.
// Tasks without a date wait in "Ungeplant"; dragging a task onto a day sets its date (the time stays),
// onto "Ungeplant" removes it. Repeating tasks also show their coming dates, greyed with ↻, which open the
// task itself. A click on a day opens its tasks in full (desktop: on the left; phones: a sheet).
export function TaskCalendar({ tasks, lists, showListIcon, isTaskReadOnly, onOpenTask, onMoveDue, onCreateForDay, renderTaskRow }: TaskCalendarProps) {
  const { t } = useTranslation('tasks');
  const phone = usePhone();
  const today = localDay();
  const [anchor, setAnchor] = useState(today);
  const [storedMode, setStoredMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'week' ? 'week' : 'month';
    } catch {
      return 'month';
    }
  });
  const mode: Mode = phone ? 'week' : storedMode;
  const setMode = (m: Mode) => {
    setStoredMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // only a convenience
    }
  };
  // Phones: the day shown in a sheet; desktop: the day in the side column (null: today)
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'day' | 'unplanned'>('day');
  const openOnSide = (day: string) => {
    setOpenDay(day);
    setSideTab('day');
  };
  const [unplannedOpen, setUnplannedOpen] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  // Title of a new task in the day panel
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const weeks = useMemo(() => (mode === 'month' ? monthGrid(anchor) : [weekOf(anchor)]), [mode, anchor]);
  const from = weeks[0][0];
  const to = weeks[weeks.length - 1][6];
  const byDay = useMemo(() => entriesByDay(tasks, from, openDay && openDay > to ? openDay : to), [tasks, from, to, openDay]);
  const unplanned = useMemo(() => tasks.filter((task) => !task.dueDate && !task.isCompleted), [tasks]);
  const listIcon = (task: Thought) => (showListIcon ? lists.find((l) => l.id === task.taskListId)?.icon : undefined);
  const taskById = (id: string) => tasks.find((x) => x.id === id);

  const step = (dir: 1 | -1) => {
    if (mode === 'week') setAnchor((a) => shiftDay(a, 7 * dir));
    else
      setAnchor((a) => {
        const [y, m] = a.split('-').map(Number);
        return localDay(new Date(y, m - 1 + dir, 1));
      });
  };

  // ← → leaf through, T goes to today (not while typing or with a dialog open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (document.querySelector('.modal-overlay, [role="dialog"]')) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key.toLowerCase() === 't') setAnchor(localDay());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Dropping (mouse or finger): a day sets the date, "unplanned" removes it
  const dropOn = (taskId: string, target: string | null) => {
    const task = taskById(taskId);
    if (!task || !target) return;
    if (target === 'unplanned') onMoveDue(task, '');
    else if (target.startsWith('day:')) onMoveDue(task, moveDue(task.dueDate, target.slice(4)));
  };
  const touch = useKanbanTouchDrag({
    enabled: phone,
    onStart: (id) => setDraggingId(id),
    onHover: (col) => setHoverTarget(col),
    onDrop: (id, col) => {
      setDraggingId(null);
      setHoverTarget(null);
      dropOn(id, col);
    },
    onCancel: () => {
      setDraggingId(null);
      setHoverTarget(null);
    },
  });
  // Mouse: HTML5 drag with the half transparent ghost
  // Mouse: a calendar entry, or a full task row (day panel, "Ungeplant") with its own drag data
  const rowDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(TASK_DRAG_TYPE);
  const dropProps = (target: string) => ({
    'data-kanban-col': target,
    onDragOver: (e: React.DragEvent) => {
      if (!draggingId && !rowDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (hoverTarget !== target) setHoverTarget(target);
    },
    onDragLeave: () => {
      if (hoverTarget === target) setHoverTarget(null);
    },
    onDrop: (e: React.DragEvent) => {
      if (!draggingId && !rowDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const id = draggingId || e.dataTransfer.getData(TASK_DRAG_TYPE);
      setDraggingId(null);
      setHoverTarget(null);
      if (id) dropOn(id, target);
    },
  });
  const dragProps = (entry: { task: Thought; upcoming?: boolean }) => {
    const movable = !entry.upcoming && !isTaskReadOnly(entry.task);
    return {
      'data-kanban-task': entry.upcoming ? undefined : entry.task.id,
      draggable: movable && !phone,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData('text/plain', entry.task.id);
        e.dataTransfer.effectAllowed = 'move';
        startElementDragGhost(e, e.currentTarget as HTMLElement);
        setDraggingId(entry.task.id);
      },
      onDragEnd: () => {
        setDraggingId(null);
        setHoverTarget(null);
      },
      ...touch.cardProps(entry.task.id, entry.task.content, movable),
    };
  };
  const open = (task: Thought) => {
    if (touch.consumeClick()) return;
    onOpenTask(task);
  };

  const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => formatDate(`${day}T12:00:00`, opts);
  const title =
    mode === 'month'
      ? dayLabel(anchor, { month: 'long', year: 'numeric' })
      : `${t('calendar.weekNumber', { n: isoWeek(weeks[0][0]) })} · ${dayLabel(weeks[0][0], { day: 'numeric', month: 'short' })} – ${dayLabel(weeks[0][6], { day: 'numeric', month: 'short' })}`;
  const weekdayNames = weeks[0].map((d) => dayLabel(d, { weekday: 'short' }));
  const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00`).getDay());

  // A compact entry: priority dot, time, title (greyed with ↻ for a coming date of a repeating task)
  // big: a row of its own (day panel, phones); wrap: the title may take up to three lines (week columns)
  const chip = (entry: CalendarEntry, key: string, big?: boolean, wrap?: boolean) => {
    const { task } = entry;
    const overdue = !entry.upcoming && !task.isCompleted && !!task.dueDate && task.dueDate.slice(0, 10) < today;
    return (
      <button
        key={key}
        type="button"
        {...dragProps(entry)}
        onClick={(e) => {
          e.stopPropagation();
          open(task);
        }}
        title={entry.upcoming ? t('calendar.upcomingTitle', { title: task.content }) : task.content}
        className={`w-full flex ${wrap ? 'items-start' : 'items-center'} gap-1.5 rounded-btn px-1.5 text-left transition-colors cursor-pointer select-none ${
          big ? 'min-h-[44px] sm:min-h-0 py-1.5 text-sm sm:text-xs bg-panel border border-border' : 'py-0.5 text-[11px] hover:bg-panel-elevated'
        } ${entry.upcoming ? 'opacity-50' : ''} ${draggingId === task.id ? 'opacity-30' : ''}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${wrap ? 'mt-1.5' : ''} ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.normal}`} aria-hidden />
        {entry.upcoming && <Repeat className="w-3 h-3 shrink-0 text-muted" aria-label={t('calendar.repeats')} />}
        {entry.time && <span className="shrink-0 font-mono text-muted">{entry.time}</span>}
        {listIcon(task) && <span className="shrink-0">{listIcon(task)}</span>}
        <span
          className={`min-w-0 ${wrap ? 'line-clamp-3 break-words' : 'truncate'} ${task.isCompleted ? 'line-through text-faint' : overdue ? 'text-status-err' : 'text-main'}`}
        >
          {renderMentions(task.content)}
        </span>
      </button>
    );
  };

  const header = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => step(-1)} className="btn-icon h-11 w-11 sm:h-8 sm:w-8" title={t('calendar.previous')} aria-label={t('calendar.previous')}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => setAnchor(localDay())} className="btn-action h-11 sm:h-8 px-3 text-xs">
          {t('calendar.today')}
        </button>
        <button type="button" onClick={() => step(1)} className="btn-icon h-11 w-11 sm:h-8 sm:w-8" title={t('calendar.next')} aria-label={t('calendar.next')}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <h2 className="text-sm font-semibold text-main capitalize">{title}</h2>
      {!phone && (
        <div className="ml-auto flex border border-border rounded-btn bg-canvas overflow-hidden" role="radiogroup" aria-label={t('calendar.mode')}>
          {(['month', 'week'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`h-8 px-3 text-xs transition-colors ${m === 'month' ? 'border-r border-border' : ''} ${
                mode === m ? 'bg-panel text-main font-medium' : 'text-muted hover:text-main'
              }`}
            >
              {t(`calendar.${m}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // The day's tasks in full, and a field for a new task on that day
  // A new task on a day ('' = without a date)
  const newTaskForm = (day: string, placeholder: string) =>
    onCreateForDay && (
      <form
        className="flex items-center gap-1.5 pt-1"
        onSubmit={async (ev) => {
          ev.preventDefault();
          const title = draft.trim();
          if (!title || busy) return;
          setBusy(true);
          if (await onCreateForDay(day, title)) setDraft('');
          setBusy(false);
        }}
      >
        <input
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 h-11 sm:h-8 px-2 text-base sm:text-xs input-field"
        />
        <button type="submit" disabled={!draft.trim() || busy} className="btn-action h-11 sm:h-8 px-2.5 text-xs disabled:opacity-40" aria-label={t('calendar.add')}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </form>
    );
  const emptyHint = (text: string) => <p className="py-6 text-center text-xs text-faint">{text}</p>;

  // The day's tasks in full, and a field for a new task on that day
  const dayDetails = (day: string) => {
    const entries = byDay.get(day) || [];
    return (
      <div className="flex flex-col gap-2">
        {entries.length === 0 && emptyHint(t('calendar.dayEmpty'))}
        {entries.map((e) =>
          e.upcoming ? chip(e, `${e.task.id}-up`, true) : <React.Fragment key={e.task.id}>{renderTaskRow(e.task, true)}</React.Fragment>
        )}
        {newTaskForm(day, t('calendar.newForDay'))}
      </div>
    );
  };

  const unplannedBox = (
    <div
      {...dropProps('unplanned')}
      className={`rounded-card border bg-panel overflow-hidden transition-colors ${hoverTarget === 'unplanned' ? 'border-accent ring-2 ring-accent/40' : 'border-border'}`}
    >
      <button
        type="button"
        onClick={() => setUnplannedOpen((v) => !v)}
        className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 flex items-center gap-2 text-xs font-semibold text-main"
        aria-expanded={unplannedOpen}
      >
        <span className="flex-1 text-left">{t('calendar.unplanned')}</span>
        <span className="text-muted font-normal">{unplanned.length}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted transition-transform ${unplannedOpen ? '' : '-rotate-90'}`} />
      </button>
      {unplannedOpen && (
        <div className="px-1.5 pb-2 space-y-0.5 max-h-[60vh] overflow-y-auto">
          {unplanned.length === 0 ? (
            <p className="px-1.5 py-2 text-[11px] text-faint">{t('calendar.unplannedEmpty')}</p>
          ) : (
            unplanned.map((task) => chip({ task, time: '', upcoming: false }, task.id, phone))
          )}
        </div>
      )}
    </div>
  );

  if (phone) {
    const days = weeks[0];
    return (
      <div className="space-y-3">
        {header}
        {/* Date strip: tap jumps to the day, a dragged task can be dropped on it */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => (
            <button
              key={day}
              type="button"
              {...dropProps(`day:${day}`)}
              onClick={() => setOpenDay(day)}
              className={`h-14 rounded-btn flex flex-col items-center justify-center gap-0.5 border text-xs transition-colors ${
                hoverTarget === `day:${day}` ? 'border-accent ring-2 ring-accent/40' : day === today ? 'border-accent bg-accent-dim' : 'border-border bg-panel'
              }`}
            >
              <span className="text-[10px] text-muted capitalize">{dayLabel(day, { weekday: 'narrow' })}</span>
              <span className={`font-semibold ${day === today ? 'text-accent' : 'text-main'}`}>{Number(day.slice(8))}</span>
              <span className={`w-1 h-1 rounded-full ${(byDay.get(day) || []).length ? 'bg-accent' : 'bg-transparent'}`} aria-hidden />
            </button>
          ))}
        </div>
        {days.map((day) => {
          const entries = byDay.get(day) || [];
          return (
            <section
              key={day}
              {...dropProps(`day:${day}`)}
              className={`rounded-card border p-2 transition-colors ${hoverTarget === `day:${day}` ? 'border-accent ring-2 ring-accent/40' : 'border-border'} ${
                day === today ? 'bg-accent-dim/40' : 'bg-canvas'
              }`}
            >
              <button type="button" onClick={() => setOpenDay(day)} className="w-full min-h-[44px] flex items-center text-left text-xs font-semibold text-main capitalize">
                {dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}
              </button>
              {entries.length > 0 && (
                <div className="space-y-1">
                  {entries.map((e, i) => chip(e, `${e.task.id}-${i}`, true))}
                </div>
              )}
            </section>
          );
        })}
        {unplannedBox}
        {touch.ghost}
        {openDay && (
          <div className="fixed inset-0 z-50 flex items-end bg-overlay/60" onClick={() => setOpenDay(null)}>
            <div
              role="dialog"
              aria-label={dayLabel(openDay, { weekday: 'long', day: 'numeric', month: 'long' })}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-h-[85vh] overflow-y-auto rounded-t-card bg-panel border-t border-border p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-3"
            >
              <div className="flex items-center gap-2">
                <h3 className="flex-1 text-sm font-semibold text-main capitalize">{dayLabel(openDay, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                <button type="button" onClick={() => setOpenDay(null)} className="btn-icon h-11 w-11" aria-label={t('common:close')}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              {dayDetails(openDay)}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop: on the left a column as tall as the calendar with two tabs, the chosen day (today until a
  // day is clicked) and "Ungeplant"; it scrolls on its own. Month and week have the same height.
  const sideDay = openDay || today;
  const tabClass = (active: boolean) =>
    `flex-1 h-8 px-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
      active ? 'bg-panel text-main' : 'text-muted hover:text-main'
    }`;
  return (
    <div className="space-y-3">
      {header}
      {/* As tall as the window allows (at least 30rem); smaller windows scroll the page */}
      <div className="flex items-stretch gap-3 h-[max(30rem,calc(100dvh-21.5rem))]">
        <aside className="w-80 shrink-0 flex flex-col min-h-0 rounded-card border border-border bg-panel overflow-hidden">
          <div className="flex border-b border-border bg-canvas" role="tablist">
            <button type="button" role="tab" aria-selected={sideTab === 'day'} onClick={() => setSideTab('day')} className={tabClass(sideTab === 'day')}>
              <span className="inline-flex items-center min-w-0">
                <span className="truncate capitalize">{dayLabel(sideDay, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <CountBadge count={(byDay.get(sideDay) || []).filter((e) => !e.upcoming).length} position="text" />
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'unplanned'}
              onClick={() => setSideTab('unplanned')}
              {...dropProps('unplanned')}
              className={`${tabClass(sideTab === 'unplanned')} border-l border-border ${hoverTarget === 'unplanned' ? 'ring-2 ring-inset ring-accent/60 bg-accent/10' : ''}`}
            >
              <span className="inline-flex items-center">
                {t('calendar.unplanned')}
                <CountBadge count={unplanned.length} position="text" />
              </span>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2" role="tabpanel">
            {/* The tab already names the day */}
            {sideTab === 'day' ? (
              dayDetails(sideDay)
            ) : (
              // Captured before the rows: they would only reorder a task dropped on them, not take its date
              <div
                data-kanban-col="unplanned"
                onDragOverCapture={dropProps('unplanned').onDragOver}
                onDropCapture={dropProps('unplanned').onDrop}
                onDragLeave={dropProps('unplanned').onDragLeave}
                className={`min-h-full flex flex-col gap-2 rounded-btn ${hoverTarget === 'unplanned' ? 'bg-accent/10' : ''}`}
              >
                {unplanned.length === 0
                  ? emptyHint(t('calendar.unplannedEmpty'))
                  : // The same rows as the day: tick off, change status, work through them right here
                    unplanned.map((task) => <React.Fragment key={task.id}>{renderTaskRow(task, true)}</React.Fragment>)}
                {newTaskForm('', t('calendar.newUnplanned'))}
              </div>
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col rounded-card border border-border bg-panel overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-canvas">
            {weekdayNames.map((name, i) => (
              <div key={i} className="px-2 py-1.5 text-[11px] font-semibold text-muted capitalize">
                {name}
              </div>
            ))}
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            {weeks.map((week) => (
              <div key={week[0]} className="flex-1 min-h-0 grid grid-cols-7 border-b border-border last:border-b-0">
                {week.map((day) => {
                  const entries = byDay.get(day) || [];
                  // Six weeks leave less room per day
                  const shown = mode === 'month' ? entries.slice(0, weeks.length > 5 ? MONTH_CELL_MAX - 1 : MONTH_CELL_MAX) : entries;
                  const more = entries.length - shown.length;
                  const outside = mode === 'month' && !sameMonth(day, anchor);
                  return (
                    <div
                      key={day}
                      {...dropProps(`day:${day}`)}
                      onClick={() => openOnSide(day)}
                      className={`min-h-0 p-1 border-r border-border last:border-r-0 flex flex-col gap-0.5 cursor-pointer transition-colors ${
                        mode === 'week' ? 'overflow-y-auto' : 'overflow-hidden'
                      } ${
                        hoverTarget === `day:${day}`
                          ? 'bg-accent/10 ring-2 ring-inset ring-accent/50'
                          : openDay === day && sideTab === 'day'
                          ? 'bg-accent-dim/40'
                          : isWeekend(day)
                          ? 'bg-canvas/60'
                          : ''
                      } ${outside ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`self-start shrink-0 text-[11px] font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                          day === today ? 'bg-accent text-on-accent' : 'text-muted'
                        }`}
                      >
                        {Number(day.slice(8))}
                      </span>
                      {shown.map((e, i) => chip(e, `${e.task.id}-${i}`, false, mode === 'week'))}
                      {more > 0 && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openOnSide(day);
                          }}
                          className="self-start px-1.5 text-[11px] text-accent hover:underline cursor-pointer"
                        >
                          {t('calendar.more', { count: more })}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
