export type ThoughtStatus = 'inbox' | 'kept' | 'discarded' | 'converted';
export type PriorityLevel = 'low' | 'normal' | 'high' | 'urgent';
export type UserRole = 'admin' | 'member';

export type RegistrationMode = 'closed' | 'approval' | 'domain' | 'domain+approval' | 'open';

export interface AuthStatus {
  needsSetup: boolean;
  allowRegistration: boolean;
  // Registering without an invite and the e-mail domains of the domain modes (hint on the form)
  registrationMode?: RegistrationMode;
  registrationDomains?: string[];
  // New accounts confirm their e-mail address by link first
  emailVerification?: boolean;
  instanceName: string;
  demoMode?: boolean;
  sharingMode?: SharingMode;
  // "Passwort vergessen?" works (SMTP and BASE_URL configured)
  passwordReset?: boolean;
  // AI agents may connect over MCP (the operator can switch it off)
  mcpEnabled?: boolean;
  // MCP address for claude.ai / ChatGPT connectors (OAuth); empty when the server has no BASE_URL
  mcpConnectorUrl?: string;
  // The server's default language (login screen, people without own choice and unknown browser language)
  defaultLanguage?: string;
  // Demo mode with periodic reset: next reset (ISO) and seconds until then
  demoNextReset?: string;
  demoResetInSeconds?: number;
  demoResetMinutes?: number;
  // Impressum / Datenschutz of this instance (LEGAL_* environment variables)
  legal?: {
    imprintUrl?: string;
    hasImprintContent?: boolean;
    privacyUrl?: string;
    hasPrivacyContent?: boolean;
    customLinkLabel?: string;
    customLinkUrl?: string;
  };
  // Voice input: own Whisper server, the browser's recognition, or switched off (STT_* environment)
  voice?: { mode: VoiceMode; maxSeconds: number; browserAllowed?: boolean };
}

export type VoiceMode = 'server' | 'browser' | 'off';

// Admin view of the speech recognition (read-only, configured by environment)
export interface VoiceAdminStatus {
  mode: VoiceMode;
  demo: boolean;
  url?: string;
  model?: string;
  language?: string;
  apiKeySet?: boolean;
  maxSeconds: number;
  maxUploadMb: number;
  maxParallel: number;
  perUserPerHour: number;
  timeoutSeconds: number;
  status?: { reachable: boolean; modelReady: boolean; error?: string; checkedAt?: string };
}

// Who can see whom: nobody, members of the same organization, or everybody (Doku/sharing-and-permissions.md)
export type SharingMode = 'private' | 'organizations' | 'open';

export interface NotificationChannelRouting {
  email: boolean;
  discord: boolean;
  webhook: boolean;
  push: boolean;
}

export interface NotificationEvents {
  due: NotificationChannelRouting;
  shared: NotificationChannelRouting;
  taskDone: NotificationChannelRouting;
  watched: NotificationChannelRouting;
}

export interface DailySummarySettings {
  enabled: boolean;
  time: string;
  email: boolean;
  discord: boolean;
  webhook: boolean;
  push: boolean;
}

/** A browser or installed app that receives web push */
export interface PushDevice {
  id: number;
  endpoint: string;
  device: string;
  createdAt: string;
}

export interface NotificationSettings {
  paused: boolean;
  includeOwnWatched: boolean;
  events: NotificationEvents;
  dailySummary: DailySummarySettings;
}

export interface User {
  id: string;
  email: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  isActive: boolean;
  // Registered and waiting for an admin's approval (admin user list)
  pendingApproval?: boolean;
  // Registered, e-mail address not confirmed yet (admin user list)
  emailUnverified?: boolean;
  alarmChannels?: string[];
  alarmEmail?: string;
  discordWebhookUrl?: string;
  customWebhookUrl?: string;
  notifyBeforeMinutes?: number;
  notificationSettings?: NotificationSettings;
  // Completed tasks are deleted this many days after ticking them off (0 = never)
  doneRetentionDays?: number;
  // Voice input: '' = the server's Whisper (default), 'browser' = the browser's recognition
  voiceInput?: '' | 'browser';
  // Language of the app: a code from LANGUAGES (i18n/index.ts), or '' to follow the browser
  language?: string;
  // How long finished and deleted things are kept, in days (0 = for good; only when allowed)
  retention?: Retention;
  retentionNeverAllowed?: boolean;
  organizationId?: string;
  createdAt: string;
}

export interface UserInvite {
  id: string;
  code: string;
  email?: string;
  role: UserRole;
  organizationId?: string;
  organizationName?: string;
  createdBy: string;
  usedBy?: string;
  createdAt: string;
  expiresAt: string;
  // A link for several people: allowed and used redemptions
  maxUses: number;
  useCount: number;
}

export interface SubTask {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt?: string;
  // Note checkbox this subtask is tied to (its task is linked to a note); kept by the server
  blockId?: string;
}

// Repeat rule of a task: completing it creates the next one (due date one interval later)
export type Recurrence = '' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export const RECURRENCE_LABELS: Record<Exclude<Recurrence, ''>, string> = {
  daily: 'täglich',
  weekly: 'wöchentlich',
  monthly: 'monatlich',
  yearly: 'jährlich',
};

// Which API key created an entry and which one changed it last, over which access (REST "api" or
// "mcp"). Stays for good; key names come resolved from the server.
export interface Origin {
  createdVia?: 'api' | 'mcp';
  createdKey?: string;
  changedVia?: 'api' | 'mcp';
  changedKey?: string;
  changedAt?: string;
}

export interface Thought {
  id: string;
  userId: string;
  content: string;
  tags: string[];
  priority: PriorityLevel;
  source: 'manual' | 'voice' | 'webhook' | 'agent';
  status: ThoughtStatus;
  isCompleted: boolean;
  convertedType?: 'task' | 'document' | 'list_item' | 'document_block';
  convertedRefId?: string;
  docId?: string;
  blockId?: string;
  dueDate?: string;
  taskListId?: string;
  kanbanStatus?: string;
  notes?: string;
  subtasks?: SubTask[];
  assignees?: string[]; // user IDs, only people with access to the task list
  recurrence?: Recurrence;
  isWatching?: boolean;
  alarmSent?: boolean;
  sortOrder?: number;
  createdAt: string;
  triagedAt?: string;
  origin?: Origin;
}

export interface KanbanColumn {
  id: string;
  name: string;
  color?: string;
  isDone?: boolean;
}

export interface TaskListShare {
  id: string;
  taskListId: string;
  targetType: 'team' | 'user';
  targetId: string;
  targetName?: string;
  email?: string;
  avatarUrl?: string;
  permission?: 'editor' | 'viewer';
  createdAt: string;
}

export interface TaskListMember {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  role: string;
}

export interface TaskList {
  id: string;
  userId: string;
  spaceId?: string;
  spaceName?: string;
  ownerId?: string;
  ownerName?: string;
  isOwner?: boolean;
  permission?: 'owner' | 'editor' | 'viewer';
  members?: TaskListMember[];
  shares?: TaskListShare[];
  columns?: KanbanColumn[];
  title: string;
  icon: string;
  color: string;
  tasksCount?: number;
  createdAt: string;
  updatedAt: string;
}

// Defined by server admins; every user belongs to at most one
export interface Organization {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface Team {
  id: string;
  orgId?: string;
  name: string;
  description: string;
  members?: TeamMember[];
  createdAt: string;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface SystemSettings {
  sharingMode: SharingMode;
  allowRegistration: boolean;
  instanceName: string;
  smtpHost?: string;
  smtpPort?: string; // sent as text, like the server stores it
  smtpUser?: string;
  smtpPass?: string; // write only: the server never sends it back, empty keeps the stored one
  smtpPassSet?: boolean;
  smtpFrom?: string;
  smtpFromName?: string; // display name when smtpFrom is a bare address (empty = MindSift)
  smtpTls?: boolean;
  smtpSkipVerify?: boolean;
  allowPrivateWebhooks?: boolean; // alarm webhooks may reach the LAN (and plain http)
  smtpConfiguredViaEnv?: boolean;
  registrationMode?: RegistrationMode;
  registrationDomains?: string;
  // REGISTRATION_MODE / REGISTRATION_DOMAINS (or ALLOW_REGISTRATION=true) fix it: shown, not editable
  registrationConfiguredViaEnv?: boolean;
  registrationVerifyEmail?: boolean;
  registrationVerifyConfiguredViaEnv?: boolean;
  // Mails with links can go out (mail server and BASE_URL configured)
  emailLinksAvailable?: boolean;
  // Automatic backups: daily time (HH:MM, server time zone) and days to keep them
  backupEnabled?: boolean;
  backupTime?: string;
  backupRetentionDays?: number;
  // People may keep finished and deleted things for good ("nie"); fixed when set via RETENTION_ALLOW_NEVER
  retentionAllowNever?: boolean;
  retentionNeverViaEnv?: boolean;
  // AI agents may connect over MCP (and claude.ai / ChatGPT over OAuth); fixed when set via MCP_ENABLED
  mcpEnabled?: boolean;
  mcpConfiguredViaEnv?: boolean;
  // Language for new accounts and everyone whose browser language the app does not speak
  defaultLanguage?: string;
}

/** One file of a server backup listing. */
export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

/** Parts of the own data a backup can be restored for. */
export type DataSection = 'notes' | 'tasks' | 'lists' | 'inbox' | 'themes';
export const DATA_SECTIONS: { id: DataSection; label: string }[] = [
  { id: 'notes', label: 'Notizen' },
  { id: 'tasks', label: 'Aufgaben' },
  { id: 'lists', label: 'Listen' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'themes', label: 'Themes' },
];

export type BlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'text' | 'todo' | 'bullet' | 'numbered' | 'code' | 'callout' | 'divider' | 'table' | 'progress' | 'image' | 'audio';

export interface DocumentBlock {
  id: string;
  docId?: string;
  documentId?: string;
  taskId?: string;
  // Checkbox tied to a subtask of this task (the task itself is linked to another checkbox)
  subtaskOf?: string;
  type: BlockType;
  content: string;
  checked?: boolean;
  lang?: string;
  level?: number;
  position?: number;
  collapsed?: boolean;
  sortOrder?: number;
  updatedAt?: string;
  conflictOf?: string; // set on conflict copies: ID of the contested block, or 'title'
  conflictAuthor?: string;
}

export interface DocBlocksPatchRequest {
  upserted?: DocumentBlock[];
  deletedIds?: string[];
  blockOrder?: string[];
}

export interface DocBlocksPatchEvent {
  docId: string;
  updatedBy: string;
  updatedAt: string;
  upserted?: DocumentBlock[];
  deletedIds?: string[];
  blockOrder?: string[];
}

export interface DocShare {
  id: string;
  docId: string;
  targetType?: 'user' | 'team';
  targetId?: string;
  targetName?: string;
  teamId?: string;
  userId?: string;
  userEmail?: string;
  displayName?: string;
  permission: 'read' | 'write';
  createdBy: string;
  createdAt: string;
}

/** A note linking to the current one via [[Title]] (GET /documents/{id}/backlinks). */
export interface Backlink {
  docId: string;
  title: string;
  icon: string;
  folderPath: string;
  blocks: { id: string; content: string }[];
  more?: number;
}

/** A note in the trash (GET /documents/trash). */
/** A day of the own journal; `empty` while its note has no text yet. */
export interface JournalDay {
  date: string; // YYYY-MM-DD
  docId: string;
  empty: boolean;
}

/** Delays in days per area (Kontoeinstellungen → Aufbewahrung); 0 = keep for good. */
export interface Retention {
  doneTasks: number;
  taskTrash: number;
  triageTrash: number;
  noteTrash: number;
  listDone: number;
}

/** A deleted task waiting in the task trash. */
export interface TrashedTask {
  id: string;
  content: string;
  taskListId: string;
  isCompleted: boolean;
  trashedAt: string;
  trashedBy: string;
  canEdit: boolean;
}

// A note in the trash, or a deleted folder (kind "folder": id of the trashed folder, title its name,
// folderPath where it was, noteCount the notes it holds)
export interface TrashedDocument {
  id: string;
  kind?: 'note' | 'folder';
  title: string;
  icon: string;
  folderPath: string;
  deletedAt: string;
  isOwner: boolean;
  noteCount?: number;
}

export interface Document {
  id: string;
  userId: string;
  spaceId?: string;
  title: string;
  icon: string;
  folderId?: string;
  markdownCache?: string;
  content: string;
  blocks: DocumentBlock[];
  tags: string[];
  folderPath?: string;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;

  // Collaboration & Permissions
  permission?: 'owner' | 'write' | 'read';
  isOwner?: boolean;
  ownerName?: string;
  sharedWith?: DocShare[];
  sharedFolderId?: string;
  subFolderPath?: string;
  isSharedFolder?: boolean;
  folderPermission?: string;
}

export interface SharedFolder {
  id: string;
  ownerId: string;
  ownerName?: string;
  name: string;
  mountPath: string;
  isOwner: boolean;
  permission: 'owner' | 'write' | 'read';
  shares?: FolderShare[];
  createdAt: string;
  updatedAt: string;
}

export interface FolderShare {
  id: string;
  folderId: string;
  targetType: 'user' | 'team';
  targetId: string;
  targetName?: string;
  email?: string;
  avatarUrl?: string;
  permission: 'read' | 'write';
  createdBy: string;
  createdAt: string;
}

export interface TagSummary {
  tag: string;
  count: number;
}

export interface MatchedTagBlock {
  rootBlock: DocumentBlock;
  children: DocumentBlock[];
}

export interface TagDocumentGroup {
  docId: string;
  title: string;
  icon: string;
  folderPath: string;
  updatedAt: string;
  isOwner: boolean;
  permission: 'owner' | 'write' | 'read';
  ownerName?: string;
  matchedBlocks: MatchedTagBlock[];
}

export interface TagDetails {
  tag: string;
  noteContent?: string;
  noteUpdatedAt?: string;
  documents: TagDocumentGroup[];
  totalMatches: number;
}

export interface SearchHit {
  type: 'document' | 'thought' | 'list_item';
  id: string;
  title: string;
  snippet: string;
  score?: number;
  docId?: string;
  blockId?: string;
  listId?: string;
  icon?: string;
  // Bullets: the bullet before and after, for context
  before?: string;
  after?: string;
}

/** Narrowing of the global search (GET /search); empty fields do not filter. */
export interface SearchFilter {
  type?: 'document' | 'thought' | 'list_item';
  limit?: number;
  taskStatus?: 'open' | 'done';
  taskListId?: string; // 'personal' = without list
  priority?: string;
  due?: 'today' | 'overdue' | 'week';
  folder?: string;
  listId?: string;
  itemStatus?: 'open' | 'done';
}

export interface SearchResults {
  thoughts: Thought[];
  documents: Document[];
  listItems: ListItem[];
  hits: SearchHit[];
  counts?: Partial<Record<'document' | 'thought' | 'list_item', number>>;
}

export interface SpaceMember {
  spaceId: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string;
}

export interface UnifiedShare {
  id: string;
  targetType: 'team' | 'user';
  targetId: string;
  targetName?: string;
  targetEmail?: string;
  avatarUrl?: string;
  permission?: 'editor' | 'viewer';
  role?: string;
  createdBy?: string;
  createdAt: string;
}

export interface SpaceShare {
  id: string;
  spaceId: string;
  targetType: 'team' | 'user';
  targetId: string;
  targetName?: string;
  role: 'editor' | 'viewer';
  createdBy?: string;
  createdAt: string;
}

export interface Space {
  id: string;
  name: string;
  icon: string;
  description: string;
  inviteCode: string;
  isPersonal: boolean;
  ownerId: string;
  ownerName?: string;
  members?: SpaceMember[];
  shares?: SpaceShare[];
  listsCount: number;
  createdAt: string;
}

export interface ListItem {
  id: string;
  listId: string;
  content: string;
  category?: string;
  quantity?: string;
  isCompleted: boolean;
  completedBy?: string;
  completedByName?: string;
  createdBy?: string;
  createdByName?: string;
  sortOrder: number;
  createdAt: string;
  completedAt?: string;
  origin?: Origin;
}

export interface ListShare {
  id: string;
  listId: string;
  targetType: 'team' | 'user';
  targetId: string;
  targetName?: string;
  targetEmail?: string;
  role: 'editor' | 'viewer';
  createdBy?: string;
  createdAt: string;
}

export interface SharedList {
  id: string;
  userId?: string;
  ownerName?: string;
  isOwner?: boolean;
  role?: string;
  spaceId?: string;
  title: string;
  icon: string;
  listType: 'shopping' | 'checklist' | 'vacation';
  items: ListItem[];
  shares?: ListShare[];
  members?: TaskListMember[]; // owner + everyone the list is shared with
  updatedAt: string;
  createdAt: string;
}

// Result of an import preview (applied = false) or of the import itself
export interface ImportSummary {
  folders: number;
  notes: number;
  taskLists: number;
  tasks: number;
  lists: number;
  listItems: number;
  inbox: number;
  themes?: number;
  skipped: { path: string; reason: string }[];
  applied: boolean;
}

// Custom CSS theme of the current user (Benutzereinstellungen > Darstellung)
export interface UserTheme {
  id: string;
  name: string;
  css: string;
  createdAt: string;
  updatedAt: string;
}

/** What an API key may do: webhook:* delivers data, the agent scopes read and change tasks/lists; notes only over MCP. */
export type ApiKeyScope =
  | 'webhook:triage'
  | 'webhook:task'
  | 'webhook:list'
  | 'tasks:read'
  | 'tasks:write'
  | 'lists:read'
  | 'lists:write'
  | 'notes:read'
  | 'notes:create'
  | 'notes:write'
  | 'inbox:read'
  | 'inbox:write';

export interface APIKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  rawKey?: string;
  scopes: string; // comma separated ApiKeyScope values
  lastUsedAt?: string;
  createdAt: string;
  // 'oauth': a connection agreed to on the consent page (claude.ai, ChatGPT), no secret to show
  kind?: 'key' | 'oauth';
}

// What the consent page (/oauth/authorize) shows; redirect alone means "go back to the client"
export interface OAuthAuthorizeInfo {
  redirect?: string;
  clientName?: string;
  redirectHost?: string;
  scopes?: ApiKeyScope[];
  offeredScopes?: ApiKeyScope[];
}

export interface DashboardStats {
  inboxCount: number;
  tasksOpenCount: number;
  tasksDoneCount: number;
  docsCount: number;
  docsTodosOpenCount?: number;
  listItemsOpenCount?: number;
  listsCount: number;
  discardedCount: number;
}

export interface WSMessage<T = any> {
  event: string;
  space_id?: string;
  list_id?: string;
  listId?: string;
  payload: T;
  timestamp: string;
}

// A logged-in device (Profil & Sicherheit)
export interface Session {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string;
  ip: string;
  current: boolean;
}

// Answer of merging two notes; kept by the client to undo it
export interface MergeResult {
  targetId: string;
  sourceId: string;
  sourceTitle: string;
  headingId: string;
}
