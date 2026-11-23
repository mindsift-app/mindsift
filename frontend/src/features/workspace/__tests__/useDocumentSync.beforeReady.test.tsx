import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api';
import { BlockType, Document, DocumentBlock } from '../../../lib/types';
import { useDocumentSync } from '../useDocumentSync';

// An engine that gets ready only when the test says so (its snapshot arrives late, as in WebKit right after a
// page load); it takes changes only once ready, like the real one
const { engines, FakeEngine } = vi.hoisted(() => {
  const engines: InstanceType<typeof FakeEngine>[] = [];
  class FakeEngine {
    clientId = 'c1';
    ready = false;
    canEdit = true;
    blocks: DocumentBlock[] = [];
    applied: DocumentBlock[][] = [];
    listeners = new Set<(s: unknown) => void>();
    constructor() {
      engines.push(this);
    }
    state() {
      return { ready: this.ready, status: 'idle', blocks: this.blocks, title: 'Notiz' };
    }
    subscribe(fn: (s: unknown) => void) {
      this.listeners.add(fn);
      fn(this.state());
      return () => this.listeners.delete(fn);
    }
    emit() {
      const s = this.state();
      this.listeners.forEach((fn) => fn(s));
    }
    getState() {
      return this.state();
    }
    start() {
      return Promise.resolve();
    }
    stop() {}
    setTaskLinks() {}
    applyFlat(blocks: DocumentBlock[]) {
      if (!this.ready || !this.canEdit) return;
      this.applied.push(blocks);
      this.blocks = blocks;
      this.emit();
    }
    // The snapshot arrived
    load(blocks: DocumentBlock[]) {
      this.blocks = blocks;
      this.ready = true;
      this.emit();
    }
  }
  return { engines, FakeEngine };
});

vi.mock('../../../lib/docSync/engine', () => ({ DocSyncEngine: FakeEngine }));

vi.mock('../../../lib/api', async (original) =>
  (await import('../../../test/apiMock')).withApi(original, { getDocument: vi.fn() })
);

const blk = (id: string, content: string, type: BlockType = 'text'): DocumentBlock => ({ id, documentId: 'doc_1', type, content, level: 0, position: 1000 });
const fetched: DocumentBlock[] = [blk('a', 'Vor dem Bild'), blk('b', 'Nach dem Bild')];
const makeDoc = (): Document => ({
  id: 'doc_1',
  userId: 'u1',
  title: 'Notiz',
  icon: '',
  content: '',
  blocks: fetched,
  tags: [],
  isPinned: false,
  isArchived: false,
  createdAt: '2026-11-22T08:00:00Z',
  updatedAt: '2026-11-22T08:00:00Z',
});
const image = blk('img', '![](media:med_1)', 'image');
const withImage = [fetched[0], image, fetched[1]];

async function renderBeforeReady() {
  engines.length = 0;
  vi.mocked(api.getDocument).mockResolvedValue(makeDoc());
  const hook = renderHook(() => useDocumentSync('doc_1', null, vi.fn()));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...hook, engine: engines[0] };
}

describe('useDocumentSync: changes before the sync engine is ready', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps an image dropped before the snapshot arrived and hands it to the engine', async () => {
    const { result, engine } = await renderBeforeReady();
    act(() => result.current.applyLocalBlocks(withImage));
    expect(engine.applied).toHaveLength(0);
    act(() => engine.load(fetched));
    expect(engine.applied).toEqual([withImage]);
    expect(result.current.blocks.map((b) => b.id)).toEqual(['a', 'img', 'b']);
  });

  it('takes the server state when the note changed on the server meanwhile', async () => {
    const { result, engine } = await renderBeforeReady();
    act(() => result.current.applyLocalBlocks(withImage));
    act(() => engine.load([fetched[0], blk('c', 'Von jemand anderem'), fetched[1]]));
    expect(engine.applied).toHaveLength(0);
    expect(result.current.blocks.map((b) => b.id)).toEqual(['a', 'c', 'b']);
  });

  it('shows the engine state as before when nothing changed before it was ready', async () => {
    const { result, engine } = await renderBeforeReady();
    act(() => engine.load(withImage));
    expect(engine.applied).toHaveLength(0);
    expect(result.current.blocks.map((b) => b.id)).toEqual(['a', 'img', 'b']);
  });
});
