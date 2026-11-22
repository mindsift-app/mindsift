import { describe, it, expect, vi, beforeEach } from 'vitest';

const askChoice = vi.hoisted(() => vi.fn());
vi.mock('../../components/askConfirm', () => ({ askChoice }));

import { guardLeave, holdLeave } from '../leaveGuard';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('leaveGuard', () => {
  const dictation = {};
  beforeEach(() => {
    askChoice.mockReset();
    holdLeave(dictation, false);
  });

  it('switches at once while nothing would be lost', () => {
    const go = vi.fn();
    guardLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(askChoice).not.toHaveBeenCalled();
  });

  it('asks during a dictation: "Trotzdem wechseln" switches, "Bleiben" or a click outside stays', async () => {
    holdLeave(dictation, true);
    const go = vi.fn();

    askChoice.mockResolvedValueOnce('alt');
    guardLeave(go);
    await flush();
    expect(askChoice).toHaveBeenCalledWith({ message: expect.stringContaining('Diktat'), confirmLabel: 'Trotzdem wechseln', altLabel: 'Bleiben' });
    expect(go).not.toHaveBeenCalled();

    askChoice.mockResolvedValueOnce(null);
    guardLeave(go);
    await flush();
    expect(go).not.toHaveBeenCalled();

    askChoice.mockResolvedValueOnce('confirm');
    guardLeave(go);
    await flush();
    expect(go).toHaveBeenCalledTimes(1);
  });
});
