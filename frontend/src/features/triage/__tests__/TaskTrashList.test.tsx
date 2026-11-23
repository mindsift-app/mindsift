import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { TrashedTask } from '../../../lib/types';

const askConfirm = vi.hoisted(() => vi.fn());
vi.mock('../../../components/askConfirm', () => ({ askConfirm }));

import { TaskTrashList } from '../TaskTrashList';

const task = (over: Partial<TrashedTask>): TrashedTask =>
  ({ id: 'th_1', content: 'Steuer', isCompleted: false, trashedAt: '2026-11-20T08:00:00Z', trashedBy: 'Anna', canEdit: true, ...over }) as TrashedTask;

describe('TaskTrashList', () => {
  beforeEach(() => askConfirm.mockReset());

  it('asks before deleting a task for good (it used to go at once)', async () => {
    const onPurge = vi.fn();
    render(<TaskTrashList items={[task({})]} lists={[]} showList={false} onRestore={vi.fn()} onPurge={onPurge} />);
    askConfirm.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    });
    expect(onPurge).not.toHaveBeenCalled();
    askConfirm.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    });
    expect(onPurge).toHaveBeenCalledWith(expect.objectContaining({ id: 'th_1' }));
  });

  it('restores at once and hides the buttons of tasks one may not change', async () => {
    const onRestore = vi.fn();
    render(
      <TaskTrashList
        items={[task({}), task({ id: 'th_2', content: 'Fremd', canEdit: false })]}
        lists={[]}
        showList
        onRestore={onRestore}
        onPurge={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Wiederherstellen/ })).toHaveLength(1);
    expect(screen.getAllByText(/Persönlich ·/)).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Wiederherstellen/ }));
    });
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'th_1' }));
  });
});
