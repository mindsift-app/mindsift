import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentEditor } from '../DocumentEditor';
import { api } from '../../../lib/api';
import { Document } from '../../../lib/types';
import { EngineState } from '../../../lib/docSync/engine';

let currentListener: ((state: EngineState) => void) | null = null;
const mockUndo = vi.fn(() => ({ ok: true }));
const mockRedo = vi.fn(() => ({ ok: true }));

const baseEngineState: EngineState = {
  ready: true,
  status: 'saved',
  role: 'owner',
  title: 'Test Notiz',
  blocks: [{ id: 'b1', documentId: 'doc_1', type: 'text', content: 'Hallo', level: 0, position: 1000 }],
  pendingCount: 0,
  shared: true,
  sessions: 2,
  presence: [{ userId: 'u2', name: 'Bob' }],
  lockedByOthers: [],
  conflicts: [],
  canUndo: false,
  canRedo: false,
  channel: 'ws',
};

vi.mock('../../../lib/docSync/engine', () => {
  return {
    DocSyncEngine: class {
      subscribe(fn: (state: EngineState) => void) {
        currentListener = fn;
        fn(baseEngineState);
        return () => {
          currentListener = null;
        };
      }
      start() {
        return Promise.resolve();
      }
      stop() {}
      getState() {
        return baseEngineState;
      }
      setTaskLinks() {}
      focusBlock() {}
      applyFlat() {}
      setTitle() {}
      undo() {
        return mockUndo();
      }
      redo() {
        return mockRedo();
      }
    },
  };
});

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocument: vi.fn(),
      getUsersDirectory: vi.fn(() => Promise.resolve([])),
      getDocumentBacklinks: vi.fn(() => Promise.resolve({ backlinks: [] })),
    },
  };
});

const makeDoc = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc_1',
  userId: 'u1',
  title: 'Test Notiz',
  icon: '📝',
  folderPath: '',
  content: '',
  blocks: [{ id: 'b1', documentId: 'doc_1', type: 'text', content: 'Hallo', level: 0, position: 1000 }],
  tags: [],
  isPinned: false,
  isArchived: false,
  isOwner: true,
  createdAt: '2026-10-30T08:00:00Z',
  updatedAt: '2026-10-30T08:00:00Z',
  ...overrides,
});

describe('DocumentEditor header actions & status callback (Teil D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const doc = makeDoc();
    vi.mocked(api.getDocument).mockResolvedValue(doc);
  });

  it('reports live/presence status upward via onHeaderStatusChange and renders Undo/Redo + Three-Dots menu', async () => {
    const doc = makeDoc({ isOwner: true });
    const onHeaderStatusChange = vi.fn();
    const onRequestMerge = vi.fn();
    const onDeleteDoc = vi.fn();
    const onOpenShareModal = vi.fn();

    render(
      <DocumentEditor
        docId="doc_1"
        initialDoc={doc}
        availableFolders={[]}
        onDocMetadataChange={vi.fn()}
        onDeleteDoc={onDeleteDoc}
        onOpenShareModal={onOpenShareModal}
        onSelectTag={vi.fn()}
        onRequestMerge={onRequestMerge}
        onHeaderStatusChange={onHeaderStatusChange}
      />
    );

    await waitFor(() => {
      expect(onHeaderStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          showLive: true,
          channel: 'ws',
        })
      );
    });

    // Undo / Redo buttons disabled initially
    const undoBtn = screen.getByTitle('Rückgängig (Strg+Z)') as HTMLButtonElement;
    const redoBtn = screen.getByTitle('Wiederholen (Strg+Y)') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    // Enable Undo & Redo via engine state update
    currentListener?.({ ...baseEngineState, canUndo: true, canRedo: true });
    await waitFor(() => {
      expect(undoBtn.disabled).toBe(false);
      expect(redoBtn.disabled).toBe(false);
    });

    fireEvent.click(undoBtn);
    expect(mockUndo).toHaveBeenCalledTimes(1);
    fireEvent.click(redoBtn);
    expect(mockRedo).toHaveBeenCalledTimes(1);

    // Share button is directly visible
    const shareBtn = screen.getByTitle('Notiz teilen und Berechtigungen');
    fireEvent.click(shareBtn);
    expect(onOpenShareModal).toHaveBeenCalledWith(doc);

    // Three-dots menu opens on click, shows secondary actions, and closes on Escape
    const moreBtn = screen.getByTitle('Weitere Aktionen');
    fireEvent.click(moreBtn);

    expect(screen.getByText('Notiz anheften')).toBeTruthy();
    expect(screen.getByText('Mit anderer Notiz zusammenführen…')).toBeTruthy();
    expect(screen.getByText('Als Markdown (.md) exportieren')).toBeTruthy();
    expect(screen.getByText('Notiz löschen')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Notiz anheften')).toBeNull();
  });
});
