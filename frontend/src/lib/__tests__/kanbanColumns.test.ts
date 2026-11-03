import { describe, it, expect } from 'vitest';
import { KanbanColumn, TaskList, Thought } from '../types';
import { activeColumnsFor, boardIdOfColumn, columnsOfTask, combinedBoardColumns, ownColumnIn } from '../kanbanColumns';

const col = (id: string, name: string, extra: Partial<KanbanColumn> = {}): KanbanColumn => ({ id, name, ...extra });
const STD = [col('todo', 'Zu erledigen'), col('in_progress', 'In Bearbeitung'), col('done', 'Erledigt', { isDone: true })];
const list = (id: string, columns?: KanbanColumn[]) => ({ id, title: id, columns }) as TaskList;
const task = (t: Partial<Thought>) => ({ id: 't', isCompleted: false, ...t }) as Thought;

describe('kanban columns', () => {
  it('uses the list columns, else the personal ones', () => {
    const own = [col('a', 'A')];
    expect(activeColumnsFor(list('l', own), STD)).toBe(own);
    expect(activeColumnsFor(list('l', []), STD)).toBe(STD);
    expect(activeColumnsFor(undefined, STD)).toBe(STD);
  });

  it('gives a task the columns of its own list', () => {
    const own = [col('x', 'X')];
    const lists = [list('l1', own), list('l2')];
    expect(columnsOfTask(task({ taskListId: 'l1' }), lists, STD)).toBe(own);
    expect(columnsOfTask(task({ taskListId: 'l2' }), lists, STD)).toBe(STD);
    expect(columnsOfTask(task({}), lists, STD)).toBe(STD);
  });

  it('places open and completed tasks, with fallbacks for gone columns', () => {
    expect(ownColumnIn(task({ kanbanStatus: 'in_progress' }), STD)?.id).toBe('in_progress');
    expect(ownColumnIn(task({ kanbanStatus: 'gone' }), STD)?.id).toBe('todo');
    expect(ownColumnIn(task({ kanbanStatus: 'gone' }), [col('w', 'Wartet'), STD[2]])?.id).toBe('w');
    const twoDone = [...STD, col('archiv', 'Archiv', { isDone: true })];
    expect(ownColumnIn(task({ isCompleted: true, kanbanStatus: 'archiv' }), twoDone)?.id).toBe('archiv');
    expect(ownColumnIn(task({ isCompleted: true, kanbanStatus: 'todo' }), twoDone)?.id).toBe('done');
  });

  it('board IDs are names on the combined board only', () => {
    expect(boardIdOfColumn(col('todo', ' Zu Erledigen '), false)).toBe('todo');
    expect(boardIdOfColumn(col('todo', ' Zu Erledigen '), true)).toBe('name:zu erledigen');
  });

  it('joins columns of all lists by name, keeping order and the first colour', () => {
    const a = list('a', [col('todo', 'Zu erledigen', { color: 'slate' }), col('review', 'Zur Prüfung', { color: 'violet' }), col('done', 'Erledigt', { isDone: true })]);
    const b = list('b', [col('t2', 'zu ERLEDIGEN', { color: 'red' }), col('wait', 'Wartet'), col('d2', 'Erledigt', { isDone: true })]);
    const board = combinedBoardColumns([a, b], STD);
    expect(board.map((c) => c.id)).toEqual([
      'name:zu erledigen',
      'name:zur prüfung',
      'name:wartet', // b's new column lands before its next column already on the board (Erledigt)
      'name:in bearbeitung', // from the personal columns, before Erledigt as well
      'name:erledigt',
    ]);
    expect(board[0].color).toBe('slate');
  });
});
