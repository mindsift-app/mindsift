import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash } from 'lucide-react';
import { TaskTrashList } from './TaskTrashList';
import { SelectMenu } from '../../components/SelectMenu';
import { TaskList, Thought, TrashedTask } from '../../lib/types';
import { GroupBy, TaskFilter, TaskSort } from './taskViewTypes';
import { TaskGroup, tagFilterLabel } from './taskListing';
import { LoadingState } from '../../components/Spinner';
import type { useTaskDrag } from './useTaskDrag';


interface TaskListViewProps {
  // From useTaskDrag in TasksView: a task can be dropped on the header of a status or priority group (or,
  // in an empty group, on the strip below it that shows while dragging)
  drag: Pick<
    ReturnType<typeof useTaskDrag>,
    'draggingTaskId' | 'dragOverGroup' | 'canDropInGroup' | 'handleGroupDragOver' | 'handleGroupDragLeave' | 'handleDropOnGroup'
  >;
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
  selectedTags: readonly string[];
  setFilter: (filter: TaskFilter) => void;
  setGroupBy: (g: GroupBy) => void;
  setSortBy: (sort: TaskSort) => void;
  sortBy: TaskSort;
  // null: not loaded yet (it loads when the trash is opened)
  taskTrash: TrashedTask[] | null;
}

// List view of TasksView: filter tabs (open, done, trash), grouping and sorting, clearing, then the rows
// (grouped or flat) or the task trash
export function TaskListView({
  drag,
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
  selectedTags,
  setFilter,
  setGroupBy,
  setSortBy,
  sortBy,
  taskTrash,
}: TaskListViewProps) {
  const { t } = useTranslation('tasks');
  // Empty priority groups only show while a task is dragged that may go there
  const shownGroups = groupedTasks?.filter(
    (grp) => grp.tasks.length > 0 || !grp.hideWhenEmpty || (!!grp.drop && drag.canDropInGroup(grp.drop))
  );
  return (
    <div className="space-y-2">
      {/* Open, done, trash: the same switch on phones (full width, 44 px tall) and on the desktop */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 sm:flex-initial seg-track text-xs">
          <button
            onClick={() => setFilter('open')}
            aria-pressed={filter === 'open'}
            className={`seg-item flex-1 sm:flex-initial h-11 sm:h-auto ${filter === 'open' ? 'seg-item-active seg-item-raised' : ''}`}
          >
            {t('view.openCount', { count: openTasks.length })}
          </button>

          <button
            onClick={() => setFilter('done')}
            aria-pressed={filter === 'done'}
            className={`seg-item flex-1 sm:flex-initial h-11 sm:h-auto ${filter === 'done' ? 'seg-item-active seg-item-raised' : ''}`}
          >
            {t('view.doneCount', { count: doneTasks.length })}
          </button>

          <button
            onClick={() => setFilter('discarded')}
            aria-pressed={filter === 'discarded'}
            className={`seg-item flex-1 sm:flex-initial h-11 sm:h-auto ${filter === 'discarded' ? 'seg-item-active seg-item-raised' : ''}`}
          >
            {taskTrash ? t('view.trashCount', { count: taskTrash.length }) : t('common:trash')}
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
        {filter === 'discarded' && taskTrash?.some((t) => t.canEdit) && (
          <button
            onClick={handleEmptyTaskTrash}
            className="btn-action h-8 w-8 p-0 justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:ml-0"
            title={t('view.emptyTrash')}
            aria-label={t('view.emptyTrash')}
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        )}
        {filter === 'done' && doneTasks.length > 0 && !isSelectedListReadOnly && (
          <button
            onClick={handleClearDone}
            className="btn-action h-8 w-8 p-0 justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:ml-0"
            title={t('view.doneToTrash')}
            aria-label={t('view.doneToTrash')}
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {loading || (filter === 'discarded' && !taskTrash) ? (
        <LoadingState label={t('view.loading')} />
      ) : filter === 'discarded' ? (
        <TaskTrashList
          items={taskTrash ?? []}
          lists={safeTaskLists}
          showList={selectedListId === 'all'}
          onRestore={handleRestoreTrashed}
          onPurge={handlePurgeTrashed}
        />
      ) : (
        <div className="space-y-3">
          {shownGroups && shownGroups.length > 0 ? (
            /* GROUPED LIST */
            shownGroups.map((grp) => {
              const drop = grp.drop;
              // Status and priority groups take a dragged task (like the Kanban columns); one it may not go
              // into (a column its list lacks) is greyed out
              const accepts = !!drop && drag.canDropInGroup(drop);
              const blocked = !!drop && !!drag.draggingTaskId && !accepts;
              const over = !!drop && drag.dragOverGroup === grp.key;
              return (
                <div
                  key={grp.key}
                  className={`panel-surface overflow-hidden transition-[opacity,box-shadow] ${over ? 'ring-2 ring-accent/60' : ''} ${
                    blocked ? 'opacity-40' : ''
                  }`}
                  title={blocked ? t('kanban.notInList') : undefined}
                >
                  <div
                    data-group-drop={drop ? grp.key : undefined}
                    onDragOver={drop ? (e) => drag.handleGroupDragOver(e, grp) : undefined}
                    onDragLeave={drop ? (e) => drag.handleGroupDragLeave(e, grp) : undefined}
                    onDrop={drop ? (e) => void drag.handleDropOnGroup(e, grp) : undefined}
                  >
                    <div
                      className={`px-3 py-1.5 border-b border-border flex items-center justify-between transition-colors ${
                        over ? 'bg-accent/10' : 'bg-panel'
                      }`}
                    >
                      <span className="text-xs font-semibold text-main">{grp.title}</span>
                      <span className="badge-neutral font-mono text-[10px]">{grp.count}</span>
                    </div>
                    {/* An empty group gets a drop strip only while a task is dragged that may go there */}
                    {accepts && grp.tasks.length === 0 && (
                      <div
                        aria-hidden="true"
                        className={`h-10 m-2 rounded-card border-2 border-dashed transition-colors ${
                          over ? 'border-accent/60 bg-accent/5' : 'border-border'
                        }`}
                      />
                    )}
                  </div>
                  {/* Rows of a greyed-out group take no drop either (it would only reorder) */}
                  <div className={blocked ? 'pointer-events-none' : undefined}>
                    {grp.tasks.map((task) => renderTaskRow(task))}
                  </div>
                </div>
              );
            })
          ) : (
            /* FLAT LIST */
            <div className="panel-surface divide-y divide-border overflow-hidden">
              {filteredTasks.length === 0 ? (
                <div className="p-8 text-center text-muted text-sm space-y-1">
                  <p className="font-medium text-main">{t('view.none')}</p>
                  <p className="text-xs text-faint">
                    {selectedTags.length > 0
                      ? t('view.noneWithTag', { tags: tagFilterLabel(selectedTags), count: selectedTags.length })
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
