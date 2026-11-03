import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WorkspaceView } from '../WorkspaceView';
import { api } from '../../../lib/api';
import { Document } from '../../../lib/types';

vi.mock('../DocumentEditor', () => ({
  DocumentEditor: () => <div data-testid="document-editor">DocumentEditor</div>,
}));

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocuments: vi.fn(),
      getFolders: vi.fn(),
      getSharedFolders: vi.fn(),
      getWorkspaceTags: vi.fn(),
      getTrash: vi.fn(),
    },
    onWebSocketMessage: vi.fn(() => () => {}),
    triggerHaptic: vi.fn(),
  };
});

const makeDoc = (overrides: Partial<Document> & { id: string; title: string }): Document => ({
  id: overrides.id,
  userId: 'u1',
  title: overrides.title,
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

describe('WorkspaceView sidebar explorer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(api.getFolders).mockResolvedValue([]);
    vi.mocked(api.getSharedFolders).mockResolvedValue([]);
    vi.mocked(api.getWorkspaceTags).mockResolvedValue([]);
    vi.mocked(api.getTrash).mockResolvedValue([]);
  });

  it('renders empty state "Noch keine Notizen" when there are no notes and no folders', async () => {
    vi.mocked(api.getDocuments).mockResolvedValue([]);
    vi.mocked(api.getFolders).mockResolvedValue([]);

    render(<WorkspaceView onStatsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Noch keine Notizen')).toBeTruthy();
    });

    expect(screen.queryByText('Angeheftet')).toBeNull();
    expect(screen.queryByText('Ordner')).toBeNull();
    expect(screen.queryByText('Notizen (Hauptebene)')).toBeNull();
    expect(screen.queryByText('Keine Notizen auf der Hauptebene.')).toBeNull();
  });

  it('renders pinned docs, folders, and root docs without headings', async () => {
    const docs: Document[] = [
      makeDoc({
        id: 'doc_pin_root',
        title: 'Wichtige Pinned Notiz',
        icon: '⭐',
        isPinned: true,
      }),
      makeDoc({
        id: 'doc_root',
        title: 'Normale Root Notiz',
        icon: '📝',
      }),
      makeDoc({
        id: 'doc_in_folder',
        title: 'Projekt Plan',
        icon: '📄',
        folderPath: 'Projekte',
      }),
    ];

    vi.mocked(api.getDocuments).mockResolvedValue(docs);
    vi.mocked(api.getFolders).mockResolvedValue(['Projekte']);

    render(<WorkspaceView onStatsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Wichtige Pinned Notiz')).toBeTruthy();
      expect(screen.getByText('Normale Root Notiz')).toBeTruthy();
      expect(screen.getByText('Projekte')).toBeTruthy();
    });

    // Ensure no old headings are rendered
    expect(screen.queryByText('Angeheftet')).toBeNull();
    expect(screen.queryByText('Ordner')).toBeNull();
    expect(screen.queryByText('Notizen (Hauptebene)')).toBeNull();
    expect(screen.queryByText('Keine Notizen auf der Hauptebene.')).toBeNull();

    // The pinned root doc appears only once
    const pinnedMatches = screen.getAllByText('Wichtige Pinned Notiz');
    expect(pinnedMatches.length).toBe(1);

    // Pinned container has separator when items follow
    const pinnedItem = screen.getByText('Wichtige Pinned Notiz').closest('div[draggable="true"]');
    const pinnedContainer = pinnedItem?.parentElement;
    expect(pinnedContainer?.className).toContain('border-b border-border pb-1.5 mb-1.5');
  });

  it('does not render separator under pinned notes when nothing follows', async () => {
    const docs: Document[] = [
      makeDoc({
        id: 'doc_pin_only',
        title: 'Einzige Notiz Pinned',
        icon: '⭐',
        isPinned: true,
      }),
    ];

    vi.mocked(api.getDocuments).mockResolvedValue(docs);
    vi.mocked(api.getFolders).mockResolvedValue([]);

    render(<WorkspaceView onStatsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Einzige Notiz Pinned')).toBeTruthy();
    });

    const pinnedItem = screen.getByText('Einzige Notiz Pinned').closest('div[draggable="true"]');
    const pinnedContainer = pinnedItem?.parentElement;
    expect(pinnedContainer?.className).not.toContain('border-b');
  });

  it('keeps pinned note in folder visible in its folder', async () => {
    const docs: Document[] = [
      makeDoc({
        id: 'doc_pin_in_folder',
        title: 'Pinned im Ordner',
        icon: '📌',
        folderPath: 'Team',
        isPinned: true,
      }),
    ];

    vi.mocked(api.getDocuments).mockResolvedValue(docs);
    vi.mocked(api.getFolders).mockResolvedValue(['Team']);

    render(<WorkspaceView onStatsChange={vi.fn()} />);

    await waitFor(() => {
      // In pinned list
      expect(screen.getByText('Pinned im Ordner')).toBeTruthy();
      // Folder exists
      expect(screen.getByText('Team')).toBeTruthy();
    });
  });
});
