import React from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Calendar, FileText, Plus, Repeat, Trash2 } from 'lucide-react';
import { formatDue, isOverdue } from '../../lib/due';
import { OriginBadge } from '../../components/OriginBadge';
import { columnDotClass } from './ManageColumnsModal';
import { KanbanColumn, RECURRENCE_LABELS, TaskList, Thought } from '../../lib/types';
import { KANBAN_MIN_COL_HEIGHT, useKanbanLayout } from './useKanbanLayout';
import { useTaskDrag, canDragTasks } from './useTaskDrag';
import { stopOnControl } from './stopOnControl';
import { AvatarPerson } from '../../components/AvatarStack';

// First row of a Kanban board with several rows: the full height minus what is still visible of the bar
// above the board (--kb-top at the start, shrinking with the scroll position --kb-scroll)
const KANBAN_FIRST_ROW_HEIGHT = `max(${KANBAN_MIN_COL_HEIGHT}px, calc(var(--kb-full) - max(0px, calc(var(--kb-top) - var(--kb-scroll, 0px)))))`;
// Below the board: what the first row has not grown into yet, so the page keeps its height while scrolling
const KANBAN_BAR_SPACER = 'max(0px, calc(var(--kb-top) - var(--kb-scroll, 0px)))';
// Wide Kanban: a column grows to at most this width, the board stays centred
const KANBAN_COL_MAX = 380;
const KANBAN_GAP = 12; // gap-3

// Only the board leaves the page column (header and "new task" keep their width): its width follows
// the columns (at most KANBAN_COL_MAX each, at most the window) and a margin keeps it centred – a
// negative one when it is wider than the page column. Width and margin are animated.
const kanbanBoardStyle = (wide: boolean, columns: number): React.CSSProperties => {
  if (!wide) return { '--kanban-w': '100%', '--kanban-ml': '0px' } as React.CSSProperties;
  const w = `min(100vw - 4rem, ${columns * KANBAN_COL_MAX + (columns - 1) * KANBAN_GAP}px)`;
  return {
    '--kanban-cols': columns,
    '--kanban-w': w,
    '--kanban-ml': `calc((100% - ${w}) / 2)`,
  } as React.CSSProperties;
};

interface KanbanBoardProps {
  // Results of useTaskDrag and useKanbanLayout in TasksView
  drag: ReturnType<typeof useTaskDrag>;
  layout: ReturnType<typeof useKanbanLayout>;
  activeColumns: KanbanColumn[];
  boardColumns: KanbanColumn[];
  boardIdOf: (col: KanbanColumn) => string;
  columnsFor: (task: Thought) => KanbanColumn[];
  getAssigneePeople: (task: Thought) => AvatarPerson[];
  handleConvertToDoc: (task: Thought) => void;
  handleCyclePriority: (task: Thought) => void;
  handleDeletePermanent: (id: string) => void;
  handleQuickAddTaskToColumn: (columnId: string) => void;
  handleSetKanbanStatus: (task: Thought, nextStatus: string) => void;
  inBoardColumn: (task: Thought, boardCol: KanbanColumn) => boolean;
  isKanbanWide: boolean;
  isSelectedListReadOnly: boolean;
  isTaskReadOnly: (task: Thought) => boolean;
  kanbanTasks: Thought[];
  ownColumnIdFor: (task: Thought | undefined, boardColId: string) => string | null;
  ownColumnOf: (task: Thought) => KanbanColumn | undefined;
  renderAssignees: (task: Thought, size: 'xxs' | 'xs') => React.ReactNode;
  renderTaskProgressBar: (task: Thought) => React.ReactNode;
  safeTaskLists: TaskList[];
  selectedTag: string | null;
  setDetailTaskId: (id: string | null) => void;
  setSelectedTag: (tag: string | null) => void;
  setShowDetailModal: (show: boolean) => void;
  tasks: Thought[];
  onOpenDocument: (docId: string, blockId?: string) => void;
}

// The Kanban board of TasksView: columns with their cards, drop slots, quick add, sized by useKanbanLayout
// and moved by useTaskDrag (mouse and finger).
export function KanbanBoard({
  drag,
  layout,
  activeColumns,
  boardColumns,
  boardIdOf,
  columnsFor,
  getAssigneePeople,
  handleConvertToDoc,
  handleCyclePriority,
  handleDeletePermanent,
  handleQuickAddTaskToColumn,
  handleSetKanbanStatus,
  inBoardColumn,
  isKanbanWide,
  isSelectedListReadOnly,
  isTaskReadOnly,
  kanbanTasks,
  ownColumnIdFor,
  ownColumnOf,
  renderAssignees,
  renderTaskProgressBar,
  safeTaskLists,
  selectedTag,
  setDetailTaskId,
  setSelectedTag,
  setShowDetailModal,
  tasks,
  onOpenDocument,
}: KanbanBoardProps) {
  const { t } = useTranslation('tasks');
  const {
    dragHeightRef,
    dragOverKanbanCol,
    draggingTaskId,
    handleKanbanColDragLeave,
    handleKanbanColDragOver,
    handleKanbanDrop,
    handleTaskDragStart,
    justDroppedId,
    kanbanHiddenId,
    kanbanSlot,
    kanbanTouch,
    renderDropSlot,
    resetKanbanDrag,
    setJustDroppedId,
    setKanbanHiddenId,
  } = drag;
  const {
    kanbanBoardRef,
    kanbanColHeight,
    kanbanMultiRow,
    kanbanPerRow,
    kanbanPhoneFirstHeight,
    kanbanPhoneSnap,
  } = layout;

  return (
    <div className="space-y-2">
      {kanbanTouch.ghost}
      <div
        ref={kanbanBoardRef}
        className={`grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 lg:w-[var(--kanban-w)] lg:ml-[var(--kanban-ml)] transition-[width,margin] duration-300 ease-out ${
          isKanbanWide ? 'lg:grid-cols-[repeat(var(--kanban-cols),minmax(0,1fr))]' : 'lg:grid-cols-4'
        }`}
        style={kanbanBoardStyle(isKanbanWide, boardColumns.length)}
      >
        {boardColumns.map((col, colIndex) => {
          const colTasks = kanbanTasks.filter((t) => inBoardColumn(t, col));
          // While dragging: a column the card's list does not have is greyed out and takes nothing
          const blockedForDrag =
            !!draggingTaskId && !ownColumnIdFor(tasks.find((t) => t.id === draggingTaskId), col.id);

          // Cards that take part in the slot count (the dragged one has left its place)
          const visibleIds = colTasks.filter((t) => t.id !== kanbanHiddenId).map((t) => t.id);
          const slotHere = kanbanSlot && kanbanSlot.col === col.id ? kanbanSlot.index : -1;

          return (
            <div
              key={col.id}
              onDragOver={(e) => handleKanbanColDragOver(e, col.id)}
              onDragLeave={(e) => handleKanbanColDragLeave(e, col.id)}
              onDrop={(e) => handleKanbanDrop(e, col.id, colTasks)}
              data-kanban-col={col.id}
              style={
                !kanbanColHeight
                  ? undefined
                  : kanbanPhoneSnap && colIndex === 0
                  ? { height: kanbanPhoneFirstHeight }
                  : !kanbanMultiRow
                  ? { height: kanbanColHeight }
                  : colIndex < kanbanPerRow
                  ? { height: KANBAN_FIRST_ROW_HEIGHT }
                  : { height: 'var(--kb-full)' }
              }
              className={`bg-canvas border border-border flex flex-col overflow-hidden transition-[opacity,background-color,box-shadow] ${
                kanbanPhoneSnap && colIndex > 0 ? 'snap-start snap-always' : ''
              } ${
                kanbanColHeight ? '' : 'min-h-[420px]'
              } ${dragOverKanbanCol === col.id ? 'ring-2 ring-accent/60 bg-accent/5' : ''} ${blockedForDrag ? 'opacity-40' : ''}`}
              title={blockedForDrag ? t('kanban.notInList') : undefined}
            >
              {/* Column Header */}
              <div className="px-3 py-2 bg-panel border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold text-main flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${columnDotClass(col)}`} />
                  <span>{col.name}</span>
                </span>
                <span className="badge-neutral font-mono">{colTasks.length}</span>
              </div>

              {/* Tasks List in Column */}
              <div data-kanban-list className={`p-2 space-y-2 flex-1 min-h-0 overflow-y-auto ${kanbanColHeight ? '' : 'max-h-[70vh]'}`}>
                {colTasks.map((task) => {
                  const isDragging = draggingTaskId === task.id;
                  const readOnly = isTaskReadOnly(task);
                  const visibleIdx = visibleIds.indexOf(task.id);
                  const ownCols = columnsFor(task);
                  const ownIdx = ownCols.findIndex((c) => c.id === ownColumnOf(task)?.id);
                  const prevCol = ownIdx > 0 ? ownCols[ownIdx - 1] : undefined;
                  const nextCol = ownIdx >= 0 ? ownCols[ownIdx + 1] : undefined;

                  return (
                    <React.Fragment key={task.id}>
                    <AnimatePresence initial={false} custom={justDroppedId !== null}>
                      {slotHere >= 0 && slotHere === visibleIdx && renderDropSlot(col.id, visibleIdx)}
                    </AnimatePresence>
                    <div
                      draggable={canDragTasks && !readOnly}
                      onDragStart={(e) => {
                        handleTaskDragStart(e, task);
                        setJustDroppedId(null);
                        dragHeightRef.current = e.currentTarget.getBoundingClientRect().height;
                        // Hidden a tick later: hiding the source right away would cancel the drag
                        window.setTimeout(() => setKanbanHiddenId(task.id), 0);
                      }}
                      onDragEnd={resetKanbanDrag}
                      data-kanban-task={task.id}
                      {...kanbanTouch.cardProps(task.id, task.content, !readOnly)}
                      onClick={() => {
                        if (kanbanTouch.consumeClick()) return;
                        setDetailTaskId(task.id);
                        setShowDetailModal(true);
                      }}
                      className={`panel-surface p-2.5 space-y-2 hover:border-strong transition-colors shadow-sm group relative select-none ${
                        readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
                      } ${
                        kanbanHiddenId === task.id ? 'hidden' : isDragging ? 'opacity-30 border border-dashed border-accent/40' : ''
                      } ${justDroppedId === task.id ? 'ring-2 ring-accent/60' : ''}`}
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
                          onClick={() => handleConvertToDoc(task)}
                          title={task.docId ? t('row.openNote') : t('detail.toDoc')}
                          className={`${task.docId ? 'text-accent' : 'text-faint'} hover:text-accent p-0.5`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeletePermanent(task.id)}
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
                        <span className="truncate">{task.notes}</span>
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
                          onClick={() => handleCyclePriority(task)}
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
                          onClick={() => handleCyclePriority(task)}
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
                        <span className="inline-flex items-center text-muted" title={`Wiederholt sich ${RECURRENCE_LABELS[task.recurrence]}`}>
                          <Repeat className="w-2.5 h-2.5" />
                        </span>
                      )}
                      {task.tags?.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                          className={`text-[9px] px-1.5 py-0.2 rounded-pill border transition-colors ${
                            selectedTag === tag
                              ? 'bg-accent/15 border-accent text-accent font-semibold'
                              : 'badge-neutral hover:border-accent'
                          }`}
                        >
                          #{tag}
                        </button>
                      ))}
                      {getAssigneePeople(task).length > 0 && (
                        <span className="ml-auto">{renderAssignees(task, 'xxs')}</span>
                      )}
                    </div>

                    {/* Column Navigation controls: Move Left / Move Right */}
                    {!readOnly && (
                    <div
                      className="flex items-center justify-between pt-1 border-t border-border text-[10px]"
                      onClick={stopOnControl}
                    >
                      <button
                        type="button"
                        disabled={!prevCol}
                        onClick={() => prevCol && handleSetKanbanStatus(task, prevCol.id)}
                        className="text-faint hover:text-main disabled:opacity-20 flex items-center gap-0.5"
                        title={prevCol ? `Nach "${prevCol.name}"` : ''}
                      >
                        <ArrowLeft className="w-3 h-3" />
                        <span className="hidden sm:inline">{prevCol?.name ?? ''}</span>
                      </button>

                      <button
                        type="button"
                        disabled={!nextCol}
                        onClick={() => nextCol && handleSetKanbanStatus(task, nextCol.id)}
                        className="text-faint hover:text-main disabled:opacity-20 flex items-center gap-0.5"
                        title={nextCol ? `Nach "${nextCol.name}"` : ''}
                      >
                        <span className="hidden sm:inline">{nextCol?.name ?? ''}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    )}
                  </div>
                    </React.Fragment>
                );
              })}
                <AnimatePresence initial={false} custom={justDroppedId !== null}>
                  {slotHere >= 0 && slotHere === visibleIds.length && renderDropSlot(col.id, visibleIds.length)}
                </AnimatePresence>

                {colTasks.length === 0 && slotHere < 0 && (
                  <div className="p-4 text-center text-faint text-xs italic">
                    {t('kanban.emptyColumn')}
                  </div>
                )}
              </div>

              {/* Quick Add Task to Column. In "Alle Aufgaben" a new task has no list: a column only lists
                  have shows the button greyed out, with a hint where the column is */}
              {!isSelectedListReadOnly && (
              <div
                className="p-2 border-t border-border bg-panel"
                title={
                  activeColumns.some((c) => boardIdOf(c) === col.id)
                    ? undefined
                    : t('kanban.columnElsewhere', {
                        lists: safeTaskLists
                          .filter((l) => (Array.isArray(l.columns) ? l.columns : []).some((c) => boardIdOf(c) === col.id))
                          .map((l) => `„${l.title}“`)
                          .join(', '),
                      })
                }
              >
                <button
                  type="button"
                  disabled={!activeColumns.some((c) => boardIdOf(c) === col.id)}
                  onClick={() => handleQuickAddTaskToColumn(col.id)}
                  className="w-full h-7 px-2 text-xs border border-dashed border-border rounded-btn text-muted hover:text-main hover:bg-canvas flex items-center justify-center gap-1 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Plus className="w-3 h-3" />
                  <span>{t('kanban.addTask')}</span>
                </button>
              </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Desktop: room as high as what is still visible of the bar above the board, so the page can
          scroll the bar away even with one row while the first row grows (the page keeps its height) */}
      {kanbanMultiRow && <div aria-hidden style={{ height: KANBAN_BAR_SPACER }} />}
    </div>
  );
}
