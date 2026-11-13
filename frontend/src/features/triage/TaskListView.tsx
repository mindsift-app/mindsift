import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash } from 'lucide-react';
import { TaskTrashList } from './TaskTrashList';
import { SelectMenu } from '../../components/SelectMenu';
import { TaskList, Thought, TrashedTask } from '../../lib/types';
import { GroupBy, TaskFilter, TaskSort } from './taskViewTypes';
import { TaskGroup } from './taskListing';


interface TaskListViewProps {
  doneTasks: Thought[];
  filter: TaskFilter;
  filteredTasks: Thought[];
  groupBy: GroupBy;
  groupOptions: { id: GroupBy; label: string }[];
  groupedTasks: TaskGroup[] | null;
  handleClearDone: () => void;
  handleEmptyTaskTrash: () => void;
  handlePurgeTrashed: (item: TrashedTask) => void;
  handleRestoreTrashed: (item: TrashedTask) => void;
  isSelectedListReadOnly: boolean;
  loading: boolean;
  openTasks: Thought[];
  renderTaskRow: (task: Thought) => React.ReactNode;
  safeTaskLists: TaskList[];
  selectedListId: string;
  selectedTag: string | null;
  setFilter: (filter: TaskFilter) => void;
  setGroupBy: (g: GroupBy) => void;
  setSortBy: (sort: TaskSort) => void;
  sortBy: TaskSort;
  taskTrash: TrashedTask[];
}

// List view of TasksView: filter tabs (open, done, trash), grouping and sorting, clearing, then the rows
// (grouped or flat) or the task trash
export function TaskListView({
  doneTasks,
  filter,
  filteredTasks,
  groupBy,
  groupOptions,
  groupedTasks,
  handleClearDone,
  handleEmptyTaskTrash,
  handlePurgeTrashed,
  handleRestoreTrashed,
  isSelectedListReadOnly,
  loading,
  openTasks,
  renderTaskRow,
  safeTaskLists,
  selectedListId,
  selectedTag,
  setFilter,
  setGroupBy,
  setSortBy,
  sortBy,
  taskTrash,
}: TaskListViewProps) {
  const { t } = useTranslation('tasks');
  return (
    <div className="space-y-2">
      {/* Subfilter tabs for List View (Desktop; on mobile controlled via MindSift Logo Menu) */}
      <div className="flex items-center justify-between gap-2">
        <div className="hidden sm:flex seg-track text-xs">
          <button
            onClick={() => setFilter('open')}
            aria-pressed={filter === 'open'}
            className={`seg-item ${filter === 'open' ? 'seg-item-active seg-item-raised' : ''}`}
          >
            {t('view.openCount', { count: openTasks.length })}
          </button>

          <button
            onClick={() => setFilter('done')}
            aria-pressed={filter === 'done'}
            className={`seg-item ${filter === 'done' ? 'seg-item-active seg-item-raised' : ''}`}
          >
            {t('view.doneCount', { count: doneTasks.length })}
          </button>

          <button
            onClick={() => setFilter('discarded')}
            aria-pressed={filter === 'discarded'}
            className={`seg-item ${filter === 'discarded' ? 'seg-item-active seg-item-raised' : ''}`}
          >
            {t('view.trashCount', { count: taskTrash.length })}
          </button>
        </div>

        {/* Grouping and sorting right above the list, then clearing as a plain trash icon (desktop; phones
            use the menu) */}
        <div className="hidden sm:flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-1 text-xs text-muted">
            <span className="text-[11px]">{t('view.group')}</span>
            <SelectMenu
              size="sm"
              ariaLabel={t('view.group')}
              value={groupBy}
              onChange={setGroupBy}
              options={groupOptions.map((g) => ({ value: g.id, label: g.label }))}
            />
          </div>
          <div className="flex items-center gap-1 text-xs text-muted">
            <span className="text-[11px]">{t('view.sort')}</span>
            <SelectMenu
              size="sm"
              ariaLabel={t('view.sort')}
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: 'custom', label: t('view.sortCustom') },
                { value: 'created', label: t('view.sortCreated') },
                { value: 'due', label: t('view.sortDue') },
                { value: 'priority', label: t('view.sortPriority') },
                { value: 'alpha', label: t('view.sortAlpha') },
              ]}
            />
          </div>
        </div>
        {filter === 'discarded' && taskTrash.some((t) => t.canEdit) && (
          <button
            onClick={handleEmptyTaskTrash}
            className="btn-action h-8 w-8 p-0 justify-center min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 ml-auto sm:ml-0"
            title={t('view.emptyTrash')}
            aria-label={t('view.emptyTrash')}
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        )}
        {filter === 'done' && doneTasks.length > 0 && !isSelectedListReadOnly && (
          <button
            onClick={handleClearDone}
            className="btn-action h-8 w-8 p-0 justify-center min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 ml-auto sm:ml-0"
            title={t('view.doneToTrash')}
            aria-label={t('view.doneToTrash')}
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-center text-faint text-sm">{t('view.loading')}</div>
      ) : filter === 'discarded' ? (
        <TaskTrashList
          items={taskTrash}
          lists={safeTaskLists}
          showList={selectedListId === 'all'}
          onRestore={handleRestoreTrashed}
          onPurge={handlePurgeTrashed}
        />
      ) : (
        <div className="space-y-3">
          {groupedTasks && groupedTasks.length > 0 ? (
            /* GROUPED LIST */
            groupedTasks.map((grp) => (
              <div key={grp.key} className="panel-surface overflow-hidden">
                <div className="px-3 py-1.5 bg-panel border-b border-border flex items-center justify-between">
                  <span className="text-xs font-semibold text-main">{grp.title}</span>
                  <span className="badge-neutral font-mono text-[10px]">{grp.count}</span>
                </div>
                <div>
                  {grp.tasks.map((task) => renderTaskRow(task))}
                </div>
              </div>
            ))
          ) : (
            /* FLAT LIST */
            <div className="panel-surface divide-y divide-border overflow-hidden">
              {filteredTasks.length === 0 ? (
                <div className="p-8 text-center text-muted text-sm space-y-1">
                  <p className="font-medium text-main">{t('view.none')}</p>
                  <p className="text-xs text-faint">
                    {selectedTag
                      ? t('view.noneWithTag', { tag: selectedTag })
                      : filter === 'done'
                      ? t('view.noneDone')
                      : t('view.createHint')}
                  </p>
                </div>
              ) : (
                filteredTasks.map((task) => renderTaskRow(task))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
