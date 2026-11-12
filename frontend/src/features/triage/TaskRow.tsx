import React from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, Edit3, FileText, Lock, Repeat, Bell, Trash2 } from 'lucide-react';
import { formatDue, isOverdue } from '../../lib/due';
import { OriginBadge } from '../../components/OriginBadge';
import { SelectMenu } from '../../components/SelectMenu';
import { columnDotClass } from './ManageColumnsModal';
import { KanbanColumn, RECURRENCE_LABELS, Thought } from '../../lib/types';
import { canDragTasks } from './useTaskDrag';
import { stopOnControl } from './stopOnControl';
import { renderMentions } from '../../lib/markdown';
import { remindersText } from '../../lib/reminders';

interface TaskRowProps {
  task: Thought;
  readOnly: boolean;
  // Dragging (useTaskDrag in TasksView): this row is being dragged / the drop line before or after it
  isDragging: boolean;
  dropPosition: 'before' | 'after' | null;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, task: Thought) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, taskId: string) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>, taskId: string) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, task: Thought) => void;
  onOpen: (taskId: string) => void;
  columnsFor: (task: Thought) => KanbanColumn[];
  handleConvertToDoc: (task: Thought) => void;
  handleCyclePriority: (task: Thought) => void;
  handleDeletePermanent: (id: string) => void;
  handleSetKanbanStatus: (task: Thought, nextStatus: string) => void;
  handleToggleDone: (task: Thought) => void;
  onOpenDocument: (docId: string, blockId?: string) => void;
  renderAssignees: (task: Thought, size: 'xxs' | 'xs') => React.ReactNode;
  renderTaskProgressBar: (task: Thought) => React.ReactNode;
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  // The calendar's day panel: no due date, assignees and actions at the end of the badges instead of beside the task
  compact?: boolean;
}

// One task in the list view of TasksView: drag handle and drop line, tick, title, chips (column,
// priority, due date, hashtags, note, origin), progress, assignees and the desktop actions. Memoized with
// stable functions from TasksView: opening the task dialog or dragging another row does not render it again.
function TaskRowView({
  task,
  readOnly,
  isDragging,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
  columnsFor,
  handleConvertToDoc,
  handleCyclePriority,
  handleDeletePermanent,
  handleSetKanbanStatus,
  handleToggleDone,
  onOpenDocument,
  renderAssignees,
  renderTaskProgressBar,
  selectedTag,
  setSelectedTag,
  compact = false,
}: TaskRowProps) {
  const { t } = useTranslation('tasks');
  const isCompleted = task.isCompleted;

  // Assignees and the desktop actions: at the end of the row, or (compact) at the end of the badges
  const side = (
    <>
      {renderAssignees(task, 'xs')}

      {/* Action Controls (Desktop only - on mobile, tapping the task opens Detail Modal) */}
      <div className="hidden sm:flex items-center gap-1 flex-shrink-0" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          draggable={false}
          onClick={() => onOpen(task.id)}
          className="text-faint hover:text-accent p-1.5 transition-colors"
          title={readOnly ? t('detail.view') : t('detail.edit')}
        >
          {readOnly ? <Lock className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
        </button>
        {!readOnly && (
        <>
        <button
          type="button"
          draggable={false}
          onClick={() => handleConvertToDoc(task)}
          title={task.docId ? t('row.openNote') : t('detail.toDoc')}
          className={`${task.docId ? 'text-accent' : 'text-faint'} hover:text-accent p-1.5 transition-colors hidden sm:block`}
        >
          <FileText className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          draggable={false}
          onClick={() => handleDeletePermanent(task.id)}
          title={t('detail.delete')}
          className="text-faint hover:text-status-err p-1.5 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        </>
        )}
      </div>
    </>
  );

  return (
    <div
      key={task.id}
      data-tour="task"
      draggable={canDragTasks && !readOnly}
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, task.id)}
      onDragLeave={(e) => onDragLeave(e, task.id)}
      onDrop={(e) => onDrop(e, task)}
      onClick={() => onOpen(task.id)}
      className={`px-3.5 py-3.5 sm:px-3 sm:py-2.5 flex items-center justify-between gap-3 transition-colors hover:bg-panel-hover group border-b border-border last:border-b-0 relative cursor-pointer select-none ${
        readOnly ? '' : 'cursor-grab active:cursor-grabbing'
      } ${
        isCompleted ? 'opacity-65' : ''
      } ${isDragging ? 'opacity-30 border border-dashed border-accent/40' : ''}`}
    >
      {/* Drop insertion line indicator */}
      {dropPosition === 'before' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent z-20 pointer-events-none rounded-full shadow-[0_0_8px_rgba(var(--accent-rgb),0.6)]" />
      )}
      {dropPosition === 'after' && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent z-20 pointer-events-none rounded-full shadow-[0_0_8px_rgba(var(--accent-rgb),0.6)]" />
      )}

      <div className="flex items-center gap-3 sm:gap-2.5 min-w-0 flex-1">
        {/* Checkbox (larger touch target on mobile) */}
        <button
          type="button"
          draggable={false}
          disabled={readOnly}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleDone(task);
          }}
          className={`w-5 h-5 sm:w-4 sm:h-4 checkbox-square flex items-center justify-center flex-shrink-0 transition-colors border disabled:cursor-default ${
            isCompleted
              ? 'bg-status-ok border-status-ok text-on-accent'
              : 'border-strong hover:border-accent text-transparent'
          }`}
          title={readOnly ? t('detail.readOnly') : isCompleted ? t('detail.markOpen') : t('row.markDone')}
        >
          <Check className="w-3.5 h-3.5 sm:w-3 sm:h-3 stroke-[3]" />
        </button>

        {/* Clickable Title & Metadata */}
        <div className="min-w-0 flex-1 cursor-pointer space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p
              className={`text-sm break-words leading-tight ${
                isCompleted ? 'line-through text-faint' : 'text-main font-medium'
              }`}
            >
              {task.content}
            </p>
          </div>

          {/* Subtasks Progress Bar */}
          {renderTaskProgressBar(task)}

          {/* Interactive Badges Bar */}
          <div
            className="flex flex-wrap items-center gap-1.5 pt-0.5 empty:hidden"
            onClick={stopOnControl}
          >
            {(task.convertedType === 'document_block' || task.docId) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const docId = task.docId || (task.convertedRefId ? task.convertedRefId.split(':')[0] : '');
                  const blockId = task.blockId || (task.convertedRefId ? task.convertedRefId.split(':')[1] : '');
                  if (docId) onOpenDocument(docId, blockId);
                }}
                className="h-5 px-1.5 text-[10px] rounded-btn border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 cursor-pointer flex items-center gap-1 font-medium"
                title={t('row.openInNote')}
              >
                <FileText className="w-2.5 h-2.5" />
                <span>{t('row.inNote')}</span>
              </button>
            )}

            {/* Status: dot in the column colour; a selector on desktop, plain text on phones (changed in TaskDetailModal) */}
            {(() => {
              const statusId = task.kanbanStatus || (isCompleted ? 'done' : 'todo');
              const taskColumns = columnsFor(task);
              const statusCol = taskColumns.find((c) => c.id === statusId);
              const dot = <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${columnDotClass(statusCol)}`} aria-hidden="true" />;
              return (
                <>
                  <span className="hidden sm:inline-flex">
                    <SelectMenu
                      ariaLabel={t('row.changeStatus')}
                      title={t('row.changeStatus')}
                      value={statusId}
                      disabled={readOnly}
                      onChange={(id) => handleSetKanbanStatus(task, id)}
                      buttonClassName="h-5 px-1.5 gap-1 text-[10px] rounded-btn border border-border bg-panel text-muted hover:text-main"
                      options={taskColumns.map((c) => ({
                        value: c.id,
                        label: c.name,
                        lead: <span className={`w-1.5 h-1.5 rounded-full ${columnDotClass(c)}`} aria-hidden="true" />,
                      }))}
                    />
                  </span>
                  {statusCol && (
                    <span className="sm:hidden inline-flex items-center gap-1 text-[10px] text-muted" title={t('row.status')}>
                      {dot}
                      {statusCol.name}
                    </span>
                  )}
                </>
              );
            })()}

            {/* Priority badge: click to cycle or clear */}
            {task.priority === 'urgent' && (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => handleCyclePriority(task)}
                className="badge-accent text-[10px] cursor-pointer hover:opacity-85 disabled:cursor-default"
                title={t('row.urgentToNormal')}
              >
                {t('tasks:listing.urgent')}
              </button>
            )}
            {task.priority === 'high' && (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => handleCyclePriority(task)}
                className="px-1.5 py-0.5 border border-status-warn text-status-warn rounded-btn text-[10px] font-medium cursor-pointer hover:opacity-85 disabled:cursor-default"
                title={t('row.highToUrgent')}
              >
                {t('tasks:listing.high')}
              </button>
            )}

            <OriginBadge origin={task.origin} createdAt={task.createdAt} />

            {/* Note indicator */}
            {task.notes && (
              <button
                type="button"
                onClick={() => onOpen(task.id)}
                className="inline-flex items-center gap-1 text-[10px] text-muted hover:text-main bg-canvas px-1.5 py-0.5 rounded border border-border"
                title={t('row.showNote')}
              >
                <FileText className="w-2.5 h-2.5 text-accent" />
                <span className="truncate max-w-[120px]">{renderMentions(task.notes)}</span>
              </button>
            )}

            {/* Due Date (not in the calendar's day panel: the day stands above it) */}
            {task.dueDate && !compact && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] ${!task.isCompleted && isOverdue(task.dueDate) ? 'text-status-err font-semibold' : 'text-muted'}`}
                title={t('row.dueTitle', { due: task.dueDate.replace('T', ' ') })}
              >
                <Calendar className="w-2.5 h-2.5 text-accent" />
                <span>{formatDue(task.dueDate)}</span>
              </span>
            )}
            {task.recurrence && (
              <span className="inline-flex items-center text-muted" title={t('repeats', { rule: RECURRENCE_LABELS[task.recurrence] })}>
                <Repeat className="w-3 h-3" />
              </span>
            )}
            {task.dueDate && !!task.reminders?.length && (
              <span
                className="inline-flex items-center text-muted"
                title={t('tasks:detail.reminder.own', { list: remindersText(task.reminders, !task.dueDate.includes('T')) })}
              >
                <Bell className="w-3 h-3" />
              </span>
            )}

            {/* Hashtag badges */}
            {task.tags?.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`text-[10px] px-1.5 py-0.2 rounded-pill border transition-colors ${
                  selectedTag === tag
                    ? 'bg-accent/15 border-accent text-accent font-semibold'
                    : 'badge-neutral hover:border-accent'
                }`}
                title={t('common:filterTag', { tag })}
              >
                #{tag}
              </button>
            ))}
            {compact && <div className="ml-auto flex items-center gap-1 -my-1 -mr-1.5">{side}</div>}
          </div>
        </div>
      </div>

      {!compact && side}
    </div>
  );
}

export const TaskRow = React.memo(TaskRowView);
