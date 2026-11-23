import { describe, expect, it } from 'vitest';
import events from '../realtimeEvents.json';

// realtimeEvents.json names the realtime events of the server (internal/api/events.go, checked there by
// events_test.go): `server` what it sends, `client` what it takes. The app may only listen for and send
// these, so a renamed event on one side cannot go unnoticed.
const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const EVENT = /['"`]((?:TASK|DOC|LIST|ITEM|WORKSPACE|NOTIFICATION|TRANSCRIPTION|DRAW|USER_PRESENCE|SSE|DEMO|JOIN|LEAVE)[A-Z_]*|PING|PONG)['"`]/g;
const known = new Set([...events.server, ...events.client]);

const named = Object.entries(sources).flatMap(([file, code]) =>
  [...code.replace(/\/\/.*$/gm, '').matchAll(EVENT)].map((m) => ({ file: file.replace(/^(\.\.\/)+/, ''), name: m[1] }))
);

describe('realtime events', () => {
  it('names only events the server knows', () => {
    const unknown = named.filter((n) => !n.name.endsWith('_') && !known.has(n.name)).map((n) => `${n.file}: ${n.name}`);
    expect(unknown).toEqual([]);
  });

  it('has prefixes that match events', () => {
    const empty = named.filter((n) => n.name.endsWith('_') && ![...known].some((e) => e.startsWith(n.name))).map((n) => `${n.file}: ${n.name}`);
    expect(empty).toEqual([]);
  });

  it('finds the events in the code', () => {
    expect(named.some((n) => n.name === 'TASK_CREATED')).toBe(true);
  });
});
