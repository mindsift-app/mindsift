import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceView } from '../WorkspaceView';
import { api } from '../../../lib/api';
import { Document } from '../../../lib/types';
import { formatDate } from '../../../lib/format';

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
      getDocument: vi.fn(),
      createDocument: vi.fn(),
      getDocumentTodos: vi.fn(),
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
  userId: 'u1',
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

describe('Neue Notiz from a template', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(api.getFolders).mockResolvedValue(['Vorlagen']);
    vi.mocked(api.getSharedFolders).mockResolvedValue([]);
    vi.mocked(api.getWorkspaceTags).mockResolvedValue([]);
    vi.mocked(api.getTrash).mockResolvedValue([]);
    vi.mocked(api.createDocument).mockImplementation(async (p) => makeDoc({ id: 'neu', title: p.title, blocks: p.blocks || [] }));
  });

  it('marks templates in the tree and starts the new note with the chosen template', async () => {
    vi.mocked(api.getDocuments).mockResolvedValue([
      makeDoc({ id: 'tpl', title: 'Wochenplan', isTemplate: true }),
      makeDoc({ id: 'other', title: 'Einkauf' }),
    ]);
    vi.mocked(api.getDocument).mockResolvedValue(
      makeDoc({
        id: 'tpl',
        title: 'Wochenplan',
        isTemplate: true,
        blocks: [
          { id: 'w1', type: 'h1', content: '{{titel}} – {{datum}}', level: 0 },
          { id: 'w2', type: 'todo', content: 'Sport', level: 1, checked: true, taskId: 'task_1' },
        ],
      })
    );
    render(<WorkspaceView onStatsChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Einkauf')).toBeTruthy());
    // The template has its quiet mark in the tree, the other note none
    expect(screen.getAllByRole('img', { name: 'Vorlage' })).toHaveLength(1);

    // With templates the desktop asks for name and template first
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Neue Notiz anlegen' }));
    });
    fireEvent.change(screen.getByPlaceholderText(/Name/), { target: { value: 'KW 47' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Vorlage' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Wochenplan/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
    });

    await waitFor(() => expect(api.createDocument).toHaveBeenCalled());
    expect(api.getDocument).toHaveBeenCalledWith('tpl');
    const payload = vi.mocked(api.createDocument).mock.calls[0][0];
    expect(payload.title).toBe('KW 47');
    expect(payload.blocks?.map((b) => [b.type, b.content, b.level, b.checked])).toEqual([
      ['h1', `KW 47 – ${formatDate(new Date())}`, 0, false],
      ['todo', 'Sport', 1, false],
    ]);
    expect(payload.blocks?.[1].taskId).toBeUndefined();
  });

  it('creates at once on the desktop when the person has no templates', async () => {
    vi.mocked(api.getDocuments).mockResolvedValue([makeDoc({ id: 'other', title: 'Einkauf' })]);
    render(<WorkspaceView onStatsChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Einkauf')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Neue Notiz anlegen' }));
    });
    await waitFor(() => expect(api.createDocument).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Vorlage' })).toBeNull();
    expect(api.getDocument).not.toHaveBeenCalled();
  });
});
