import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceView } from '../WorkspaceView';
import { api } from '../../../lib/api';
import { Document } from '../../../lib/types';
import { makeDoc } from '../../../test/fixtures';

vi.mock('../DocumentEditor', () => ({
  DocumentEditor: () => <div data-testid="document-editor">DocumentEditor</div>,
}));

vi.mock('../../../lib/api', async (original) =>
  (await import('../../../test/apiMock')).withApi(
    original,
    {
      getDocuments: vi.fn(),
      getDocumentTodos: vi.fn(),
      getFolders: vi.fn(),
      getSharedFolders: vi.fn(),
      getWorkspaceTags: vi.fn(),
      getTrash: vi.fn(),
      deleteDocument: vi.fn(),
    },
    { triggerHaptic: vi.fn() }
  )
);

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

  it('counts hashtags and open to-dos from the note list and fetches the to-dos for the collection', async () => {
    // The note list brings no bullets, only the counts per note
    const docs: Document[] = [
      makeDoc({ id: 'doc_a', title: 'Einkauf', openTodos: 2, tagCounts: { einkauf: 3 }, tagOpenTodos: { einkauf: 2 } }),
      makeDoc({ id: 'doc_b', title: 'Haus', folderPath: 'Privat', tagCounts: { haus: 1, einkauf: 1 } }),
    ];
    vi.mocked(api.getDocuments).mockResolvedValue(docs);
    vi.mocked(api.getFolders).mockResolvedValue(['Privat']);
    vi.mocked(api.getDocumentTodos).mockResolvedValue([
      { docId: 'doc_a', blockId: 'a1', content: 'Milch kaufen', checked: false },
      { docId: 'doc_a', blockId: 'a2', content: 'Brot kaufen', checked: false },
    ]);

    render(<WorkspaceView onStatsChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('#einkauf')).toBeTruthy();
    });
    expect(screen.getByText('#einkauf').nextElementSibling?.textContent).toBe('4');
    expect(screen.getByText('#haus').nextElementSibling?.textContent).toBe('1');
    expect(api.getDocumentTodos).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /To-Dos/ }));
    await waitFor(() => {
      expect(screen.getByText('Milch kaufen')).toBeTruthy();
    });
    expect(api.getDocumentTodos).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Brot kaufen')).toBeTruthy();
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
  it('note rows have a delete button for own notes that asks before the note goes to the trash', async () => {
    vi.mocked(api.getDocuments).mockResolvedValue([
      makeDoc({ id: 'doc_own', title: 'Eigene Notiz', isOwner: true }),
      makeDoc({ id: 'doc_shared', title: 'Geteilte Notiz', isOwner: false, permission: 'write' }),
    ]);
    vi.mocked(api.deleteDocument).mockResolvedValue(undefined as never);

    render(<WorkspaceView onStatsChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Geteilte Notiz')).toBeTruthy());

    const own = screen.getByText('Eigene Notiz').closest('[data-doc-row]') as HTMLElement;
    const shared = screen.getByText('Geteilte Notiz').closest('[data-doc-row]') as HTMLElement;
    // Only notes the person may delete, like "Notiz löschen" in the note's menu
    expect(shared.querySelector('button[aria-label="Notiz löschen"]')).toBeNull();
    fireEvent.click(own.querySelector('button[aria-label="Notiz löschen"]') as HTMLElement, { clientX: 40, clientY: 80 });

    // A confirmation, no browser dialog; the click does not open the note
    expect(screen.getByText('In den Papierkorb legen?')).toBeTruthy();
    expect(api.deleteDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'In den Papierkorb' }));
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('doc_own'));
    await waitFor(() => expect(screen.queryByText('Eigene Notiz')).toBeNull());
  });

  describe('hashtag filter of the tree', () => {
    const filterDocs = () => [
      makeDoc({ id: 'doc_haus', title: 'Hausplan', tagCounts: { haus: 1 } }),
      makeDoc({ id: 'doc_beide', title: 'Gartenhaus', folderPath: 'Privat/Garten', tagCounts: { haus: 2, garten: 1 } }),
      makeDoc({ id: 'doc_garten', title: 'Beete', folderPath: 'Privat', tagCounts: { garten: 1 } }),
      makeDoc({ id: 'doc_arbeit', title: 'Bericht', folderPath: 'Arbeit', tagCounts: { arbeit: 1 } }),
      makeDoc({ id: 'doc_ohne', title: 'Ohne Hashtag' }),
    ];
    const tagButton = (tag: string) => screen.getByText(`#${tag}`).closest('button') as HTMLElement;
    const trashBar = () => screen.getByTitle('Papierkorb – Notizen hierher ziehen, um sie zu löschen').parentElement as HTMLElement;

    beforeEach(() => {
      localStorage.removeItem('mindsift:workspace_expanded_folders');
      vi.mocked(api.getDocuments).mockResolvedValue(filterDocs());
      vi.mocked(api.getFolders).mockResolvedValue(['Privat', 'Privat/Garten', 'Arbeit']);
    });

    it('a click filters the tree by the hashtag and opens the folders with matches; a second click removes it', async () => {
      render(<WorkspaceView onStatsChange={vi.fn()} />);
      await waitFor(() => expect(screen.getByText('#haus')).toBeTruthy());
      // Folders closed, no filter: no reset button, the trash bar unmarked
      expect(screen.queryByText('Gartenhaus')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Hashtag-Filter aufheben' })).toBeNull();
      expect(trashBar().dataset.filterActive).toBeUndefined();
      expect(screen.queryByText('Filter aktiv')).toBeNull();

      fireEvent.click(tagButton('haus'));
      // No tag page: the click only filters
      expect(screen.queryByText('Notizen zu #haus…')).toBeNull();
      expect(tagButton('haus').getAttribute('aria-pressed')).toBe('true');
      expect(tagButton('haus').className).toContain('bg-accent');
      // Matching notes, their folders open; everything else hidden (also on the top level)
      expect(screen.getByText('Hausplan')).toBeTruthy();
      expect(screen.getByText('Gartenhaus')).toBeTruthy();
      expect(screen.getByText('Privat')).toBeTruthy();
      expect(screen.getByText('Garten')).toBeTruthy();
      expect(screen.queryByText('Beete')).toBeNull();
      expect(screen.queryByText('Arbeit')).toBeNull();
      expect(screen.queryByText('Ohne Hashtag')).toBeNull();
      // Filter on: reset button; only the line above the trash turns red, with a label on it (no tint)
      expect(screen.getByRole('button', { name: 'Hashtag-Filter aufheben' })).toBeTruthy();
      expect(trashBar().dataset.filterActive).toBe('true');
      expect(trashBar().className).toContain('border-status-err');
      expect(trashBar().className).not.toContain('bg-status-err');
      expect(screen.getByText('Filter aktiv')).toBeTruthy();

      fireEvent.click(tagButton('haus'));
      expect(tagButton('haus').getAttribute('aria-pressed')).toBe('false');
      expect(screen.getByText('Ohne Hashtag')).toBeTruthy();
      expect(screen.getByText('Arbeit')).toBeTruthy();
      // The folders are as before the filter (closed)
      expect(screen.queryByText('Gartenhaus')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Hashtag-Filter aufheben' })).toBeNull();
      expect(trashBar().dataset.filterActive).toBeUndefined();
    });

    it('several hashtags show only notes carrying all of them; the ✕ resets the filter', async () => {
      render(<WorkspaceView onStatsChange={vi.fn()} />);
      await waitFor(() => expect(screen.getByText('#garten')).toBeTruthy());

      fireEvent.click(tagButton('garten'));
      expect(screen.getByText('Beete')).toBeTruthy();
      expect(screen.getByText('Gartenhaus')).toBeTruthy();
      expect(screen.queryByText('Hausplan')).toBeNull();

      fireEvent.click(tagButton('haus'));
      expect(screen.getByText('Gartenhaus')).toBeTruthy();
      expect(screen.queryByText('Beete')).toBeNull();
      expect(screen.queryByText('Hausplan')).toBeNull();

      // No note with all of them
      fireEvent.click(tagButton('arbeit'));
      expect(screen.getByText('Keine Notiz enthält alle gewählten Hashtags.')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Hashtag-Filter aufheben' }));
      expect(screen.getByText('Hausplan')).toBeTruthy();
      expect(screen.getByText('Ohne Hashtag')).toBeTruthy();
      expect(['haus', 'garten', 'arbeit'].map((tag) => tagButton(tag).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
      expect(screen.queryByRole('button', { name: 'Hashtag-Filter aufheben' })).toBeNull();
      expect(screen.queryByText('Filter aktiv')).toBeNull();
    });
  });
});
