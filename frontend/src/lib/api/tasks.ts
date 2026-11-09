// REST calls: Capture, thoughts, triage, tasks, task trash and task lists
import { TrashedTask, KanbanColumn, PriorityLevel, TaskList, TaskListShare, Thought, SubTask } from '../types';
import { extractHashtags } from '../hashtags';
import { OfflineError, enqueue, flushOutbox } from '../offline';
import { getToken, getCurrentUserId, ensureArray, request, sendOutboxEntry } from './client';

export const tasksApi = {
  // --- INSTANT CAPTURE & OFFLINE SYNC ---
  async captureThought(
    content: string,
    priority: PriorityLevel = 'normal',
    source: 'manual' | 'voice' = 'manual',
    dueDate = '',
    options?: {
      target?: 'inbox' | 'task' | 'list_item' | 'document';
      targetListId?: string;
      taskListId?: string;
    }
  ): Promise<Thought> {
    const body = {
      content,
      priority,
      source,
      dueDate,
      target: options?.target || 'inbox',
      targetListId: options?.targetListId || '',
      taskListId: options?.taskListId || '',
    };
    try {
      return await request<Thought>('/api/v1/inbox', { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      // Kept in the outbox and sent when the connection is back
      const entry = enqueue('POST', '/api/v1/inbox', body);
      return {
        id: `th_offline_${entry.id}`,
        userId: getCurrentUserId() || 'offline',
        content,
        tags: Array.from(new Set(extractHashtags(content))),
        priority,
        source,
        status: 'inbox',
        isCompleted: false,
        dueDate,
        taskListId: options?.taskListId || '',
        createdAt: entry.createdAt,
      };
    }
  },

  /** Sends what was captured or checked off while offline; returns how many changes went through. */
  async flushOfflineQueue(): Promise<number> {
    if (!getToken()) return 0;
    return flushOutbox(sendOutboxEntry);
  },

  // --- THOUGHTS, TRIAGE & TASKS ---
  async getTriageDeck(): Promise<Thought[]> {
    const res = await request<Thought[]>('/api/v1/triage/deck');
    return ensureArray(res);
  },

  async getThoughts(status = 'all'): Promise<Thought[]> {
    const res = await request<Thought[]>(`/api/v1/thoughts?status=${encodeURIComponent(status)}`);
    return ensureArray(res);
  },

  async getThought(thoughtId: string): Promise<Thought> {
    return request<Thought>(`/api/v1/thoughts/${encodeURIComponent(thoughtId)}`);
  },

  async triageAction(
    thoughtId: string,
    action: 'keep' | 'discard' | 'restore',
    options?: {
      convertTo?: 'task' | 'document' | 'list_item';
      targetListId?: string;
      taskListId?: string;
      dueDate?: string;
    }
  ): Promise<Thought> {
    return request<Thought>(`/api/v1/triage/${thoughtId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action,
        convertTo: options?.convertTo || '',
        targetListId: options?.targetListId || '',
        taskListId: options?.taskListId || '',
        dueDate: options?.dueDate || '',
      }),
    });
  },

  async getTasks(taskListId?: string): Promise<Thought[]> {
    const query = taskListId ? `?taskListId=${encodeURIComponent(taskListId)}` : '';
    const res = await request<Thought[]>(`/api/v1/tasks${query}`);
    return ensureArray(res);
  },

  async watchTask(taskId: string): Promise<{ watching: boolean }> {
    return request<{ watching: boolean }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/watch`, {
      method: 'POST',
    });
  },

  async unwatchTask(taskId: string): Promise<{ watching: boolean }> {
    return request<{ watching: boolean }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/watch`, {
      method: 'DELETE',
    });
  },

  async reorderTasks(items: { id: string; sortOrder: number; kanbanStatus?: string }[], taskListId?: string): Promise<{ success: boolean }> {
    const url = taskListId ? `/api/v1/task-lists/${taskListId}/tasks/reorder` : '/api/v1/tasks/reorder';
    return request<{ success: boolean }>(url, {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  },

  async updateThought(
    thoughtId: string,
    patch: {
      content?: string;
      isCompleted?: boolean;
      dueDate?: string;
      priority?: string;
      taskListId?: string;
      kanbanStatus?: string;
      notes?: string;
      subtasks?: SubTask[];
      tags?: string[];
      assignees?: string[];
      recurrence?: string;
    }
  ): Promise<Thought> {
    try {
      return await request<Thought>(`/api/v1/thoughts/${thoughtId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    } catch (err) {
      // Checking a task off (or on) also works offline; other edits need the server
      const onlyStatus = Object.keys(patch).every((k) => k === 'isCompleted' || k === 'kanbanStatus');
      if (!(err instanceof OfflineError) || !onlyStatus) throw err;
      enqueue('PATCH', `/api/v1/thoughts/${thoughtId}`, patch);
      return { id: thoughtId, ...patch } as Thought;
    }
  },

  async deleteThought(thoughtId: string): Promise<void> {
    await request(`/api/v1/thoughts/${thoughtId}`, { method: 'DELETE' });
  },

  // "Erledigte leeren": completed tasks of one task list ('' = all the user may edit)
  async clearDoneTasks(taskListId: string): Promise<{ deleted: number }> {
    return request<{ deleted: number }>('/api/v1/tasks/clear-done', { method: 'POST', body: JSON.stringify({ taskListId }) });
  },

  // Task trash: deleted tasks, cleared and automatically cleaned-up completed ones
  async getTaskTrash(taskListId = ''): Promise<TrashedTask[]> {
    const q = taskListId ? `?taskListId=${encodeURIComponent(taskListId)}` : '';
    return request<TrashedTask[]>(`/api/v1/tasks/trash${q}`);
  },

  async restoreTrashedTask(id: string): Promise<Thought> {
    return request<Thought>(`/api/v1/tasks/trash/${id}/restore`, { method: 'POST' });
  },

  async purgeTrashedTask(id: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/v1/tasks/trash/${id}`, { method: 'DELETE' });
  },

  async emptyTaskTrash(taskListId: string): Promise<{ deleted: number }> {
    return request<{ deleted: number }>('/api/v1/tasks/trash/empty', { method: 'POST', body: JSON.stringify({ taskListId }) });
  },

  async purgeDiscarded(): Promise<{ purged: number }> {
    return request<{ purged: number }>('/api/v1/thoughts/discarded/purge', { method: 'DELETE' });
  },

  // --- TASK LISTS ---
  async getTaskLists(): Promise<TaskList[]> {
    const res = await request<TaskList[]>('/api/v1/task-lists');
    return ensureArray(res).map((tl) => ({
      ...tl,
      members: ensureArray(tl.members),
      shares: ensureArray(tl.shares),
      columns: ensureArray(tl.columns),
    }));
  },

  // The person's own order of the task list tabs
  async setTaskListOrder(ids: string[]): Promise<void> {
    await request('/api/v1/task-lists/order', { method: 'PUT', body: JSON.stringify({ ids }) });
  },

  async createTaskList(payload: {
    title: string;
    icon?: string;
    color?: string;
    teamId?: string;
    spaceId?: string;
    columns?: KanbanColumn[];
  }): Promise<TaskList> {
    return request<TaskList>('/api/v1/task-lists', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateTaskList(
    id: string,
    patch: {
      title?: string;
      icon?: string;
      color?: string;
      teamId?: string;
      spaceId?: string;
      columns?: KanbanColumn[];
    }
  ): Promise<TaskList> {
    return request<TaskList>(`/api/v1/task-lists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  // Mutes a shared task list for me (no list-wide notifications) or unmutes it
  async muteTaskList(id: string, muted: boolean): Promise<void> {
    await request(`/api/v1/task-lists/${id}/mute`, { method: muted ? 'PUT' : 'DELETE' });
  },

  async deleteTaskList(id: string): Promise<void> {
    await request(`/api/v1/task-lists/${id}`, { method: 'DELETE' });
  },

  async getTaskListShares(id: string): Promise<TaskListShare[]> {
    const res = await request<TaskListShare[]>(`/api/v1/task-lists/${id}/shares`);
    return ensureArray(res);
  },

  async addTaskListShare(
    id: string,
    payload: { targetType: 'team' | 'user'; targetId: string; permission?: 'editor' | 'viewer' }
  ): Promise<TaskListShare> {
    return request<TaskListShare>(`/api/v1/task-lists/${id}/shares`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async removeTaskListShare(id: string, shareId: string): Promise<void> {
    await request(`/api/v1/task-lists/${id}/shares/${shareId}`, { method: 'DELETE' });
  },
};
