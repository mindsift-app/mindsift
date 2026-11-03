import React from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, Hash, X } from 'lucide-react';
import { Thought } from '../../lib/types';
import { GroupBy, TaskSort, ViewMode } from './taskViewTypes';

interface TasksFilterSheetProps {
  allAvailableTags: string[];
  defaultGroupBy: GroupBy;
  groupBy: GroupBy;
  groupOptions: { id: GroupBy; label: string }[];
  safeTasks: Thought[];
  selectedTag: string | null;
  setGroupBy: (g: GroupBy) => void;
  setSelectedTag: (tag: string | null) => void;
  setShowFilterModal: (show: boolean) => void;
  setSortBy: (sort: TaskSort) => void;
  sortBy: TaskSort;
  viewMode: ViewMode;
  // Open state of the sheet
  showFilterModal: boolean;
}

// Phone: bottom sheet for filter (open/done/trash), hashtag, grouping and sorting of TasksView
export function TasksFilterSheet({
  allAvailableTags,
  defaultGroupBy,
  groupBy,
  groupOptions,
  safeTasks,
  selectedTag,
  setGroupBy,
  setSelectedTag,
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
      className="sm:hidden fixed inset-0 !m-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => setShowFilterModal(false)}
    >
      <div
        className="w-full max-h-[85vh] overflow-y-auto bg-panel border-t border-border rounded-t-2xl shadow-panel p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-btn bg-accent/15 text-accent flex items-center justify-center">
              <Filter className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-main">{t('filter.title')}</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowFilterModal(false)}
            className="p-1.5 text-faint hover:text-main rounded-btn transition-colors cursor-pointer"
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
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedTag(null)}
              className={`min-h-[32px] px-3 text-xs rounded-full border transition-colors cursor-pointer ${
                selectedTag === null
                  ? 'bg-accent text-on-accent border-accent font-semibold'
                  : 'bg-canvas border-border text-muted'
              }`}
            >
              {t('tags.all', { count: safeTasks.length })}
            </button>
            {allAvailableTags.map((tag) => {
              const count = safeTasks.filter((t) => t.tags?.includes(tag)).length;
              const isSelected = selectedTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(isSelected ? null : tag)}
                  className={`min-h-[32px] px-3 text-xs rounded-full border transition-colors flex items-center gap-1 cursor-pointer ${
                    isSelected
                      ? 'bg-accent text-on-accent border-accent font-semibold'
                      : 'bg-canvas border-border text-muted'
                  }`}
                >
                  <span>#{tag}</span>
                  <span className="text-[10px] opacity-75">({count})</span>
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
            <div className="grid grid-cols-2 gap-1.5">
              {groupOptions.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupBy(g.id)}
                  className={`min-h-[36px] px-3 text-xs rounded-btn border text-left transition-colors cursor-pointer ${
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
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'custom', label: t('view.sortCustom') },
                { id: 'created', label: t('view.sortCreated') },
                { id: 'due', label: t('view.sortDue') },
                { id: 'priority', label: t('view.sortPriority') },
                { id: 'alpha', label: t('sortShort.alpha') },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSortBy(s.id as any)}
                  className={`min-h-[36px] px-3 text-xs rounded-btn border text-left transition-colors cursor-pointer ${
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
              setSelectedTag(null);
              setGroupBy(defaultGroupBy);
              setSortBy('custom');
            }}
            className="btn-ghost h-9 px-3 text-xs text-muted hover:text-main cursor-pointer"
          >
            {t('filter.reset')}
          </button>
          <button
            type="button"
            onClick={() => setShowFilterModal(false)}
            className="btn-primary h-9 px-5 text-xs font-semibold cursor-pointer"
          >
            {t('common:done')}
          </button>
        </div>
      </div>
    </div>
  );
}
