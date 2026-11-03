import { describe, it, expect, vi } from 'vitest';
import { reportNav, onNavStep, restoringNavPlace } from '../navHistory';

const tick = () => new Promise((r) => setTimeout(r, 0));
const stateOf = () => (window.history.state as { mindsiftNav?: Record<string, unknown> } | null)?.mindsiftNav;

describe('navHistory', () => {
  it('puts places into the history, one entry per action, and steps back to them', async () => {
    const pushes = vi.spyOn(window.history, 'pushState');
    reportNav({ tab: 'triage' }); // first place: replaces the current entry
    await tick();
    expect(pushes).not.toHaveBeenCalled();

    // Opening a note from elsewhere: page and note in one go -> one entry
    reportNav({ tab: 'workspace' });
    reportNav({ docId: 'doc_1', view: 'editor' });
    await tick();
    expect(pushes).toHaveBeenCalledTimes(1);
    reportNav({ zoom: 'blk_7' });
    await tick();
    expect(pushes).toHaveBeenCalledTimes(2);
    expect(stateOf()).toMatchObject({ tab: 'workspace', docId: 'doc_1', zoom: 'blk_7' });

    // The same place again is no new entry
    reportNav({ zoom: 'blk_7' });
    await tick();
    expect(pushes).toHaveBeenCalledTimes(2);

    // Back: listeners get the earlier place; what the app reports while following it adds nothing
    const seen: unknown[] = [];
    const off = onNavStep((p) => seen.push(p));
    window.dispatchEvent(new PopStateEvent('popstate', { state: { mindsiftNav: { tab: 'workspace', docId: 'doc_1', view: 'editor', zoom: null } } }));
    expect(seen).toEqual([{ tab: 'workspace', docId: 'doc_1', view: 'editor', zoom: null }]);
    expect(restoringNavPlace()).toMatchObject({ docId: 'doc_1', zoom: null });
    reportNav({ zoom: null });
    await tick();
    expect(pushes).toHaveBeenCalledTimes(2);

    // Foreign history entries (no place) are left alone
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(seen).toHaveLength(1);
    off();
    pushes.mockRestore();
  });
});
