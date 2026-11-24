import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const askConfirm = vi.hoisted(() => vi.fn());
vi.mock('../../../components/askConfirm', () => ({ askConfirm }));

import { TrashView } from '../TrashView';

const items = [
  { id: 'doc_1', title: 'Urlaub', icon: '🏔️', folderPath: 'Privat', deletedAt: '2026-10-29T08:00:00Z', isOwner: true },
];

const view = (over: Partial<React.ComponentProps<typeof TrashView>> = {}) =>
  render(
    <TrashView
      items={items}
      onOpen={vi.fn()}
      onRestore={vi.fn(async () => {})}
      onPurge={vi.fn(async () => {})}
      onEmpty={vi.fn(async () => {})}
      onBackMobile={vi.fn()}
      {...over}
    />,
  );

describe('TrashView', () => {
  beforeEach(() => askConfirm.mockReset());

  it('deletes for good only after the question at the click', async () => {
    const onPurge = vi.fn(async () => {});
    view({ onPurge });
    askConfirm.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    });
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: '„Urlaub“ endgültig löschen?', danger: true }));
    expect(onPurge).not.toHaveBeenCalled();

    askConfirm.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    });
    expect(onPurge).toHaveBeenCalledWith(items[0]);
  });

  it('empties the trash after asking how many entries go', async () => {
    const onEmpty = vi.fn(async () => {});
    view({ onEmpty });
    askConfirm.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Papierkorb leeren' }));
    });
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: '1 Eintrag endgültig löschen?' }));
    expect(onEmpty).toHaveBeenCalled();
  });

  it('restores with one tap and shows the original folder', async () => {
    const onRestore = vi.fn(async () => {});
    view({ onRestore });
    expect(screen.getByText('Privat')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Wiederherstellen'));
    });
    expect(onRestore).toHaveBeenCalledWith(items[0]);
    expect(askConfirm).not.toHaveBeenCalled();
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
    view({ items: [folder], onOpen, onRestore });
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

  it('says so when the trash is empty and offers no emptying', () => {
    view({ items: [] });
    expect(screen.getByText('Der Papierkorb ist leer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Papierkorb leeren' })).toBeNull();
  });
});
