import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getBlock, FakeApiError } = vi.hoisted(() => ({
  getBlock: vi.fn(),
  FakeApiError: class extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message);
    }
  },
}));
vi.mock('../api', () => ({
  api: { getBlock: (id: string) => getBlock(id) },
  ApiError: FakeApiError,
  getCurrentUserId: () => 'user_1',
}));

import { blocksVersion, cachedBlock, clearBlockLookup, lookupBlock, refreshBlocks, requestBlock, subscribeBlocks } from '../blockLookup';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('bullets looked up for links', () => {
  beforeEach(() => {
    clearBlockLookup();
    getBlock.mockReset();
  });

  it('looks a bullet up once, keeps it and tells the listeners', async () => {
    getBlock.mockResolvedValue({ documentId: 'doc_a', content: 'Zeile', type: 'text' });
    const seen = vi.fn();
    const unsub = subscribeBlocks(seen);
    expect(cachedBlock('blk_1')).toBeUndefined();
    requestBlock('blk_1');
    requestBlock('blk_1');
    await flush();
    expect(getBlock).toHaveBeenCalledTimes(1);
    expect(cachedBlock('blk_1')).toEqual({ documentId: 'doc_a', content: 'Zeile', type: 'text' });
    expect(seen).toHaveBeenCalled();
    requestBlock('blk_1');
    await flush();
    expect(getBlock).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('remembers a bullet that does not exist or may not be read', async () => {
    getBlock.mockRejectedValue(new FakeApiError('nope', 404));
    expect(await lookupBlock('blk_x')).toBeNull();
    expect(cachedBlock('blk_x')).toBeNull();
    requestBlock('blk_x');
    await flush();
    expect(getBlock).toHaveBeenCalledTimes(1);
  });

  it('does not ask again right after a failed lookup (no connection)', async () => {
    getBlock.mockRejectedValue(new Error('offline'));
    expect(await lookupBlock('blk_y')).toBeNull();
    expect(cachedBlock('blk_y')).toBeUndefined();
    requestBlock('blk_y');
    await flush();
    expect(getBlock).toHaveBeenCalledTimes(1);
  });

  it('fetches known bullets again after a refresh and shows the old text until then', async () => {
    getBlock.mockResolvedValueOnce({ documentId: 'doc_a', content: 'alt', type: 'text' });
    await lookupBlock('blk_2');
    const before = blocksVersion();
    getBlock.mockResolvedValueOnce({ documentId: 'doc_a', content: 'neu', type: 'text' });
    refreshBlocks();
    expect(blocksVersion()).toBeGreaterThan(before);
    expect(cachedBlock('blk_2')?.content).toBe('alt');
    requestBlock('blk_2');
    await flush();
    expect(cachedBlock('blk_2')?.content).toBe('neu');
    expect(getBlock).toHaveBeenCalledTimes(2);
  });
});
