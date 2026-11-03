import { ApiKeyScope } from './types';
import i18n from '../i18n';

// What a key may do. The rights hold for every access alike: curl/REST and MCP for AI agents. The ids of
// the delivering rights (webhook:…) stay from the time keys could only deliver data. Notes, reading and
// sorting the inbox are reachable over MCP only (mcpOnly). Every area has the levels read, create, change.
export type ScopeGroup = 'tasks' | 'lists' | 'notes' | 'inbox';
export interface ScopeInfo {
  id: ApiKeyScope;
  group: ScopeGroup;
  mcpOnly?: boolean;
  readonly label: string;
  readonly chip: string;
  readonly hint: string;
}
// Texts come from settings:scopes.<key> in the language shown at the time of reading
const scope = (id: ApiKeyScope, key: string, group: ScopeGroup, mcpOnly?: boolean): ScopeInfo => ({
  id,
  group,
  mcpOnly,
  get label() {
    return i18n.t(`settings:scopes.${key}.label`);
  },
  get chip() {
    return i18n.t(`settings:scopes.${key}.chip`);
  },
  get hint() {
    return i18n.t(`settings:scopes.${key}.hint`);
  },
});
export const SCOPES: ScopeInfo[] = [
  scope('tasks:read', 'tasksRead', 'tasks'),
  scope('webhook:task', 'tasksCreate', 'tasks'),
  scope('tasks:write', 'tasksWrite', 'tasks'),
  scope('lists:read', 'listsRead', 'lists'),
  scope('webhook:list', 'listsCreate', 'lists'),
  scope('lists:write', 'listsWrite', 'lists'),
  scope('notes:read', 'notesRead', 'notes', true),
  scope('notes:create', 'notesCreate', 'notes', true),
  scope('notes:write', 'notesWrite', 'notes', true),
  scope('inbox:read', 'inboxRead', 'inbox', true),
  scope('webhook:triage', 'inboxCreate', 'inbox'),
  scope('inbox:write', 'inboxWrite', 'inbox', true),
];
// "Change" works on ids that come from reading: switching it on switches the matching read right on too
export const READ_FOR_WRITE: Partial<Record<ApiKeyScope, ApiKeyScope>> = {
  'tasks:write': 'tasks:read',
  'lists:write': 'lists:read',
  'notes:write': 'notes:read',
  'inbox:write': 'inbox:read',
};
// Toggles one right of a key: at least one stays on, a write right brings its read right along
export function toggleScopeIn(prev: ApiKeyScope[], id: ApiKeyScope): ApiKeyScope[] {
  if (prev.includes(id)) {
    const next = prev.filter((s) => s !== id);
    return next.length > 0 ? next : prev;
  }
  const read = READ_FOR_WRITE[id];
  return read && !prev.includes(read) ? [...prev, id, read] : [...prev, id];
}
const GROUP_ICONS: [ScopeGroup, string][] = [
  ['tasks', '📋'],
  ['lists', '🛒'],
  ['notes', '🗒️'],
  ['inbox', '📥'],
];
// Heading of each group, in the language shown when called
export const scopeGroups = (): [ScopeGroup, string][] =>
  GROUP_ICONS.map(([group, icon]) => [group, `${icon} ${i18n.t(`settings:scopes.groups.${group}`)}`]);
export const scopeChip = (id: string) => SCOPES.find((s) => s.id === id)?.chip || id;
