import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reloadForNewVersion } from '../useMainViews';

// A missing app chunk (a new version replaced it on the server) reloads the page, but never in a loop
describe('reloading for a missing chunk', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('reloads once, then not again within a minute', () => {
    const reload = vi.fn();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expect(reloadForNewVersion(reload)).toBe(true);
    expect(reloadForNewVersion(reload)).toBe(false);
    now.mockReturnValue(1_000_000 + 61_000);
    expect(reloadForNewVersion(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload while offline: the chunk cannot come from the server anyway', () => {
    const reload = vi.fn();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(reloadForNewVersion(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
