import type { Document, Thought } from '../lib/types';

// Shared test data: a note and a task with everything a test does not care about filled in

/** Lets pending promises and timers of 0 ms run. */
export const flush = () => new Promise((r) => setTimeout(r, 0));

export const makeDoc = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc_1',
  userId: 'u1',
  title: 'Notiz',
  icon: '📝',
  folderPath: '',
  content: '',
  blocks: [],
  tags: [],
  isPinned: false,
  isArchived: false,
  createdAt: '2026-10-29T10:00:00Z',
  updatedAt: '2026-10-29T10:00:00Z',
  ...overrides,
});

export const makeTask = (id: string, overrides: Partial<Thought> = {}): Thought =>
  ({ id, content: id, status: 'kept', isCompleted: false, priority: 'normal', createdAt: '2026-01-01T00:00:00Z', ...overrides }) as Thought;
