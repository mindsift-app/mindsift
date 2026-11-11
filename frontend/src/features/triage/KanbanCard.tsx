import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Calendar, FileText, Repeat, Bell, Trash2 } from 'lucide-react';
import { formatDue, isOverdue } from '../../lib/due';
import { OriginBadge } from '../../components/OriginBadge';
import { KanbanColumn, RECURRENCE_LABELS, TaskList, Thought } from '../../lib/types';
import { canDragTasks } from './useTaskDrag';
import { stopOnControl } from './stopOnControl';
import { AvatarPerson } from '../../components/AvatarStack';
import { renderMentions } from '../../lib/markdown';
import { remindersText } from '../../lib/reminders';

interface KanbanCardProps {
  task: Thought;
  readOnly: boolean;
  // Drag state of this card: picked up (dimmed), taken out of the column, just dropped (ring)
  isDragging: boolean;
  hidden: boolean;
  justDropped: boolean;
  prevCol?: KanbanColumn;
  nextCol?: KanbanColumn;
  // The tag filter, only when this card has that tag
  activeTag: string | null;
  // Read-only, assignees and columns come from the lists: a change there renders every card again
  lists: TaskList[];
  // Stable functions (KanbanBoard), so a card renders again only when its own props change
  onDragStart: (e: React.DragEvent<HTMLDivElement>, task: Thought) => void;
  onDragEnd: () => void;
  touchProps: (taskId: string, label: string, draggable: boolean) => Record<string, unknown>;
  onOpen: (taskId: string) => void;
  onConvertToDoc: (task: Thought) => void;
  onDelete: (id: string) => void;
  onCyclePriority: (task: Thought) => void;
  onSetStatus: (task: Thought, nextStatus: string) => void;
  onTagClick: (tag: string) => void;
  onOpenDocument: (docId: string, blockId?: string) => void;
  getAssigneePeople: (task: Thought) => AvatarPerson[];
  renderAssignees: (task: Thought, size: 'xxs' | 'xs') => React.ReactNode;
  renderTaskProgressBar: (task: Thought) => React.ReactNode;
}

// One card of the Kanban board. Its own component (memoized): moving the drop slot while dragging, the
// full-width switch or a tag filter render only the cards they change, not the whole board.
const KanbanCardView: React.FC<KanbanCardProps> = ({
  task,
  readOnly,
  isDragging,
  hidden,
  justDropped,
  prevCol,
  nextCol,
  activeTag,
  onDragStart,
  onDragEnd,
  touchProps,
  onOpen,
  onConvertToDoc,
  onDelete,
  onCyclePriority,
  onSetStatus,
  onTagClick,
  onOpenDocument,
  getAssigneePeople,
  renderAssignees,
  renderTaskProgressBar,
}) => {
  const { t } = useTranslation('tasks');
  return (
    <div
      draggable={canDragTasks && !readOnly}
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      data-kanban-task={task.id}
      {...touchProps(task.id, task.content, !readOnly)}
      onClick={() => onOpen(task.id)}
      className={`mt-2 first:mt-0 panel-surface p-2.5 space-y-2 hover:border-strong transition-colors shadow-sm group relative select-none ${
        readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${hidden ? 'hidden' : isDragging ? 'opacity-30 border border-dashed border-accent/40' : ''} ${
        justDropped ? 'ring-2 ring-accent/60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-xs font-medium break-words flex-1 leading-snug ${
            task.isCompleted ? 'line-through text-faint' : 'text-main'
          }`}
        >
          {task.content}
        </p>
        {!readOnly && (
          <div className="hidden sm:flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onConvertToDoc(task)}
              title={task.docId ? t('row.openNote') : t('detail.toDoc')}
              className={`${task.docId ? 'text-accent' : 'text-faint'} hover:text-accent p-0.5`}
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(task.id)}
              title={t('detail.delete')}
              className="text-faint hover:text-status-err p-0.5"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Subtasks progress */}
      {renderTaskProgressBar(task)}

      {/* Notes preview badge */}
      {task.notes && (
        <div className="flex items-center gap-1 text-[10px] text-muted bg-canvas p-1 rounded border border-border truncate">
          <FileText className="w-2.5 h-2.5 text-accent flex-shrink-0" />
          <span className="truncate">{renderMentions(task.notes)}</span>
        </div>
      )}

      {/* Badges: In Notiz, Priority, Status, Tags */}
      <div className="flex flex-wrap items-center gap-1 pt-0.5" onClick={stopOnControl}>
        {(task.convertedType === 'document_block' || task.docId) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const docId = task.docId || (task.convertedRefId ? task.convertedRefId.split(':')[0] : '');
              const blockId = task.blockId || (task.convertedRefId ? task.convertedRefId.split(':')[1] : '');
              if (docId) onOpenDocument(docId, blockId);
            }}
            className="h-4 px-1.5 text-[9px] rounded-btn border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 cursor-pointer flex items-center gap-1 font-medium shrink-0"
            title={t('row.openInNote')}
          >
            <FileText className="w-2.5 h-2.5" />
            <span>{t('row.inNote')}</span>
          </button>
        )}
        {task.priority === 'urgent' && (
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onCyclePriority(task)}
            className="badge-accent text-[9px] cursor-pointer hover:opacity-85 disabled:cursor-default"
            title={t('row.urgentToNormal')}
          >
            {t('tasks:listing.urgent')}
          </button>
        )}
        {task.priority === 'high' && (
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onCyclePriority(task)}
            className="px-1.5 py-0.2 border border-status-warn text-status-warn rounded-btn text-[9px] font-medium cursor-pointer hover:opacity-85 disabled:cursor-default"
            title={t('row.highToUrgent')}
          >
            {t('tasks:listing.high')}
          </button>
        )}
        <OriginBadge origin={task.origin} createdAt={task.createdAt} size="xs" />
        {task.dueDate && (
          <span
            className={`inline-flex items-center gap-0.5 text-[9px] ${!task.isCompleted && isOverdue(task.dueDate) ? 'text-status-err font-semibold' : 'text-muted'}`}
            title={t('row.dueTitle', { due: task.dueDate.replace('T', ' ') })}
          >
            <Calendar className="w-2.5 h-2.5" />
            <span>{formatDue(task.dueDate)}</span>
          </span>
        )}
        {task.recurrence && (
          <span className="inline-flex items-center text-muted" title={t('repeats', { rule: RECURRENCE_LABELS[task.recurrence] })}>
            <Repeat className="w-2.5 h-2.5" />
          </span>
        )}
        {task.dueDate && !!task.reminders?.length && (
          <span
            className="inline-flex items-center text-muted"
            title={t('tasks:detail.reminder.own', { list: remindersText(task.reminders, !task.dueDate.includes('T')) })}
          >
            <Bell className="w-2.5 h-2.5" />
          </span>
        )}
        {task.tags?.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onTagClick(tag)}
            className={`text-[9px] px-1.5 py-0.2 rounded-pill border transition-colors ${
              activeTag === tag ? 'bg-accent/15 border-accent text-accent font-semibold' : 'badge-neutral hover:border-accent'
            }`}
          >
            #{tag}
          </button>
        ))}
        {getAssigneePeople(task).length > 0 && <span className="ml-auto">{renderAssignees(task, 'xxs')}</span>}
      </div>

      {/* Column Navigation controls: Move Left / Move Right */}
      {!readOnly && (
        <div className="flex items-center justify-between pt-1 border-t border-border text-[10px]" onClick={stopOnControl}>
          <button
            type="button"
            disabled={!prevCol}
            onClick={() => prevCol && onSetStatus(task, prevCol.id)}
            className="text-faint hover:text-main disabled:opacity-20 flex items-center gap-0.5"
            title={prevCol ? t('kanban.moveTo', { column: prevCol.name }) : ''}
          >
            <ArrowLeft className="w-3 h-3" />
            <span className="hidden sm:inline">{prevCol?.name ?? ''}</span>
          </button>

          <button
            type="button"
            disabled={!nextCol}
            onClick={() => nextCol && onSetStatus(task, nextCol.id)}
            className="text-faint hover:text-main disabled:opacity-20 flex items-center gap-0.5"
            title={nextCol ? t('kanban.moveTo', { column: nextCol.name }) : ''}
          >
            <span className="hidden sm:inline">{nextCol?.name ?? ''}</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};

export const KanbanCard = React.memo(KanbanCardView);
