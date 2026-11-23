import React from 'react';
import { useTranslation } from 'react-i18next';
import { Funnel, Hash, X } from 'lucide-react';
import { Thought } from '../../lib/types';
import { GroupBy, TaskSort, ViewMode } from './taskViewTypes';

interface TasksFilterSheetProps {
  allAvailableTags: string[];
  defaultGroupBy: GroupBy;
  groupBy: GroupBy;
  groupOptions: { id: GroupBy; label: string }[];
  safeTasks: Thought[];
  // Chosen hashtags (a task shows with any of them); a tap switches one on or off, "Alle" clears them
  selectedTags: readonly string[];
  setGroupBy: (g: GroupBy) => void;
  toggleTag: (tag: string) => void;
  clearTags: () => void;
  setShowFilterModal: (show: boolean) => void;
  setSortBy: (sort: TaskSort) => void;
  sortBy: TaskSort;
  viewMode: ViewMode;
  // Open state of the sheet
  showFilterModal: boolean;
}

// Phone: bottom sheet for hashtag filter, grouping and sorting of TasksView
export function TasksFilterSheet({
  allAvailableTags,
  defaultGroupBy,
  groupBy,
  groupOptions,
  safeTasks,
  selectedTags,
  setGroupBy,
  toggleTag,
  clearTags,
  setShowFilterModal,
  setSortBy,
  sortBy,
  viewMode,
  showFilterModal,
}: TasksFilterSheetProps) {
  const { t } = useTranslation('tasks');
  if (!showFilterModal) return null;
  return (
    <div
      className="sm:hidden fixed inset-0 m-0! z-50 flex items-end justify-center bg-overlay backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => setShowFilterModal(false)}
    >
      <div
        className="w-full max-h-[85vh] overflow-y-auto bg-panel border-t border-border rounded-t-2xl shadow-panel p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between -mt-1 pb-2 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-btn bg-accent/15 text-accent flex items-center justify-center">
              <Funnel className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-main">{t('filter.title')}</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowFilterModal(false)}
            aria-label={t('common:close')}
            className="-mr-2 w-11 h-11 flex items-center justify-center text-faint hover:text-main rounded-btn transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hashtag Filters */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
            <Hash className="w-3 h-3 text-accent" />
            <span>{t('filter.byTag')}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearTags}
              aria-pressed={selectedTags.length === 0}
              className={`min-h-11 px-3.5 text-sm rounded-full border transition-colors cursor-pointer ${
                selectedTags.length === 0
                  ? 'bg-accent text-on-accent border-accent font-semibold'
                  : 'bg-canvas border-border text-muted'
              }`}
            >
              {t('tags.all', { count: safeTasks.length })}
            </button>
            {allAvailableTags.map((tag) => {
              const count = safeTasks.filter((t) => t.tags?.includes(tag)).length;
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={isSelected}
                  className={`min-h-11 px-3.5 text-sm rounded-full border transition-colors flex items-center gap-1 cursor-pointer ${
                    isSelected
                      ? 'bg-accent text-on-accent border-accent font-semibold'
                      : 'bg-canvas border-border text-muted'
                  }`}
                >
                  <span>#{tag}</span>
                  <span className="text-xs opacity-75">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Grouping */}
        {viewMode !== 'kanban' && (
          <div className="space-y-2 pt-2 border-t border-border">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted block">
              {t('tasks:filter.grouping')}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {groupOptions.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupBy(g.id)}
                  className={`min-h-11 px-3 text-sm rounded-btn border text-left transition-colors cursor-pointer ${
                    groupBy === g.id
                      ? 'bg-accent-dim border-accent text-accent font-semibold'
                      : 'bg-canvas border-border text-muted hover:text-main'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sorting */}
        {viewMode !== 'kanban' && (
          <div className="space-y-2 pt-2 border-t border-border">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted block">
              {t('tasks:filter.sorting')}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'custom', label: t('view.sortCustomShort') },
                { id: 'created', label: t('view.sortCreated') },
                { id: 'due', label: t('view.sortDue') },
                { id: 'priority', label: t('view.sortPriority') },
                { id: 'alpha', label: t('sortShort.alpha') },
              ] satisfies { id: TaskSort; label: string }[]).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSortBy(s.id)}
                  className={`min-h-11 px-3 text-sm rounded-btn border text-left transition-colors cursor-pointer ${
                    sortBy === s.id
                      ? 'bg-accent-dim border-accent text-accent font-semibold'
                      : 'bg-canvas border-border text-muted hover:text-main'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              clearTags();
              setGroupBy(defaultGroupBy);
              setSortBy('custom');
            }}
            className="btn-ghost h-11 px-3 text-sm text-muted hover:text-main cursor-pointer"
          >
            {t('filter.reset')}
          </button>
          <button
            type="button"
            onClick={() => setShowFilterModal(false)}
            className="btn-primary h-11 px-6 text-sm font-semibold cursor-pointer"
          >
            {t('common:done')}
          </button>
        </div>
      </div>
    </div>
  );
}
