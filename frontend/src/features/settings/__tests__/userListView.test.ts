import { describe, it, expect } from 'vitest';
import { matchesUser, sortUsers, isFiltered, UserListFilter } from '../admin/userListView';
import { User } from '../../../lib/types';

const person = (id: string, displayName: string, extra: Partial<User> = {}): User => ({
  id,
  displayName,
  email: `${id}@beispiel.de`,
  role: 'member',
  isActive: true,
  createdAt: '2026-11-01T08:00:00Z',
  ...extra,
});

const none: UserListFilter = { query: '', role: 'all', org: 'all' };

describe('matchesUser', () => {
  const anna = person('anna', 'Anna Müller', { username: 'anna.m', organizationIds: ['org_v'] });
  const elodie = person('elodie', 'Élodie Weber', { role: 'admin' });

  it('finds by name, username and e-mail, without regard to case and accents', () => {
    expect(matchesUser(anna, { ...none, query: 'muller' })).toBe(true);
    expect(matchesUser(anna, { ...none, query: 'MÜLL' })).toBe(true);
    expect(matchesUser(anna, { ...none, query: '@anna.m' })).toBe(true);
    expect(matchesUser(anna, { ...none, query: 'anna@beispiel' })).toBe(true);
    expect(matchesUser(elodie, { ...none, query: 'elodie' })).toBe(true);
    expect(matchesUser(anna, { ...none, query: 'weber' })).toBe(false);
  });

  it('needs every word of the search', () => {
    expect(matchesUser(anna, { ...none, query: 'anna müller' })).toBe(true);
    expect(matchesUser(anna, { ...none, query: 'anna weber' })).toBe(false);
  });

  it('filters by role and organization, "none" for people without one', () => {
    expect(matchesUser(elodie, { ...none, role: 'admin' })).toBe(true);
    expect(matchesUser(anna, { ...none, role: 'admin' })).toBe(false);
    expect(matchesUser(anna, { ...none, org: 'org_v' })).toBe(true);
    expect(matchesUser(anna, { ...none, org: 'org_x' })).toBe(false);
    expect(matchesUser(anna, { ...none, org: 'none' })).toBe(false);
    expect(matchesUser(elodie, { ...none, org: 'none' })).toBe(true);
  });

  it('knows when a filter is set', () => {
    expect(isFiltered(none)).toBe(false);
    expect(isFiltered({ ...none, query: '  ' })).toBe(false);
    expect(isFiltered({ ...none, org: 'none' })).toBe(true);
  });
});

describe('sortUsers', () => {
  const list = [
    person('z', 'Zoe Klein', { createdAt: '2026-11-03T08:00:00Z' }),
    person('o', 'Ömer Koch', { role: 'manager', createdAt: '2026-11-01T08:00:00Z' }),
    person('a', 'anna Wolf', { createdAt: '2026-11-02T08:00:00Z' }),
    person('b', 'Ben Admin', { role: 'admin', createdAt: '2026-10-01T08:00:00Z' }),
  ];
  const names = (l: User[]) => l.map((u) => u.id).join('');

  it('sorts by name as people read it (case and umlauts do not push to the end)', () => {
    expect(names(sortUsers(list, 'name', 'de'))).toBe('aboz');
  });

  it('puts admins, then user managers first, by name within', () => {
    expect(names(sortUsers(list, 'role', 'de'))).toBe('boaz');
  });

  it('puts the newest accounts first', () => {
    expect(names(sortUsers(list, 'newest', 'de'))).toBe('zaob');
  });

  it('leaves the given list alone', () => {
    const before = names(list);
    sortUsers(list, 'role', 'de');
    expect(names(list)).toBe(before);
  });
});
