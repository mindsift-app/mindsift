import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const askChoice = vi.hoisted(() => vi.fn());
vi.mock('../../components/askConfirm', () => ({ askChoice }));

import { reportNav, onNavStep, pushModal } from '../navHistory';
import { holdLeave } from '../leaveGuard';
import { flush } from '../../test/fixtures';

type Entry = { mindsiftNav?: Record<string, unknown>; mindsiftIdx?: number; mindsiftModal?: number };
const pop = (state: Entry | null) => window.dispatchEvent(new PopStateEvent('popstate', { state }));

// Browser back/forward while a dictation runs (lib/leaveGuard.ts): the step is taken back and asked about
describe('navHistory while a dictation would be lost', () => {
  const dictation = {};
  let go: ReturnType<typeof vi.spyOn>;
  let back: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    askChoice.mockReset();
    go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });
  afterEach(() => {
    holdLeave(dictation, false);
    go.mockRestore();
    back.mockRestore();
  });

  it('takes a back step back, "Bleiben" stays, "Trotzdem wechseln" steps again and follows it', async () => {
    reportNav({ tab: 'triage' });
    await flush();
    reportNav({ tab: 'workspace', docId: 'doc_1' });
    await flush();
    const here = window.history.state as Entry;
    const earlier = { mindsiftNav: { tab: 'triage' }, mindsiftIdx: (here.mindsiftIdx ?? 0) - 1 };
    const seen: unknown[] = [];
    const off = onNavStep((p) => seen.push(p));
    holdLeave(dictation, true);

    // Back: undone at once, then asked; "Bleiben" leaves it there
    askChoice.mockResolvedValueOnce('alt');
    pop(earlier);
    expect(go).toHaveBeenCalledWith(1);
    pop(here); // the undo itself arrives and changes nothing
    await flush();
    expect(askChoice).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Trotzdem wechseln', altLabel: 'Bleiben' }));
    expect(seen).toEqual([]);

    // Again, now "Trotzdem wechseln": the step is taken again and the app follows it without a second question
    askChoice.mockResolvedValueOnce('confirm');
    pop(earlier);
    pop(here);
    await flush();
    expect(go).toHaveBeenLastCalledWith(-1);
    pop(earlier);
    expect(askChoice).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([{ tab: 'triage' }]);
    off();
  });

  it('keeps a dialog open on back and closes it only after "Trotzdem schließen"', async () => {
    const onBack = vi.fn(() => true);
    pushModal(onBack);
    const withDialog = window.history.state as Entry;
    const below = { ...withDialog, mindsiftModal: undefined, mindsiftIdx: (withDialog.mindsiftIdx ?? 1) - 1 };
    holdLeave(dictation, true);

    askChoice.mockResolvedValueOnce('confirm');
    pop(below);
    expect(onBack).not.toHaveBeenCalled();
    expect((window.history.state as Entry).mindsiftModal).toBe(withDialog.mindsiftModal);
    await flush();
    expect(askChoice).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Trotzdem schließen' }));
    expect(back).toHaveBeenCalledTimes(1);
    pop(below);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('steps without asking while nothing would be lost', async () => {
    const seen: unknown[] = [];
    const off = onNavStep((p) => seen.push(p));
    pop({ mindsiftNav: { tab: 'tasks' }, mindsiftIdx: 0 });
    await flush();
    expect(askChoice).not.toHaveBeenCalled();
    expect(seen).toEqual([{ tab: 'tasks' }]);
    off();
  });
});
