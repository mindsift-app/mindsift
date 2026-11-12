// Search, filters and order of the administration's user list (UsersSection). The list arrives in full
// from GET /admin/users (the organizations need all of it too); only what is shown is cut down here.
import { User, UserRole } from '../../../lib/types';

export type UserSort = 'name' | 'role' | 'newest';
export type RoleFilter = 'all' | UserRole;
// 'all', 'none' (no organization) or an organization id
export type OrgFilter = string;

export interface UserListFilter {
  query: string;
  role: RoleFilter;
  org: OrgFilter;
}

// Rows rendered at first and added per "Weitere anzeigen"
export const USER_PAGE_SIZE = 50;

// Lower case without accents, so "muller" finds "Müller" and "elodie" finds "Élodie"
export const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();

export function matchesUser(u: User, f: UserListFilter): boolean {
  if (f.role !== 'all' && u.role !== f.role) return false;
  const orgs = u.organizationIds || [];
  if (f.org === 'none' ? orgs.length > 0 : f.org !== 'all' && !orgs.includes(f.org)) return false;
  const words = foldText(f.query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // Every word somewhere in name, username or e-mail ("anna müll", "@anna", "beispiel.de")
  const hay = foldText([u.displayName, u.username ? `@${u.username}` : '', u.email].join(' '));
  return words.every((w) => hay.includes(w));
}

const ROLE_RANK: Record<UserRole, number> = { admin: 0, manager: 1, member: 2 };

export function sortUsers(list: User[], sort: UserSort, locale?: string): User[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const byName = (a: User, b: User) =>
    collator.compare(a.displayName || a.email, b.displayName || b.email) || collator.compare(a.email, b.email);
  const created = (u: User) => new Date(u.createdAt).getTime() || 0;
  return [...list].sort((a, b) => {
    if (sort === 'role') return ROLE_RANK[a.role] - ROLE_RANK[b.role] || byName(a, b);
    if (sort === 'newest') return created(b) - created(a) || byName(a, b);
    return byName(a, b);
  });
}

export const isFiltered = (f: UserListFilter) => f.query.trim() !== '' || f.role !== 'all' || f.org !== 'all';
