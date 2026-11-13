// IANA time zones for the server's time zone in the administration (the server checks the name itself)

// Browsers without Intl.supportedValuesOf get the common zones; the current setting is always added
const FALLBACK_ZONES = [
  'UTC',
  'Europe/London', 'Europe/Lisbon', 'Europe/Dublin', 'Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Paris',
  'Europe/Brussels', 'Europe/Amsterdam', 'Europe/Luxembourg', 'Europe/Madrid', 'Europe/Rome', 'Europe/Prague',
  'Europe/Warsaw', 'Europe/Copenhagen', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Helsinki', 'Europe/Athens',
  'Europe/Istanbul', 'Europe/Kyiv', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Sao_Paulo',
  'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Nairobi', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta',
  'Asia/Singapore', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney', 'Pacific/Auckland',
];

type IntlWithZones = typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };

/** All zones the browser knows (with UTC and the extra names), sorted; `extra` are e.g. the stored setting. */
export function timeZoneList(extra: string[] = [], intl: IntlWithZones = Intl): string[] {
  let zones: string[] = [];
  try {
    zones = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = FALLBACK_ZONES;
  const all = new Set(['UTC', ...zones, ...extra.filter(Boolean)]);
  return [...all].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
}

/** The browser's own zone, '' when it does not say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/** "America/Los_Angeles" → "America/Los Angeles", as the zone reads in the list. */
export const timeZoneLabel = (zone: string) => zone.replace(/_/g, ' ');

/**
 * The server's wall clock from its RFC 3339 time ("2026-11-13T14:05:00+01:00"), moved on by elapsedMs:
 * a Date whose UTC fields are that wall time (format it with timeZone 'UTC'), and the offset as "UTC+01:00".
 * Works whether the browser knows the zone or not. null for a time it cannot read.
 */
export function serverWallClock(now: string, elapsedMs = 0): { wall: Date; offset: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(now);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone] = m;
  const wall = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) + elapsedMs);
  return { wall, offset: zone === 'Z' ? 'UTC' : `UTC${zone}` };
}
