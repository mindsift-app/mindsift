import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import { api, ApiError } from '../../../lib/api';
import { ConfirmHost } from '../../../components/askConfirm';
import { useBranchActions } from '../useBranchActions';
import type { DocumentBlock } from '../../../lib/types';

vi.mock('../../../lib/api', async (original) =>
  (await import('../../../test/apiMock')).withApi(original, { inlineNote: vi.fn() })
);

const linkBlock: DocumentBlock = { id: 'blk_l', type: 'bullet', content: '[[Garten#doc_g]]', level: 0, position: 1 };

function setup() {
  const applyLocalBlocks = vi.fn();
  const showNotice = vi.fn();
  const sync = {
    engineRef: { current: { clientId: 'c1', syncNow: vi.fn(async () => {}) } },
    currentBlocksRef: { current: [linkBlock] },
    lastExtractRef: { current: null },
    lastInlineRef: { current: null },
    lastMoveRef: { current: null },
    applyLocalBlocks,
  } as unknown as Parameters<typeof useBranchActions>[0]['sync'];
  const { result } = renderHook(() =>
    useBranchActions({
      docId: 'doc_src',
      canEdit: true,
      embedded: false,
      scrollRef: { current: null },
      sync,
      showNotice,
    })
  );
  render(<ConfirmHost />);
  return { result, applyLocalBlocks, showNotice };
}

const pulled = { sourceId: 'doc_g', content: 'Garten', blocks: [{ id: 'blk_n', type: 'bullet', content: 'Beete', level: 0, position: 1 }] };

describe('pulling a note back in while other people link to it', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks with the number of links and pulls back with the flag on confirm', async () => {
    vi.mocked(api.inlineNote)
      .mockRejectedValueOnce(new ApiError('…', 409, 'foreign_links', { count: 2 }))
      .mockResolvedValueOnce(pulled as Awaited<ReturnType<typeof api.inlineNote>>);
    const { result, applyLocalBlocks } = setup();
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.handleInlineBlock('blk_l');
    });
    expect(await screen.findByText('2 Links anderer Personen zeigen danach ins Leere – trotzdem zurückholen?')).toBeTruthy();
    expect(api.inlineNote).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Trotzdem zurückholen' }));
    await act(async () => {
      await done;
    });
    expect(api.inlineNote).toHaveBeenLastCalledWith('doc_src', 'blk_l', true);
    expect(applyLocalBlocks).toHaveBeenCalledTimes(1);
  });

  it('uses the singular for one link', async () => {
    vi.mocked(api.inlineNote).mockRejectedValueOnce(new ApiError('…', 409, 'foreign_links', { count: 1 }));
    const { result } = setup();
    act(() => {
      void result.current.handleInlineBlock('blk_l');
    });
    expect(await screen.findByText('1 Link einer anderen Person zeigt danach ins Leere – trotzdem zurückholen?')).toBeTruthy();
  });

  it('does nothing when cancelled', async () => {
    vi.mocked(api.inlineNote).mockRejectedValueOnce(new ApiError('…', 409, 'foreign_links', { count: 3 }));
    const { result, applyLocalBlocks, showNotice } = setup();
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.handleInlineBlock('blk_l');
    });
    await screen.findByText(/3 Links anderer Personen/);
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await act(async () => {
      await done;
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.inlineNote).toHaveBeenCalledTimes(1);
    expect(applyLocalBlocks).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('shows other refusals as before, without asking', async () => {
    vi.mocked(api.inlineNote).mockRejectedValueOnce(new ApiError('Bitte dort zuerst entfernen.', 409));
    const { result, showNotice } = setup();
    await act(async () => {
      await result.current.handleInlineBlock('blk_l');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(showNotice).toHaveBeenCalledWith('Bitte dort zuerst entfernen.');
  });
});
