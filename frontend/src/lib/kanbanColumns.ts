import { KanbanColumn, TaskList, Thought } from './types';

// Which Kanban column a task belongs to, and which columns a board shows. Pure functions, used by
// TasksView; in "Alle Aufgaben" the columns of all lists are joined by name.

const hasColumns = (cols: KanbanColumn[] | undefined): cols is KanbanColumn[] => Array.isArray(cols) && cols.length > 0;

// Columns of the chosen task list, else the personal ones (global, or default)
export function activeColumnsFor(list: TaskList | undefined, globalColumns: KanbanColumn[]): KanbanColumn[] {
  return list && hasColumns(list.columns) ? list.columns : globalColumns;
}

// The columns of the list a task belongs to: in "Alle Aufgaben" every task keeps its own list's columns
export function columnsOfTask(task: Thought, lists: TaskList[], fallback: KanbanColumn[]): KanbanColumn[] {
  const own = lists.find((l) => l.id === task.taskListId)?.columns;
  return hasColumns(own) ? own : fallback;
}

// The column of its own list a task stands in; a status whose column is gone counts as the first open one
export function ownColumnIn(task: Thought, cols: KanbanColumn[]): KanbanColumn | undefined {
  if (task.isCompleted) return cols.find((c) => c.isDone && c.id === task.kanbanStatus) || cols.find((c) => c.isDone);
  return cols.find((c) => c.id === task.kanbanStatus) || cols.find((c) => c.id === 'todo') || cols.find((c) => !c.isDone);
}

// Board ID of a column: on the combined board the name (case aside), else the column's own ID
export const columnNameId = (col: KanbanColumn) => `name:${col.name.trim().toLowerCase()}`;
export const boardIdOfColumn = (col: KanbanColumn, combined: boolean) => (combined ? columnNameId(col) : col.id);

// Board columns of "Alle Aufgaben": the columns of all lists joined by name, in the order and colour of the
// first list that has them; personal tasks bring the global columns. Their IDs are "name:…".
export function combinedBoardColumns(lists: TaskList[], globalColumns: KanbanColumn[]): KanbanColumn[] {
  const out: KanbanColumn[] = [];
  const sources = [...lists.map((l) => (hasColumns(l.columns) ? l.columns : globalColumns)), globalColumns];
  for (const cols of sources) {
    cols.forEach((col, i) => {
      const id = columnNameId(col);
      if (out.some((c) => c.id === id)) return;
      // A new column goes right before the next column of its list that is already on the board
      const next = cols.slice(i + 1).map((c) => out.findIndex((o) => o.id === columnNameId(c))).find((at) => at >= 0);
      out.splice(next ?? out.length, 0, { ...col, id });
    });
  }
  return out;
}
