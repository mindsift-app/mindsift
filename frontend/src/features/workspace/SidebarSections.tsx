import { CalendarDays, Trash2 } from 'lucide-react';
import { JournalDay, TagSummary } from '../../lib/types';
import { todayISO } from '../../lib/journal';
import { CountBadge } from '../../components/CountBadge';
import { JournalCalendar } from './JournalCalendar';
import { useDocDragDrop } from './useDocDragDrop';
import { WorkspaceSubView } from './workspaceTypes';
import { useTranslation } from 'react-i18next';

// Journal on top of the sidebar; open, it becomes a panel with the calendar (click the heading to close).
// Panel and calendar animate open (grid rows 0fr → 1fr) instead of jumping. Only from lg on: below, the
// journal is a view of its own and the button stays a plain entry like the folders (otherwise it stayed
// half highlighted after "back").
export function SidebarJournal({
  subView,
  toggleJournal,
  journalActive,
  journalDays,
  jumpToJournalDay,
}: {
  subView: WorkspaceSubView;
  toggleJournal: () => void;
  journalActive: string;
  journalDays: JournalDay[];
  jumpToJournalDay: (date: string) => void;
}) {
  const { t } = useTranslation('workspace');
  return (
    <div>
      <div
        className={`rounded-card border-2 transition-[background-color,border-color,padding] duration-300 ease-out ${
          subView === 'journal' ? 'border-transparent p-0 lg:bg-panel-elevated lg:p-2.5' : 'border-transparent p-0'
        }`}
      >
        <button
          type="button"
          onClick={toggleJournal}
          aria-expanded={subView === 'journal'}
          title={subView === 'journal' ? t('journal.close') : t('journal.open')}
          className={`w-full flex items-center gap-2 text-left cursor-pointer rounded-btn transition-all duration-300 h-11 sm:h-8 px-2 text-sm sm:text-xs text-main hover:bg-panel-elevated ${
            subView === 'journal' ? 'lg:h-7 lg:px-0.5 lg:text-sm lg:font-bold lg:hover:bg-transparent' : ''
          }`}
        >
          <CalendarDays
            className={`text-accent transition-all duration-300 w-3.5 h-3.5 ${subView === 'journal' ? 'lg:w-4 lg:h-4' : ''}`}
          />
          <span>{t('journal.title')}</span>
        </button>
        <div
          className={`hidden lg:grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
            subView === 'journal' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
          aria-hidden={subView !== 'journal'}
        >
          <div className="overflow-hidden min-h-0">
            <div className="pt-2">
              <JournalCalendar
                activeDate={journalActive}
                entryDates={new Set(journalDays.filter((d) => !d.empty).map((d) => d.date))}
                onSelect={jumpToJournalDay}
                onToday={() => jumpToJournalDay(todayISO())}
              />
            </div>
          </div>
        </div>
      </div>
      <div
        className={`h-px bg-border mt-1.5 transition-opacity duration-300 ${
          subView === 'journal' ? 'opacity-100 lg:opacity-0' : 'opacity-100'
        }`}
      />
    </div>
  );
}

// Hashtags of all notes below the tree
export function SidebarTags({
  tagsSummary,
  subView,
  selectedTag,
  handleSelectTag,
}: {
  tagsSummary: TagSummary[];
  subView: WorkspaceSubView;
  selectedTag: string | null;
  handleSelectTag: (tag: string) => void;
}) {
  const { t } = useTranslation('workspace');
  return (
    <div>
      <div className="px-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
        {t('sidebar.hashtags')}
      </div>
      <div className="flex flex-wrap gap-1 px-1">
        {tagsSummary.map((tag) => (
          <button
            key={tag.tag}
            type="button"
            onClick={() => handleSelectTag(tag.tag)}
            className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-btn text-[10px] font-medium transition-colors ${
              subView === 'tag_detail' && selectedTag === tag.tag
                ? 'bg-accent text-on-accent'
                : 'bg-panel-elevated text-muted hover:text-accent'
            }`}
          >
            <span>#{tag.tag}</span>
            <span className="opacity-60 font-mono text-[9px]">{tag.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Trash at the bottom of the sidebar; notes dragged onto it are deleted
export function SidebarTrash({
  drag,
  subView,
  trashCount,
  openTrash,
}: {
  drag: ReturnType<typeof useDocDragDrop>;
  subView: WorkspaceSubView;
  trashCount: number;
  openTrash: () => void;
}) {
  const { t } = useTranslation('workspace');
  const { draggingDocId, trashDragOver, setTrashDragOver, handleDropOnTrash } = drag;
  return (
    <div className="p-2 border-t border-border shrink-0">
      <button
        type="button"
        onClick={openTrash}
        onDragOver={(e) => {
          if (!draggingDocId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!trashDragOver) setTrashDragOver(true);
        }}
        onDragLeave={() => setTrashDragOver(false)}
        onDrop={handleDropOnTrash}
        title={t('sidebar.trashTitle')}
        className={`w-full flex items-center gap-2 px-2 h-11 sm:h-8 rounded-btn text-xs border transition-colors cursor-pointer ${
          trashDragOver
            ? 'border-status-err bg-status-err/10 text-status-err ring-2 ring-status-err/30'
            : subView === 'trash'
            ? 'bg-panel-elevated text-main font-semibold border-transparent'
            : 'border-transparent text-muted hover:text-main hover:bg-panel-elevated'
        }`}
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span className="flex-1 text-left">{t('trash.title')}</span>
        <CountBadge count={trashCount} />
      </button>
    </div>
  );
}
