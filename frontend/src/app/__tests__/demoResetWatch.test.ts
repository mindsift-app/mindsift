import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoResetWatch } from '../demoResetWatch';
import type { AuthStatus } from '../../lib/types';

const status = (seconds: number): AuthStatus => ({
  needsSetup: false,
  allowRegistration: false,
  instanceName: 'MindSift',
  demoMode: true,
  demoResetInSeconds: seconds,
  demoResetMinutes: 20,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createDemoResetWatch', () => {
  it('asks again with growing pauses until the server names the next reset', async () => {
    const answers: (AuthStatus | null)[] = [status(0), null, status(0), status(1199)];
    const fetchStatus = vi.fn(() => {
      const st = answers.shift();
      return st ? Promise.resolve(st) : Promise.reject(new Error('offline'));
    });
    const onStatus = vi.fn();
    const watch = createDemoResetWatch(fetchStatus, onStatus);

    watch.elapsed();
    expect(fetchStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    // Still the deadline just passed: next try after 10 s, then 20 s, then 40 s
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(onStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40000);
    expect(fetchStatus).toHaveBeenCalledTimes(4);
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls[0][0].demoResetInSeconds).toBe(1199);
    // Done: no more requests
    await vi.advanceTimersByTimeAsync(300000);
    expect(fetchStatus).toHaveBeenCalledTimes(4);
  });

  it('keeps trying once a minute while the server stays unreachable', async () => {
    const fetchStatus = vi.fn(() => Promise.reject(new Error('offline')));
    const watch = createDemoResetWatch(fetchStatus, vi.fn());
    watch.elapsed();
    await vi.advanceTimersByTimeAsync(5000 + 10000 + 20000 + 40000 + 60000);
    expect(fetchStatus).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60000 * 3);
    expect(fetchStatus).toHaveBeenCalledTimes(8);
  });

  it('runs one round only, even if the countdown reports the end several times', async () => {
    const fetchStatus = vi.fn(() => Promise.resolve(status(1200)));
    const onStatus = vi.fn();
    const watch = createDemoResetWatch(fetchStatus, onStatus);
    watch.elapsed();
    watch.elapsed();
    watch.elapsed();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledTimes(1);
  });

  it('a refresh asks at once and replaces a waiting round', async () => {
    const fetchStatus = vi.fn(() => Promise.resolve(status(1200)));
    const onStatus = vi.fn();
    const watch = createDemoResetWatch(fetchStatus, onStatus);
    watch.elapsed();
    watch.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledTimes(1);
  });

  it('drops the answer of a cancelled round', async () => {
    let answer: (st: AuthStatus) => void = () => {};
    const fetchStatus = vi.fn(() => new Promise<AuthStatus>((resolve) => (answer = resolve)));
    const onStatus = vi.fn();
    const watch = createDemoResetWatch(fetchStatus, onStatus);
    watch.refresh();
    watch.cancel();
    answer(status(1200));
    await vi.advanceTimersByTimeAsync(60000);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('accepts a status without a periodic reset', async () => {
    const onStatus = vi.fn();
    const watch = createDemoResetWatch(() => Promise.resolve({ needsSetup: false, allowRegistration: false, instanceName: 'MindSift' }), onStatus);
    watch.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).toHaveBeenCalledTimes(1);
  });
});
