import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const askChoice = vi.hoisted(() => vi.fn());
vi.mock('../../components/askConfirm', () => ({ askChoice }));

import { installShellActionGuard, SHELL_ACTION_EVENT } from '../desktopShellActions';
import { holdRecording } from '../leaveGuard';
import { actAsDesktopApp } from '../../test/desktop';
import { flush } from '../../test/fixtures';

// What the shell's script does in the page (desktop/internal/shell/guard.go, guardScript)
function request(action: string) {
  const reply = vi.fn();
  window.dispatchEvent(new CustomEvent(SHELL_ACTION_EVENT, { detail: { action, reply } }));
  return reply;
}

describe('desktop shell actions', () => {
  const recording = {};
  let remove: () => void;
  beforeEach(() => {
    actAsDesktopApp();
    askChoice.mockReset();
    remove = installShellActionGuard();
  });
  afterEach(() => {
    holdRecording(recording, false);
    remove();
  });

  it('lets the shell go at once while nothing would be lost', () => {
    const reply = request('reload');
    expect(reply.mock.calls).toEqual([['go']]);
    expect(askChoice).not.toHaveBeenCalled();
  });

  it('during a recording asks first: "Trotzdem neu laden" goes, "Bleiben" stays', async () => {
    holdRecording(recording, true);

    askChoice.mockResolvedValueOnce('confirm');
    const reload = request('reload');
    expect(reload.mock.calls).toEqual([['wait']]);
    await flush();
    expect(askChoice).toHaveBeenCalledWith({
      message: expect.stringContaining('Neuladen'),
      confirmLabel: 'Trotzdem neu laden',
      altLabel: 'Bleiben',
    });
    expect(reload.mock.calls).toEqual([['wait'], ['go']]);

    askChoice.mockResolvedValueOnce('alt');
    const quit = request('quit');
    await flush();
    expect(askChoice).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: 'Trotzdem beenden' }));
    expect(quit.mock.calls).toEqual([['wait'], ['stay']]);
  });

  it('asks with the switch texts for an action it does not know', async () => {
    holdRecording(recording, true);
    askChoice.mockResolvedValueOnce(null);
    const reply = request('somethingNew');
    await flush();
    expect(askChoice).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Trotzdem wechseln' }));
    expect(reply.mock.calls).toEqual([['wait'], ['stay']]);
  });

  it('asks for a dictation that holds the page but not the view (leave: false)', () => {
    holdRecording(recording, true, { leave: false });
    askChoice.mockReturnValueOnce(new Promise(() => {}));
    expect(request('switch').mock.calls).toEqual([['wait']]);
  });

  it('ignores events without a reply function', () => {
    window.dispatchEvent(new CustomEvent(SHELL_ACTION_EVENT, { detail: { action: 'reload' } }));
    window.dispatchEvent(new CustomEvent(SHELL_ACTION_EVENT));
    expect(askChoice).not.toHaveBeenCalled();
  });
});
