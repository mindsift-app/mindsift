import { describe, expect, it, vi } from 'vitest';
import { MOVE_ECHO_MS, applyMoveAnswer, changedOrder, createMoveTracker } from '../taskMoves';

describe('what a move sends', () => {
  it('only the tasks whose place or column changed', () => {
    const before = [
      { id: 'a', sortOrder: 0, kanbanStatus: 'todo' },
      { id: 'b', sortOrder: 1, kanbanStatus: 'todo' },
      { id: 'c', sortOrder: 2, kanbanStatus: 'in_arbeit' },
      { id: 'd', sortOrder: 3, kanbanStatus: 'in_arbeit' },
    ];
    // c moved to the top of "todo": a and b slide down, d stays
    const after = [
      { id: 'c', sortOrder: 0, kanbanStatus: 'todo' },
      { id: 'a', sortOrder: 1, kanbanStatus: 'todo' },
      { id: 'b', sortOrder: 2, kanbanStatus: 'todo' },
      { id: 'd', sortOrder: 3, kanbanStatus: 'in_arbeit' },
    ];
    expect(changedOrder(before, after).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    // Only the column changed
    expect(changedOrder(before, [{ id: 'd', sortOrder: 3, kanbanStatus: 'erledigt' }])).toHaveLength(1);
    // Nothing changed, a task without a column, or one without a place yet
    expect(changedOrder(before, before)).toEqual([]);
    expect(changedOrder([{ id: 'e' }], [{ id: 'e', sortOrder: 0 }])).toEqual([]);
    expect(changedOrder([], [{ id: 'f', sortOrder: 0 }])).toHaveLength(1);
  });
});

describe('answers and events of moves', () => {
  it('applies the answer of the latest move only', () => {
    const t = createMoveTracker();
    const first = t.begin([{ id: 'a', sortOrder: 1 }]);
    const second = t.begin([{ id: 'a', sortOrder: 2 }]);
    expect(t.settle(first, false)).toEqual({ latest: false, reload: false });
    expect(t.settle(second, false)).toEqual({ latest: true, reload: false });
  });

  it('loads once no move is on its way when one of them asked for it', () => {
    const t = createMoveTracker();
    const first = t.begin([{ id: 'a', sortOrder: 1 }]);
    const second = t.begin([{ id: 'b', sortOrder: 1 }]);
    expect(t.settle(first, true).reload).toBe(false); // the second is still on its way
    expect(t.settle(second, false).reload).toBe(true);
    // Asked once, loaded once
    expect(t.settle(t.begin([{ id: 'c', sortOrder: 0 }]), false).reload).toBe(false);
  });

  it('drops the echo of an own move, applies others, and waits with them while own moves are on their way', () => {
    let now = 1000;
    const t = createMoveTracker(() => now);
    const seq = t.begin([
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
    ]);
    // Own echo (a skipped task left out), before the answer
    expect(t.classify({ userId: 'usr_anna', items: [{ id: 'b', sortOrder: 1 }] }, 'usr_anna')).toBe('echo');
    // Someone else's move meanwhile: not applied now, loaded once the own move is answered
    expect(t.classify({ userId: 'usr_ben', items: [{ id: 'a', sortOrder: 5 }] }, 'usr_anna')).toBe('defer');
    expect(t.settle(seq, false)).toEqual({ latest: true, reload: true });
    // The echo arriving after the answer is still recognised
    expect(t.classify({ userId: 'usr_anna', items: [{ id: 'a', sortOrder: 0 }] }, 'usr_anna')).toBe('echo');
    // Another tab of the same person moving differently, and anything long after, is applied
    expect(t.classify({ userId: 'usr_anna', items: [{ id: 'a', sortOrder: 3 }] }, 'usr_anna')).toBe('apply');
    now += MOVE_ECHO_MS;
    expect(t.classify({ userId: 'usr_anna', items: [{ id: 'a', sortOrder: 0 }] }, 'usr_anna')).toBe('apply');
    expect(t.classify({ userId: 'usr_ben', items: [{ id: 'a', sortOrder: 5 }] }, 'usr_anna')).toBe('apply');
    expect(t.classify(undefined, 'usr_anna')).toBe('apply');
  });

  it('applyMoveAnswer: places of the latest move, only the skipped tasks of an overtaken one', () => {
    const t = createMoveTracker();
    const apply = vi.fn();
    const reload = vi.fn();
    const first = t.begin([{ id: 'a', sortOrder: 1 }]);
    const second = t.begin([{ id: 'a', sortOrder: 2 }]);
    applyMoveAnswer(t, first, { success: true, items: [{ id: 'a', sortOrder: 1 }], skipped: ['x'] }, apply, reload);
    expect(apply).toHaveBeenLastCalledWith([], ['x']);
    applyMoveAnswer(t, second, { success: true, items: [{ id: 'a', sortOrder: 2 }], skipped: [] }, apply, reload);
    expect(apply).toHaveBeenLastCalledWith([{ id: 'a', sortOrder: 2 }], []);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('applyMoveAnswer: a failed call or a new successor loads, after the last move', () => {
    const t = createMoveTracker();
    const apply = vi.fn();
    const reload = vi.fn();
    const first = t.begin([{ id: 'a', sortOrder: 1 }]);
    const second = t.begin([{ id: 'b', sortOrder: 1 }]);
    applyMoveAnswer(t, first, null, apply, reload);
    expect(reload).not.toHaveBeenCalled();
    applyMoveAnswer(t, second, { success: true, items: [{ id: 'b', sortOrder: 1 }] }, apply, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    const third = t.begin([{ id: 'c', sortOrder: 0 }]);
    applyMoveAnswer(t, third, { success: true, items: [], reload: true }, apply, reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
