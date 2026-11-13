import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SharedImportToast } from '../SharedImportToast';
import { api } from '../../lib/api';
import { SharedList } from '../../lib/types';

const list = (id: string, title: string, role: string, isOwner = false): SharedList => ({
  id, title, icon: '🛒', listType: 'shopping', isOwner, role, items: [],
  createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T10:00:00Z',
});

describe('SharedImportToast (after sharing into MindSift)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends every shared entry on as a task', async () => {
    const spy = vi.spyOn(api, 'triageAction').mockResolvedValue({} as Awaited<ReturnType<typeof api.triageAction>>);
    const onConverted = vi.fn();
    render(<SharedImportToast thoughtIds={['th_1', 'th_2']} lists={[]} onClose={() => {}} onConverted={onConverted} />);
    expect(screen.getByText('2 Einträge im Quick Dump abgelegt')).toBeTruthy();
    expect(screen.queryByText('Liste')).toBeNull(); // no writable list, no list button
    fireEvent.click(screen.getByText('Aufgabe'));
    await waitFor(() => expect(onConverted).toHaveBeenCalledWith('2 Aufgaben angelegt'));
    expect(spy).toHaveBeenCalledWith('th_1', 'keep', { convertTo: 'task', targetListId: undefined });
    expect(spy).toHaveBeenCalledWith('th_2', 'keep', { convertTo: 'task', targetListId: undefined });
  });

  it('puts it straight onto the only writable list', async () => {
    const spy = vi.spyOn(api, 'triageAction').mockResolvedValue({} as Awaited<ReturnType<typeof api.triageAction>>);
    const onConverted = vi.fn();
    render(
      <SharedImportToast
        thoughtIds={['th_1']}
        lists={[list('l1', 'Wocheneinkauf', 'owner', true), list('l2', 'WG-Archiv', 'viewer')]}
        onClose={() => {}}
        onConverted={onConverted}
      />
    );
    fireEvent.click(screen.getByText('Liste'));
    await waitFor(() => expect(onConverted).toHaveBeenCalledWith('Eintrag auf „Wocheneinkauf“'));
    expect(spy).toHaveBeenCalledWith('th_1', 'keep', { convertTo: 'list_item', targetListId: 'l1' });
  });

  it('lets you pick among several lists, read-only ones left out', async () => {
    const spy = vi.spyOn(api, 'triageAction').mockResolvedValue({} as Awaited<ReturnType<typeof api.triageAction>>);
    render(
      <SharedImportToast
        thoughtIds={['th_1']}
        lists={[list('l1', 'Wocheneinkauf', 'owner', true), list('l2', 'Baumarkt', 'editor'), list('l3', 'WG-Archiv', 'viewer')]}
        onClose={() => {}}
        onConverted={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Liste'));
    expect(screen.queryByText('WG-Archiv')).toBeNull();
    fireEvent.click(screen.getByText('Baumarkt'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('th_1', 'keep', { convertTo: 'list_item', targetListId: 'l2' }));
  });
});
