// Tasks: thoughts and tasks, subtasks, repeat rules, task lists with their board, members and shares, the task trash.

import i18n from '../../i18n';

export type ThoughtStatus = 'inbox' | 'kept' | 'discarded' | 'converted';

export type PriorityLevel = 'low' | 'normal' | 'high' | 'urgent';

export interface SubTask {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt?: string;
  // Note checkbox this subtask is tied to (its task is linked to a note); kept by the server
  blockId?: string;
}

// Repeat rule of a task: completing it creates the next one (due date in the rhythm of the old one, after the day it was done)
export type Recurrence = '' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

// Texts in common:recurrence.<rule>, in the language shown when read
export const RECURRENCE_LABELS: Record<Exclude<Recurrence, ''>, string> = {
  get daily() {
    return i18n.t('common:recurrence.daily');
  },
  get weekdays() {
    return i18n.t('common:recurrence.weekdays');
  },
  get weekly() {
    return i18n.t('common:recurrence.weekly');
  },
  get monthly() {
    return i18n.t('common:recurrence.monthly');
  },
  get yearly() {
    return i18n.t('common:recurrence.yearly');
  },
};

// Which API key created an entry and which one changed it last, over which access (REST "api" or
// "mcp"). Stays for good; key names come resolved from the server.
export interface Origin {
  createdVia?: 'api' | 'mcp';
  createdKey?: string;
  changedVia?: 'api' | 'mcp';
  changedKey?: string;
  changedAt?: string;
  // The key was deleted since
  createdKeyDeleted?: boolean;
  changedKeyDeleted?: boolean;
}

export interface Thought {
  id: string;
  userId: string;
  content: string;
  tags: string[];
  priority: PriorityLevel;
  source: 'manual' | 'voice' | 'webhook' | 'agent';
  status: ThoughtStatus;
  isCompleted: boolean;
  convertedType?: 'task' | 'document' | 'list_item' | 'document_block';
  convertedRefId?: string;
  docId?: string;
  blockId?: string;
  dueDate?: string;
  taskListId?: string;
  kanbanStatus?: string;
  notes?: string;
  subtasks?: SubTask[];
  assignees?: string[]; // user IDs, only people with access to the task list
  recurrence?: Recurrence;
  // Minutes before the due date, replacing each person's lead time; empty = the lead time
  reminders?: number[];
  isWatching?: boolean;
  alarmSent?: boolean;
  sortOrder?: number;
  createdAt: string;
  triagedAt?: string;
  origin?: Origin;
}

export interface KanbanColumn {
  id: string;
  name: string;
  color?: string;
  isDone?: boolean;
}

// A task's place after a move, as the server stored it (answer of the reorder call and TASK_REORDERED)
export interface TaskOrder {
  id: string;
  sortOrder: number;
  kanbanStatus?: string;
  isCompleted?: boolean;
}

// Answer of the reorder call: the places applied, the IDs left out (deleted or no longer in the list) and
// whether a repeating task got a successor the answer does not contain
export interface TaskReorderResult {
  success: boolean;
  items?: TaskOrder[];
  skipped?: string[];
  reload?: boolean;
}

export interface TaskListShare {
  id: string;
  taskListId: string;
  targetType: 'team' | 'user';
  targetId: string;
  targetName?: string;
  email?: string;
  avatarUrl?: string;
  permission?: 'editor' | 'viewer';
  createdAt: string;
}

export interface TaskListMember {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  role: string;
}

export interface TaskList {
  id: string;
  userId: string;
  spaceId?: string;
  spaceName?: string;
  ownerId?: string;
  ownerName?: string;
  isOwner?: boolean;
  permission?: 'owner' | 'editor' | 'viewer';
  // I muted this shared list (no list-wide notifications from it)
  isMuted?: boolean;
  members?: TaskListMember[];
  shares?: TaskListShare[];
  columns?: KanbanColumn[];
  title: string;
  icon: string;
  color: string;
  tasksCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** A deleted task waiting in the task trash. */
export interface TrashedTask {
  id: string;
  content: string;
  taskListId: string;
  isCompleted: boolean;
  trashedAt: string;
  trashedBy: string;
  canEdit: boolean;
}
