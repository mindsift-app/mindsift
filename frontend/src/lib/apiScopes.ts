import { ApiKeyScope } from './types';

// What a key may do. The rights hold for every access alike: curl/REST and MCP for AI agents. The ids of
// the delivering rights (webhook:…) stay from the time keys could only deliver data. Notes are reachable
// over MCP only.
export type ScopeGroup = 'tasks' | 'lists' | 'notes' | 'inbox';
export const SCOPES: { id: ApiKeyScope; label: string; chip: string; hint: string; group: ScopeGroup }[] = [
  { id: 'tasks:read', label: 'Lesen', chip: 'Aufgaben lesen', hint: 'Aufgabenlisten und Aufgaben lesen, suchen', group: 'tasks' },
  { id: 'webhook:task', label: 'Anlegen', chip: 'Aufgaben anlegen', hint: 'Nur neue Aufgaben anlegen', group: 'tasks' },
  { id: 'tasks:write', label: 'Ändern', chip: 'Aufgaben ändern', hint: 'Anlegen, ändern, abhaken und löschen', group: 'tasks' },
  { id: 'lists:read', label: 'Lesen', chip: 'Listen lesen', hint: 'Listen und ihre Einträge lesen', group: 'lists' },
  { id: 'webhook:list', label: 'Einträge hinzufügen', chip: 'Listeneinträge hinzufügen', hint: 'Nur neue Einträge hinzufügen', group: 'lists' },
  { id: 'lists:write', label: 'Ändern', chip: 'Listen ändern', hint: 'Einträge hinzufügen, ändern und abhaken', group: 'lists' },
  { id: 'notes:read', label: 'Lesen', chip: 'Notizen lesen', hint: 'Notizen auflisten, lesen, suchen (nur MCP)', group: 'notes' },
  { id: 'notes:create', label: 'Anlegen', chip: 'Notizen anlegen', hint: 'Nur neue Notizen anlegen (nur MCP)', group: 'notes' },
  { id: 'webhook:triage', label: 'Inbox füllen', chip: 'Inbox', hint: 'Gedanken in die Inbox einliefern', group: 'inbox' },
];
export const SCOPE_GROUPS: [ScopeGroup, string][] = [
  ['tasks', '📋 Aufgaben'],
  ['lists', '🛒 Listen'],
  ['notes', '🗒️ Notizen'],
  ['inbox', '📥 Inbox'],
];
export const scopeChip = (id: string) => SCOPES.find((s) => s.id === id)?.chip || id;
