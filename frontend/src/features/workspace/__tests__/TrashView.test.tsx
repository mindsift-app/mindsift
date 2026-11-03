import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TrashView } from '../TrashView';

const items = [
  { id: 'doc_1', title: 'Urlaub', icon: '🏔️', folderPath: 'Privat', deletedAt: '2026-10-29T08:00:00Z', isOwner: true },
];

describe('TrashView', () => {
  it('deletes for good only on the second tap', async () => {
    const onPurge = vi.fn(async () => {});
    render(<TrashView items={items} onOpen={vi.fn()} onRestore={vi.fn(async () => {})} onPurge={onPurge} onEmpty={vi.fn(async () => {})} onBackMobile={vi.fn()} />);
    fireEvent.click(screen.getByText('Endgültig löschen'));
    expect(onPurge).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText('Wirklich löschen?'));
    });
    expect(onPurge).toHaveBeenCalledWith(items[0]);
  });

  it('restores with one tap and shows the original folder', async () => {
    const onRestore = vi.fn(async () => {});
    render(<TrashView items={items} onOpen={vi.fn()} onRestore={onRestore} onPurge={vi.fn(async () => {})} onEmpty={vi.fn(async () => {})} onBackMobile={vi.fn()} />);
    expect(screen.getByText('Privat')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Wiederherstellen'));
    });
    expect(onRestore).toHaveBeenCalledWith(items[0]);
  });

  it('shows a deleted folder as one entry with its notes and restores it as a whole', async () => {
    const folder = {
      id: 'tfld_1',
      kind: 'folder' as const,
      title: 'Stadt',
      icon: '',
      folderPath: 'Projekte',
      deletedAt: '2026-10-29T08:00:00Z',
      isOwner: true,
      noteCount: 3,
    };
    const onOpen = vi.fn();
    const onRestore = vi.fn(async () => {});
    render(<TrashView items={[folder]} onOpen={onOpen} onRestore={onRestore} onPurge={vi.fn(async () => {})} onEmpty={vi.fn(async () => {})} onBackMobile={vi.fn()} />);
    expect(screen.getByText('Stadt')).toBeTruthy();
    expect(screen.getByText(/Ordner · 3 Notizen/)).toBeTruthy();
    expect(screen.getByText('in Projekte')).toBeTruthy();
    fireEvent.click(screen.getByText('Stadt'));
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText('Wiederherstellen'));
    });
    expect(onRestore).toHaveBeenCalledWith(folder);
  });
});
