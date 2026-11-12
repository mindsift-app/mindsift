import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentEditor } from '../DocumentEditor';
import { Document, DocumentBlock } from '../../../lib/types';
import { EngineState } from '../../../lib/docSync/engine';
import { writeNotePlace } from '../../../lib/notePlace';

// A note four levels deep, zoomed into the third level
const blocks: DocumentBlock[] = [
  { id: 'b1', documentId: 'doc_1', type: 'text', content: 'Projektplanung', level: 0, position: 1000 },
  { id: 'b2', documentId: 'doc_1', type: 'text', content: 'Marketing und Kommunikation', level: 1, position: 2000 },
  { id: 'b3', documentId: 'doc_1', type: 'text', content: 'Kampagne in den sozialen Medien', level: 2, position: 3000 },
  { id: 'b4', documentId: 'doc_1', type: 'text', content: 'Beiträge für Instagram', level: 3, position: 4000 },
];

const engineState: EngineState = {
  ready: true,
  status: 'saved',
  role: 'owner',
  title: 'Tiefe Notiz',
  blocks,
  pendingCount: 0,
  shared: false,
  sessions: 1,
  presence: [],
  lockedByOthers: [],
  conflicts: [],
  canUndo: false,
  canRedo: false,
  channel: 'ws',
  noteFull: 0,
};

vi.mock('../../../lib/docSync/engine', () => ({
  DocSyncEngine: class {
    subscribe(fn: (state: EngineState) => void) {
      fn(engineState);
      return () => {};
    }
    start() {
      return Promise.resolve();
    }
    stop() {}
    getState() {
      return engineState;
    }
    setTaskLinks() {}
    focusBlock() {}
    applyFlat() {}
    setTitle() {}
    undo() {
      return { ok: true };
    }
    redo() {
      return { ok: true };
    }
  },
}));

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocument: vi.fn(() => Promise.resolve(doc)),
      getUsersDirectory: vi.fn(() => Promise.resolve([])),
      getDocumentBacklinks: vi.fn(() => Promise.resolve({ backlinks: [] })),
    },
  };
});

const doc: Document = {
  id: 'doc_1',
  userId: 'u1',
  title: 'Tiefe Notiz',
  icon: '📝',
  folderPath: '',
  content: '',
  blocks,
  tags: [],
  isPinned: false,
  isArchived: false,
  isOwner: true,
  createdAt: '2026-11-01T08:00:00Z',
  updatedAt: '2026-11-01T08:00:00Z',
};

const renderEditor = () =>
  render(
    <DocumentEditor
      docId="doc_1"
      initialDoc={doc}
      availableFolders={[]}
      onDocMetadataChange={vi.fn()}
      onDeleteDoc={vi.fn()}
      onOpenShareModal={vi.fn()}
      onSelectTag={vi.fn()}
      onBackMobile={vi.fn()}
    />
  );

const zoomHeading = () => screen.queryByPlaceholderText('Ast-Titel…');

describe('DocumentEditor zoom path on phones', () => {
  const width = window.innerWidth;
  beforeEach(() => {
    localStorage.clear();
    writeNotePlace('doc_1', { zoom: 'b3', scroll: 0 });
  });
  afterEach(() => {
    window.innerWidth = width;
  });

  it('shows a home button instead of the path; it leaves the zoom', async () => {
    window.innerWidth = 400;
    renderEditor();

    await waitFor(() => expect(zoomHeading()).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb Navigation' })).toBeNull();
    // Only the zoomed bullet is named, not the bullets above it
    expect(screen.queryByText('Marketing und Kommunikation')).toBeNull();

    const home = screen.getByRole('button', { name: 'Zurück zum Hauptdokument' });
    fireEvent.click(home);

    await waitFor(() => expect(zoomHeading()).toBeNull());
    expect(screen.queryByRole('button', { name: 'Zurück zum Hauptdokument' })).toBeNull();
  });

  it('keeps the path from sm upwards', async () => {
    window.innerWidth = 800;
    renderEditor();

    await waitFor(() => expect(zoomHeading()).toBeTruthy());
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb Navigation' });
    expect(nav.textContent).toContain('Marketing und Kommunikation');
  });
});
