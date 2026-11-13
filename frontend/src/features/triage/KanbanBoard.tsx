import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { columnDotClass } from './ManageColumnsModal';
import { KanbanColumn, TaskList, Thought } from '../../lib/types';
import { KANBAN_MIN_COL_HEIGHT, useKanbanLayout } from './useKanbanLayout';
import { useTaskDrag } from './useTaskDrag';
import { AvatarPerson } from '../../components/AvatarStack';
import { useLatestCallback } from '../../lib/useLatestCallback';
import { KanbanCard } from './KanbanCard';
import { useKanbanSlotShift } from './useKanbanSlotShift';

// First row of a Kanban board with several rows: the full height minus what is still visible of the bar
// above the board (--kb-top at the start, shrinking with the scroll position --kb-scroll, which is set on
// each element marked data-kb-scroll)
const KANBAN_FIRST_ROW_HEIGHT = `max(${KANBAN_MIN_COL_HEIGHT}px, calc(var(--kb-full) - max(0px, calc(var(--kb-top) - var(--kb-scroll, 0px)))))`;
// Below the board: what the first row has not grown into yet, so the page keeps its height while scrolling
const KANBAN_BAR_SPACER = 'max(0px, calc(var(--kb-top) - var(--kb-scroll, 0px)))';
// Desktop board: as many columns per row as fit at least KANBAN_COL_MIN wide (the rest wraps into further
// rows); a column grows to at most KANBAN_COL_MAX, so a few columns on a wide screen do not stretch across it
const KANBAN_COL_MIN = 200;
const KANBAN_COL_MAX = 420;
const KANBAN_GAP = 12; // gap-3
const kanbanBoardStyle = (columns: number): React.CSSProperties =>
  ({
    '--kanban-col-min': `${KANBAN_COL_MIN}px`,
    '--kanban-max-w': `${columns * KANBAN_COL_MAX + Math.max(0, columns - 1) * KANBAN_GAP}px`,
  }) as React.CSSProperties;

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

  // Stable functions for the cards (KanbanCard is memoized): each one runs what this render passed in
  const cardDragStart = useLatestCallback((e: React.DragEvent<HTMLDivElement>, task: Thought) => {
    handleTaskDragStart(e, task);
    setJustDroppedId(null);
    dragHeightRef.current = e.currentTarget.getBoundingClientRect().height;
    // Hidden a tick later: hiding the source right away would cancel the drag
    window.setTimeout(() => setKanbanHiddenId(task.id), 0);
  });
  const cardDragEnd = useLatestCallback(() => resetKanbanDrag());
  const openCard = useLatestCallback((taskId: string) => {
    if (kanbanTouch.consumeClick()) return;
    setDetailTaskId(taskId);
    setShowDetailModal(true);
  });
  const toggleTag = useLatestCallback((tag: string) => setSelectedTag(selectedTag === tag ? null : tag));
  const stableConvertToDoc = useLatestCallback(handleConvertToDoc);
  const stableDelete = useLatestCallback(handleDeletePermanent);
  const stableCyclePriority = useLatestCallback(handleCyclePriority);
  const stableSetStatus = useLatestCallback(handleSetKanbanStatus);
  const stableOpenDocument = useLatestCallback(onOpenDocument);
  const stableAssigneePeople = useLatestCallback(getAssigneePeople);
  const stableRenderAssignees = useLatestCallback(renderAssignees);
  const stableProgressBar = useLatestCallback(renderTaskProgressBar);
  // The drop slot opens by moving the cards below it with a transform, not by changing the layout
  useKanbanSlotShift(kanbanBoardRef, kanbanSlot, kanbanHiddenId, dragHeightRef);

  return (
    <div className="space-y-2">
      {kanbanTouch.ghost}
      <div
        ref={kanbanBoardRef}
        className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 lg:grid-cols-[repeat(auto-fit,minmax(var(--kanban-col-min),1fr))] lg:max-w-[var(--kanban-max-w)]"
        style={kanbanBoardStyle(boardColumns.length)}
      >
        {boardColumns.map((col, colIndex) => {
          const colTasks = kanbanTasks.filter((t) => inBoardColumn(t, col));
          // While dragging: a column the card's list does not have is greyed out and takes nothing
          const blockedForDrag =
            !!draggingTaskId && !ownColumnIdFor(tasks.find((t) => t.id === draggingTaskId), col.id);

          const slotHere = kanbanSlot && kanbanSlot.col === col.id ? kanbanSlot.index : -1;

          return (
            <div
              key={col.id}
              onDragOver={(e) => handleKanbanColDragOver(e, col.id)}
              onDragLeave={(e) => handleKanbanColDragLeave(e, col.id)}
              onDrop={(e) => handleKanbanDrop(e, col.id, colTasks)}
              data-kanban-col={col.id}
              data-kb-scroll={kanbanMultiRow && !kanbanPhoneSnap && colIndex < kanbanPerRow ? '' : undefined}
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

              {/* Tasks List in Column. Cards space themselves (mt-2 first:mt-0). The drop slot is its last
                  child, positioned within the list (useKanbanSlotShift), so dragging inserts no element
                  between the cards: the sibling rules of Tailwind's space-y and divide classes made the
                  browser restyle every card of the column for each one */}
              <div data-kanban-list className={`relative p-2 flex-1 min-h-0 overflow-y-auto ${kanbanColHeight ? '' : 'max-h-[70vh]'}`}>
                {colTasks.map((task) => {
                  const readOnly = isTaskReadOnly(task);
                  const ownCols = columnsFor(task);
                  const ownIdx = ownCols.findIndex((c) => c.id === ownColumnOf(task)?.id);
                  const prevCol = ownIdx > 0 ? ownCols[ownIdx - 1] : undefined;
                  const nextCol = ownIdx >= 0 ? ownCols[ownIdx + 1] : undefined;

                  return (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      readOnly={readOnly}
                      isDragging={draggingTaskId === task.id}
                      hidden={kanbanHiddenId === task.id}
                      justDropped={justDroppedId === task.id}
                      prevCol={prevCol}
                      nextCol={nextCol}
                      activeTag={selectedTag && task.tags?.includes(selectedTag) ? selectedTag : null}
                      lists={safeTaskLists}
                      onDragStart={cardDragStart}
                      onDragEnd={cardDragEnd}
                      touchProps={kanbanTouch.cardProps}
                      onOpen={openCard}
                      onConvertToDoc={stableConvertToDoc}
                      onDelete={stableDelete}
                      onCyclePriority={stableCyclePriority}
                      onSetStatus={stableSetStatus}
                      onTagClick={toggleTag}
                      onOpenDocument={stableOpenDocument}
                      getAssigneePeople={stableAssigneePeople}
                      renderAssignees={stableRenderAssignees}
                      renderTaskProgressBar={stableProgressBar}
                    />
                );
              })}
                {colTasks.length === 0 && slotHere < 0 && (
                  <div className="p-4 text-center text-faint text-xs italic">
                    {t('kanban.emptyColumn')}
                  </div>
                )}
                {renderDropSlot()}
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
      {kanbanMultiRow && <div aria-hidden data-kb-scroll="" style={{ height: KANBAN_BAR_SPACER }} />}
    </div>
  );
}
