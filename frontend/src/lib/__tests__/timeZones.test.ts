import { describe, it, expect } from 'vitest';
import { serverWallClock, timeZoneLabel, timeZoneList } from '../timeZones';

describe('time zones of the administration', () => {
  it('lists the browser zones with UTC first and the stored one added', () => {
    const intl = { ...Intl, supportedValuesOf: () => ['Europe/Berlin', 'America/New_York'] } as typeof Intl;
    expect(timeZoneList(['Etc/GMT-2', ''], intl)).toEqual(['UTC', 'America/New_York', 'Etc/GMT-2', 'Europe/Berlin']);
  });

  it('falls back to common zones without Intl.supportedValuesOf', () => {
    const zones = timeZoneList([], { ...Intl, supportedValuesOf: undefined } as unknown as typeof Intl);
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Europe/Berlin');
    expect(zones).toContain('Asia/Tokyo');
    expect(new Set(zones).size).toBe(zones.length);
  });

  it('reads underscores as spaces', () => {
    expect(timeZoneLabel('America/Los_Angeles')).toBe('America/Los Angeles');
  });

  it("keeps the server's wall time and offset, and moves it on", () => {
    const berlin = serverWallClock('2026-11-13T14:05:00+01:00');
    expect(berlin?.wall.toISOString()).toBe('2026-11-13T14:05:00.000Z');
    expect(berlin?.offset).toBe('UTC+01:00');
    const later = serverWallClock('2026-11-13T23:59:30-08:00', 60_000);
    expect(later?.wall.toISOString()).toBe('2026-11-14T00:00:30.000Z');
    expect(later?.offset).toBe('UTC-08:00');
    expect(serverWallClock('2026-11-13T22:00:00Z')?.offset).toBe('UTC');
    expect(serverWallClock('gestern')).toBeNull();
  });
});
