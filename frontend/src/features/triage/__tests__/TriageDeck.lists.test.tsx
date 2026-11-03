import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TriageDeck } from '../TriageDeck';
import { api } from '../../../lib/api';
import { SharedList, Thought } from '../../../lib/types';

const sampleDeck: Thought[] = [
  {
    id: 'th_1',
    userId: 'u_1',
    content: 'Hafermilch und Kaffeebohnen',
    status: 'inbox',
    priority: 'normal',
    source: 'manual',
    isCompleted: false,
    tags: [],
    createdAt: '2026-10-29T10:00:00Z',
  },
];

const ownList: SharedList = {
  id: 'lst_own',
  title: 'Wocheneinkauf',
  icon: '🛒',
  listType: 'shopping',
  isOwner: true,
  role: 'owner',
  items: [],
  createdAt: '2026-10-29T10:00:00Z',
  updatedAt: '2026-10-29T10:00:00Z',
};

const secondEditableList: SharedList = {
  id: 'lst_edit',
  title: 'Baumarkt',
  icon: '🔨',
  listType: 'checklist',
  isOwner: false,
  role: 'editor',
  items: [],
  createdAt: '2026-10-29T10:00:00Z',
  updatedAt: '2026-10-29T10:00:00Z',
};

const viewerList: SharedList = {
  id: 'lst_view',
  title: 'WG-Archiv',
  icon: '📋',
  listType: 'checklist',
  isOwner: false,
  role: 'viewer',
  items: [],
  createdAt: '2026-10-29T10:00:00Z',
  updatedAt: '2026-10-29T10:00:00Z',
};

describe('TriageDeck single-list shortcut', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'triageAction').mockResolvedValue(sampleDeck[0]);
  });

  it('directly assigns to the single own list without opening the selector', async () => {
    const onDeckChange = vi.fn();

    render(
      <TriageDeck
        deck={sampleDeck}
        lists={[ownList]}
        onDeckChange={onDeckChange}
        onOpenDocument={vi.fn()}
        onFocusCapture={vi.fn()}
        discardedCount={0}
        onOpenTrash={vi.fn()}
      />
    );

    const btn = screen.getByRole('button', { name: /Auf Wocheneinkauf/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(btn);

    await waitFor(() => {
      expect(api.triageAction).toHaveBeenCalledWith('th_1', 'keep', {
        convertTo: 'list_item',
        targetListId: 'lst_own',
        dueDate: undefined,
      });
      expect(onDeckChange).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/Quick Dump direkt einer Liste zuordnen/i)).toBeNull();
  });

  it('opens the list selector when two writable lists exist instead of assigning directly', () => {
    const onDeckChange = vi.fn();

    render(
      <TriageDeck
        deck={sampleDeck}
        lists={[ownList, secondEditableList]}
        onDeckChange={onDeckChange}
        onOpenDocument={vi.fn()}
        onFocusCapture={vi.fn()}
        discardedCount={0}
        onOpenTrash={vi.fn()}
      />
    );

    const btn = screen.getByRole('button', { name: /^Auf Liste$/i });
    fireEvent.click(btn);

    expect(api.triageAction).not.toHaveBeenCalled();
    expect(onDeckChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Quick Dump direkt einer Liste zuordnen/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Wocheneinkauf/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Baumarkt/i })).toBeTruthy();
  });

  it('treats one own list and one viewer-only shared list as a single writable list', async () => {
    const onDeckChange = vi.fn();

    render(
      <TriageDeck
        deck={sampleDeck}
        lists={[viewerList, ownList]}
        onDeckChange={onDeckChange}
        onOpenDocument={vi.fn()}
        onFocusCapture={vi.fn()}
        discardedCount={0}
        onOpenTrash={vi.fn()}
      />
    );

    const btn = screen.getByRole('button', { name: /Auf Wocheneinkauf/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(api.triageAction).toHaveBeenCalledWith('th_1', 'keep', {
        convertTo: 'list_item',
        targetListId: 'lst_own',
        dueDate: undefined,
      });
      expect(onDeckChange).toHaveBeenCalledTimes(1);
    });
  });

  it('disables the list button when no writable list exists', () => {
    const onDeckChange = vi.fn();

    render(
      <TriageDeck
        deck={sampleDeck}
        lists={[viewerList]}
        onDeckChange={onDeckChange}
        onOpenDocument={vi.fn()}
        onFocusCapture={vi.fn()}
        discardedCount={0}
        onOpenTrash={vi.fn()}
      />
    );

    const btn = screen.getByRole('button', { name: /^Auf Liste$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Keine Liste vorhanden');

    fireEvent.click(btn);
    expect(api.triageAction).not.toHaveBeenCalled();
    expect(onDeckChange).not.toHaveBeenCalled();
  });

  it('renders mobile quick action buttons and triggers discard', async () => {
    const onDeckChange = vi.fn();

    render(
      <TriageDeck
        deck={sampleDeck}
        lists={[ownList]}
        onDeckChange={onDeckChange}
        onOpenDocument={vi.fn()}
        onFocusCapture={vi.fn()}
        discardedCount={0}
        onOpenTrash={vi.fn()}
      />
    );

    const [mobileDiscard] = screen.getAllByRole('button', { name: /^Wegwerfen$/i });
    fireEvent.click(mobileDiscard);

    await waitFor(() => {
      expect(api.triageAction).toHaveBeenCalledWith('th_1', 'discard', expect.objectContaining({}));
      expect(onDeckChange).toHaveBeenCalledTimes(1);
    });
  });
});
