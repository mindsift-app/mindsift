import { ApiKeyScope } from './types';

// What a key may do. The rights hold for every access alike: curl/REST and MCP for AI agents. The ids of
// the delivering rights (webhook:…) stay from the time keys could only deliver data. Notes, reading and
// sorting the inbox are reachable over MCP only (mcpOnly). Every area has the levels Lesen, Anlegen, Ändern.
export type ScopeGroup = 'tasks' | 'lists' | 'notes' | 'inbox';
export const SCOPES: { id: ApiKeyScope; label: string; chip: string; hint: string; group: ScopeGroup; mcpOnly?: boolean }[] = [
  { id: 'tasks:read', label: 'Lesen', chip: 'Aufgaben lesen', hint: 'Aufgabenlisten und Aufgaben lesen, suchen', group: 'tasks' },
  { id: 'webhook:task', label: 'Anlegen', chip: 'Aufgaben anlegen', hint: 'Nur neue Aufgaben anlegen', group: 'tasks' },
  { id: 'tasks:write', label: 'Ändern', chip: 'Aufgaben ändern', hint: 'Anlegen, ändern, abhaken und löschen', group: 'tasks' },
  { id: 'lists:read', label: 'Lesen', chip: 'Listen lesen', hint: 'Listen und ihre Einträge lesen', group: 'lists' },
  { id: 'webhook:list', label: 'Anlegen', chip: 'Listeneinträge hinzufügen', hint: 'Nur neue Einträge hinzufügen', group: 'lists' },
  { id: 'lists:write', label: 'Ändern', chip: 'Listen ändern', hint: 'Einträge hinzufügen, ändern und abhaken', group: 'lists' },
  { id: 'notes:read', label: 'Lesen', chip: 'Notizen lesen', hint: 'Notizen auflisten, lesen, suchen (nur MCP)', group: 'notes', mcpOnly: true },
  { id: 'notes:create', label: 'Anlegen', chip: 'Notizen anlegen', hint: 'Nur neue Notizen anlegen (nur MCP)', group: 'notes', mcpOnly: true },
  { id: 'notes:write', label: 'Ändern', chip: 'Notizen ändern', hint: 'Punkte ändern, abhaken, umbenennen, in den Papierkorb (nur MCP)', group: 'notes', mcpOnly: true },
  { id: 'inbox:read', label: 'Lesen', chip: 'Inbox lesen', hint: 'Offene Inbox-Einträge lesen (nur MCP)', group: 'inbox', mcpOnly: true },
  { id: 'webhook:triage', label: 'Anlegen', chip: 'Inbox', hint: 'Gedanken in die Inbox einliefern', group: 'inbox' },
  { id: 'inbox:write', label: 'Ändern', chip: 'Inbox sortieren', hint: 'Einträge umwandeln oder verwerfen (nur MCP)', group: 'inbox', mcpOnly: true },
];
// "Ändern" works on ids that come from reading: switching it on switches the matching read right on too
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
export const SCOPE_GROUPS: [ScopeGroup, string][] = [
  ['tasks', '📋 Aufgaben'],
  ['lists', '🛒 Listen'],
  ['notes', '🗒️ Notizen'],
  ['inbox', '📥 Inbox'],
];
export const scopeChip = (id: string) => SCOPES.find((s) => s.id === id)?.chip || id;
