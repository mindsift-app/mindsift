import i18n from '../i18n';
import type { Capabilities } from './capabilities';

export type ThoughtStatus = 'inbox' | 'kept' | 'discarded' | 'converted';
export type PriorityLevel = 'low' | 'normal' | 'high' | 'urgent';
// Server roles: admin runs everything, manager ("Benutzerverwaltung") looks after members, invites and
// organizations, member is everyone else
export type UserRole = 'admin' | 'manager' | 'member';

export type RegistrationMode = 'closed' | 'approval' | 'domain' | 'domain+approval' | 'open';

// What the setup wizard tells beside its questions (GET /admin/setup/status; in AuthStatus.setup while the
// server has no account yet)
export interface SetupInfo {
  // A mail server is set: by SMTP_HOST (smtpViaEnv) or in the administration
  smtpConfigured: boolean;
  smtpViaEnv: boolean;
  smtpHost?: string; // admins only
  // BASE_URL is set: mails can carry links (password reset, address confirmation)
  baseUrlSet: boolean;
  emailLinks: boolean;
  // Folder of the daily backups on the server
  backupDir: string;
  // The zone in effect and the one without the setting (TZ, else UTC); older servers leave it out
  serverTime?: ServerTime;
}

// Desktop mode of the server (AuthStatus.desktop): the platform and the realtime transport of the window
// (Linux streams server-sent events, Windows' webview buffers responses, so long polling there)
export interface DesktopInfo {
  platform: 'linux' | 'windows';
  realtime: 'sse' | 'poll';
}

export interface AuthStatus {
  needsSetup: boolean;
  // The wizard asks for the one-time setup code the server wrote to its log (not in the demo, not with ADMIN_USER)
  setupCodeRequired?: boolean;
  // Only while needsSetup: mail server, BASE_URL and backup folder for the first-boot wizard
  setup?: SetupInfo;
  allowRegistration: boolean;
  // Registering without an invite and the e-mail domains of the domain modes (hint on the form)
  registrationMode?: RegistrationMode;
  registrationDomains?: string[];
  // New accounts confirm their e-mail address by link first
  emailVerification?: boolean;
  instanceName: string;
  demoMode?: boolean;
  // The server runs inside the desktop app: one account, no sign-in (POST /auth/desktop gives the session),
  // nothing that needs other people or a public address; realtime is the transport the window can use
  desktop?: DesktopInfo;
  // What this instance offers (lib/capabilities.ts, internal/api/capabilities.go)
  capabilities?: Partial<Capabilities>;
  sharingMode?: SharingMode;
  // "Passwort vergessen?" works (SMTP and BASE_URL configured)
  passwordReset?: boolean;
  // Sign-in through an OpenID Connect provider ("Mit <name> anmelden"); passwordLogin false: only that button,
  // the password form stays for administrators at /?login=password (emergency access)
  oidc?: { enabled: boolean; name: string };
  passwordLogin?: boolean;
  // Passkeys work on this server (BASE_URL with https, not the demo): "Mit Passkey anmelden"
  passkeys?: boolean;
  // AI agents may connect over MCP (the operator can switch it off)
  mcpEnabled?: boolean;
  // API keys on the REST API (API_KEYS_ENABLED); false: keys only work for MCP
  restApiKeys?: boolean;
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
  voice?: { mode: VoiceMode; maxSeconds: number; browserAllowed?: boolean; chunked?: boolean; chunkSeconds?: number };
  // Sharing: names are suggested while typing (else exact e-mail or username); notes can be shared by
  // public link, for at most publicLinkMaxDays
  peopleSearch?: boolean;
  publicLinks?: boolean;
  publicLinkMaxDays?: number;
  // Preview cards for web addresses in notes (the administration can switch them off; off in the demo)
  linkPreviews?: boolean;
  // How strongly the app compresses pictures before upload (administration or MEDIA_IMAGE_QUALITY)
  imageQuality?: 'high' | 'medium' | 'low' | 'off';
  // Audio in notes: recordings at bitrate kbit/s unless compression is off; every audio file up to
  // limitMB; files from the device only while uploads is on
  audio?: { compression: 'recordings' | 'off'; bitrate: number; limitMB: number; uploads: boolean };
  // Images in notes: new ones allowed at all, copies from other addresses, the largest one in MB
  images?: { enabled: boolean; external: boolean; limitMB: number };
}

export type VoiceMode = 'server' | 'browser' | 'off';

// Admin view of the sign-in through an OpenID Connect provider (OIDC_* environment, read only)
export interface OidcAdminStatus {
  configured: boolean;
  enabled: boolean;
  // Why it is off although configured: no_base_url, demo
  reason?: string;
  name?: string;
  issuer?: string;
  clientId?: string;
  redirectUrl?: string;
  // Back-channel logout URL to enter at the provider; empty while that is off
  logoutUrl?: string;
  scopes?: string;
  adminGroup?: string;
  autoCreate: boolean;
  passwordLogin: boolean;
  reachable?: boolean;
  error?: string;
  linkedUsers: number;
}

// Admin view of the speech recognition (read-only, configured by environment)
// Imprint, privacy notice and the footer's own link (Administration → Server); configuredViaEnv names
// the fields LEGAL_* fixes: imprintUrl, imprintContent, privacyUrl, privacyContent, customLink
export interface LegalSettings {
  imprintUrl: string;
  imprintContent: string;
  privacyUrl: string;
  privacyContent: string;
  customLinkLabel: string;
  customLinkUrl: string;
  configuredViaEnv?: string[];
}

// Voice input (Administration → Voice input & AI). apiKey is only ever sent, never received (apiKeySet);
// configuredViaEnv names the fields STT_* fixes (mode, allowBrowser, url, apiKey, model, maxSeconds,
// maxUploadMb, maxParallel, perUserPerHour, timeoutSeconds, vadFilter, chunked, chunkSeconds)
export interface SpeechSettings {
  mode: '' | 'server' | 'browser' | 'off';
  allowBrowser?: boolean;
  url: string;
  apiKey?: string;
  apiKeySet?: boolean;
  apiKeyUnreadable?: boolean;
  clearApiKey?: boolean;
  model: string;
  maxSeconds?: number;
  maxUploadMb?: number;
  maxParallel?: number;
  perUserPerHour?: number;
  timeoutSeconds?: number;
  vadFilter?: boolean;
  // the app sends a recording in pieces while speaking (default on), each at most chunkSeconds long
  chunked?: boolean;
  chunkSeconds?: number;
  configuredViaEnv?: string[];
}

// The models of the Whisper server (GET /admin/voice/models): known and downloaded ones, the one in use,
// downloads under way (speaches tells no progress: running, done or the error)
export interface SpeechModelDownload {
  model: string;
  startedAt: string;
  finishedAt?: string;
  running: boolean;
  error?: string;
}

export interface SpeechModelsInfo {
  model: string;
  reachable: boolean;
  error?: string;
  models: { id: string; sizeMb?: number; downloaded: boolean }[];
  downloads: SpeechModelDownload[];
}

export interface VoiceAdminStatus {
  mode: VoiceMode;
  demo: boolean;
  url?: string;
  model?: string;
  apiKeySet?: boolean;
  maxSeconds: number;
  maxUploadMb: number;
  maxParallel: number;
  perUserPerHour: number;
  timeoutSeconds: number;
  status?: { reachable: boolean; modelReady: boolean; error?: string; checkedAt?: string };
}

// Admin: the daily look for a new MindSift release (GET /admin/update)
export interface UpdateStatus {
  enabled: boolean;
  // Why there is no check: UPDATE_CHECK=false, the demo, or a build that is no release
  reason?: 'off' | 'demo' | 'devBuild';
  current: string;
  latest?: string;
  url?: string;
  publishedAt?: string;
  checkedAt?: string;
  available: boolean;
  dismissed: boolean;
}

// Who can see whom: nobody, members of the same organization, or everybody (Doku/sharing-and-permissions.md)
export type SharingMode = 'private' | 'organizations' | 'open';

export interface NotificationChannelRouting {
  email: boolean;
  discord: boolean;
  webhook: boolean;
  push: boolean;
  /** A notification of the operating system, shown by the desktop app's local instances (capability desktopNotify) */
  desktop: boolean;
}

export interface NotificationEvents {
  due: NotificationChannelRouting;
  shared: NotificationChannelRouting;
  assigned: NotificationChannelRouting;
  mentioned: NotificationChannelRouting;
  taskCreated: NotificationChannelRouting;
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
  desktop: boolean;
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

// An entry of the notification center (bell); a click leads to its target
export interface CenterEntry {
  id: number;
  kind: 'due' | 'shared' | 'assigned' | 'mentioned' | 'taskCreated' | 'taskDone' | 'watched' | string;
  title: string;
  text: string;
  targetType?: 'task' | 'note' | 'list' | 'tasklist' | 'folder';
  targetId?: string;
  blockId?: string;
  createdAt: string;
  read: boolean;
  // Only in NOTIFICATION: the ids of the entries this one replaced (a watched task keeps one entry)
  replaces?: number[];
}

// A person the @-mention picker offers; without access to the place they are shown greyed out
export interface MentionCandidate {
  id: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  hasAccess: boolean;
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
  mfaEnabled?: boolean; // signs in with a second factor (only in the administration's user list)
  alarmChannels?: string[];
  // New login / alarm address waiting for the click on the link mailed to it (own profile)
  pendingEmail?: string;
  // The server can mail confirmation links at all (own profile)
  emailLinks?: boolean;
  // Signs in through the OIDC provider: noPassword has no password of its own (own profile and the
  // administration's user list), oidc is linked (own profile only)
  noPassword?: boolean;
  oidc?: boolean;
  // A reset by the administration asked for a new own password at the next sign-in (own profile and the
  // administration's user list)
  mustChangePassword?: boolean;
  discordWebhookUrl?: string;
  customWebhookUrl?: string;
  notifyBeforeMinutes?: number;
  notificationSettings?: NotificationSettings;
  // Completed tasks are deleted this many days after ticking them off (0 = never)
  doneRetentionDays?: number;
  // Voice input: '' = the server's Whisper (default), 'browser' = the browser's recognition
  voiceInput?: '' | 'browser';
  // Language spoken into the microphone: '' = app language, 'auto' = Whisper detects it, else a code
  // from WHISPER_LANGUAGES (lib/voiceLanguages.ts)
  voiceLanguage?: string;
  // Language of the app: a code from LANGUAGES (i18n/index.ts), or '' to follow the browser
  language?: string;
  // How long finished and deleted things are kept, in days (0 = for good; only when allowed)
  retention?: Retention;
  retentionNeverAllowed?: boolean;
  // Organizations the person belongs to (admin user list)
  organizationIds?: string[];
  // Own organizations with names (own profile, to pick one for a new group)
  organizations?: { id: string; name: string }[];
  // Own profile only (GET /auth/me): the app already asked about the guided tour (features/tour/tourOffer.ts)
  tourOffered?: boolean;
  // Own profile only: the app reads due dates and quantities from typed text (lib/typedRecognition.ts); missing = on
  typedRecognition?: boolean;
  // In the directory: the viewer may share with this person (others only show by name, because they work
  // on something together with the viewer)
  findable?: boolean;
  createdAt: string;
}

export interface UserInvite {
  id: string;
  code: string;
  email?: string;
  // Always member: invites never make admins
  role: UserRole;
  // Organizations the new account joins
  organizationIds?: string[];
  organizationNames?: string[];
  createdBy: string;
  usedBy?: string;
  createdAt: string;
  expiresAt: string;
  // Used up or expired: when the invite disappears from the list
  removeAt?: string;
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

// Repeat rule of a task: completing it creates the next one (due date in the rhythm of the old one, after the day it was done)
export type Recurrence = '' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

// Texts in common:recurrence.<rule>, in the language shown when read
export const RECURRENCE_LABELS: Record<Exclude<Recurrence, ''>, string> = {
  get daily() {
    return i18n.t('common:recurrence.daily');
  },
  get weekdays() {
    return i18n.t('common:recurrence.weekdays');
  },
  get weekly() {
    return i18n.t('common:recurrence.weekly');
  },
  get monthly() {
    return i18n.t('common:recurrence.monthly');
  },
  get yearly() {
    return i18n.t('common:recurrence.yearly');
  },
};

// Which API key created an entry and which one changed it last, over which access (REST "api" or
// "mcp"). Stays for good; key names come resolved from the server.
export interface Origin {
  createdVia?: 'api' | 'mcp';
  createdKey?: string;
  changedVia?: 'api' | 'mcp';
  changedKey?: string;
  changedAt?: string;
  // The key was deleted since
  createdKeyDeleted?: boolean;
  changedKeyDeleted?: boolean;
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
  // Minutes before the due date, replacing each person's lead time; empty = the lead time
  reminders?: number[];
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

// A task's place after a move, as the server stored it (answer of the reorder call and TASK_REORDERED)
export interface TaskOrder {
  id: string;
  sortOrder: number;
  kanbanStatus?: string;
  isCompleted?: boolean;
}

// Answer of the reorder call: the places applied, the IDs left out (deleted or no longer in the list) and
// whether a repeating task got a successor the answer does not contain
export interface TaskReorderResult {
  success: boolean;
  items?: TaskOrder[];
  skipped?: string[];
  reload?: boolean;
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
  // I muted this shared list (no list-wide notifications from it)
  isMuted?: boolean;
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

// Defined by server admins and user managers; a person can belong to several
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

// One row of the administration's audit log (GET /admin/audit)
export interface AuditEntry {
  id: number;
  at: string;
  actorKind: 'user' | 'cli' | 'oidc' | 'system';
  actorId?: string;
  actorName?: string;
  action: string;
  targetKind?: 'user' | 'settings' | 'invite' | 'organization' | 'backup' | 'speech_model';
  targetId?: string;
  targetName?: string;
  details?: Record<string, unknown>;
  source: 'web' | 'cli' | 'oidc' | 'system';
}

export interface AuditPage {
  entries: AuditEntry[];
  nextBefore: number;
}

// The mail server as the administration and the setup wizard edit it (SmtpFields)
export type SmtpForm = Pick<
  SystemSettings,
  'smtpHost' | 'smtpPort' | 'smtpUser' | 'smtpPass' | 'smtpFrom' | 'smtpFromName' | 'smtpTls' | 'smtpSkipVerify'
>;

export interface SystemSettings {
  sharingMode: SharingMode;
  allowRegistration: boolean;
  instanceName: string;
  smtpHost?: string;
  smtpPort?: string; // sent as text, like the server stores it
  smtpUser?: string;
  smtpPass?: string; // write only: the server never sends it back, empty keeps the stored one
  smtpPassSet?: boolean;
  // A password is stored but does not decrypt (SECRETS_KEY changed): no mail until it is entered again
  smtpPassUnreadable?: boolean;
  // The password comes from SMTP_PASS (not stored) and takes precedence over one entered here
  smtpPassViaEnv?: boolean;
  // SMTP_DISABLED=true: no mail at all, the mail server is locked
  smtpDisabledViaEnv?: boolean;
  // Fixed by ALLOW_PRIVATE_WEBHOOKS / PUSH_KNOWN_SERVICES_ONLY / LINK_PREVIEWS / BACKUP_* (read only)
  allowPrivateWebhooksConfiguredViaEnv?: boolean;
  pushKnownServicesOnlyConfiguredViaEnv?: boolean;
  linkPreviewsConfiguredViaEnv?: boolean;
  backupEnabledConfiguredViaEnv?: boolean;
  backupTimeConfiguredViaEnv?: boolean;
  backupRetentionDaysConfiguredViaEnv?: boolean;
  // Complete backups carry no secrets.key (BACKUP_EXCLUDE_SECRETS_KEY or SECRETS_KEY, read only)
  backupSecretsKeyExcluded?: boolean;
  // The mail server and user SMTP_PASS belongs to (only with SMTP_PASS): the password field is locked while
  // the form names them
  smtpPassEnvHost?: string;
  smtpPassEnvUser?: string;
  smtpFrom?: string;
  smtpFromName?: string; // display name when smtpFrom is a bare address (empty = MindSift)
  smtpTls?: boolean;
  smtpSkipVerify?: boolean;
  allowPrivateWebhooks?: boolean; // alarm webhooks may reach the LAN (and plain http)
  pushKnownServicesOnly?: boolean; // web push only via the push services of the big browsers
  mfaRequired?: '' | 'admins' | 'all'; // who must sign in with a second factor
  smtpConfiguredViaEnv?: boolean;
  // The sign-in through an OIDC provider as the environment sets it (read only)
  oidc?: OidcAdminStatus;
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
  // Sharing: suggest names while typing; notes by public link and for how long at most (days, 1–14);
  // *ConfiguredViaEnv: fixed by PEOPLE_SEARCH / PUBLIC_LINKS / PUBLIC_LINKS_MAX_DAYS
  peopleSearch?: boolean;
  peopleSearchConfiguredViaEnv?: boolean;
  publicLinks?: boolean;
  publicLinksConfiguredViaEnv?: boolean;
  publicLinkMaxDays?: number;
  publicLinkMaxDaysConfiguredViaEnv?: boolean;
  // People may subscribe to their tasks in a calendar app; fixed when set via CALENDAR_FEEDS
  calendarFeeds?: boolean;
  calendarFeedsConfiguredViaEnv?: boolean;
  // The server fetches previews of web addresses in notes (off: no cards, nothing fetched; off in the demo)
  linkPreviews?: boolean;
  // How strongly the app compresses pictures before upload (size always 2048 px at most); fixed when set
  // via MEDIA_IMAGE_QUALITY; 'off' uploads pictures as they are
  imageQuality?: 'high' | 'medium' | 'low' | 'off';
  imageQualityConfiguredViaEnv?: boolean;
  // Audio in notes: recordings with audioBitrate (kbit/s) or the browser's own ('off'); every audio file
  // up to audioLimitMB; files from the device only with audioUploads. Each fixed when set via
  // MEDIA_AUDIO_COMPRESSION / MEDIA_AUDIO_BITRATE / MEDIA_MAX_AUDIO_MB / MEDIA_AUDIO_UPLOADS
  audioCompression?: 'recordings' | 'off';
  audioCompressionConfiguredViaEnv?: boolean;
  audioBitrate?: number;
  audioBitrateConfiguredViaEnv?: boolean;
  audioLimitMB?: number;
  audioLimitMBConfiguredViaEnv?: boolean;
  audioUploads?: boolean;
  audioUploadsConfiguredViaEnv?: boolean;
  legal?: LegalSettings;
  speech?: SpeechSettings;
  // Images in notes (off: no new ones), copies from other addresses, the largest image in MB, and the
  // media storage per person (0 = unlimited). Fixed when set via MEDIA_IMAGES / MEDIA_EXTERNAL_IMAGES /
  // MEDIA_MAX_IMAGE_MB / MEDIA_QUOTA_MB (external images also in the demo)
  images?: boolean;
  imagesConfiguredViaEnv?: boolean;
  externalImages?: boolean;
  externalImagesConfiguredViaEnv?: boolean;
  imageLimitMB?: number;
  imageLimitMBConfiguredViaEnv?: boolean;
  mediaQuotaMB?: number;
  mediaQuotaMBConfiguredViaEnv?: boolean;
  // Language for new accounts and everyone whose browser language the app does not speak
  defaultLanguage?: string;
  // The server's time zone (IANA name, '' = not set: TZ, else UTC) and the zone in effect now (read only)
  timeZone?: string;
  serverTime?: ServerTime;
}

/** The time zone the server works in right now (GET/PUT /admin/settings, read only). */
export interface ServerTime {
  zone: string;
  source: 'setting' | 'env' | 'default';
  now: string; // RFC 3339 with the zone's offset
  fallback: string; // the zone without the setting: TZ, else UTC
}

/** One file of a server backup listing. */
export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
  /** A full backup (database and media): a folder, downloaded as one tar archive of size bytes */
  full?: boolean;
  /** Its pictures and recordings */
  media?: number;
  /** "pre-restore": written right before a restore */
  reason?: string;
}

/** Desktop app: where the backups go; defaultDir is backups/ in the instance's folder, custom: chosen. */
export interface BackupLocation {
  // dir: where the backups go; with a chosen folder MindSift's subfolder in it (MindSift-Backups/<instance>)
  dir: string;
  defaultDir: string;
  custom: boolean;
  // chosen: the folder picked in the setup or the administration ('' = the default)
  chosen?: string;
  // chosenMissing: the chosen folder does not exist now (drive not mounted): backup runs are skipped
  chosenMissing?: boolean;
  // dirShown, chosenShown: dir and chosen as the person knows them, for showing only (under Flatpak dir and
  // chosen are paths of the document portal, /run/user/…/doc/…); what is sent back stays dir/chosen
  dirShown?: string;
  chosenShown?: string;
}

/** Desktop app: one account of a server's database snapshot, with what it owns. */
export interface SnapshotAccount {
  id: string;
  displayName: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  notes: number;
  tasks: number;
  lists: number;
  inbox: number;
}

export interface SnapshotStaged {
  token: string;
  accounts: SnapshotAccount[];
}

/** Preview or result of taking an account of a snapshot over. */
export interface SnapshotTakeOver extends ImportSummary {
  account: SnapshotAccount;
  settings: boolean;
  // Settings left out because they would not pass the account settings' checks (e.g. an alarm webhook)
  settingsSkipped?: SnapshotSkippedSetting[];
  // The account's pictures and recordings found in the backup, and those it lacks (a database snapshot alone has none)
  media?: number;
  mediaMissing?: number;
}

export type SnapshotSkippedSetting =
  | 'discordWebhookUrl'
  | 'customWebhookUrl'
  | 'language'
  | 'voiceInput'
  | 'voiceLanguage'
  | 'retention'
  | 'notifyBeforeMinutes';

/** Parts of the own data a backup can be restored for. */
export type DataSection = 'notes' | 'tasks' | 'lists' | 'inbox' | 'themes';
const dataSection = (id: DataSection) => ({
  id,
  get label() {
    return i18n.t(`common:dataSections.${id}`);
  },
});
export const DATA_SECTIONS: { id: DataSection; readonly label: string }[] = [
  dataSection('notes'),
  dataSection('tasks'),
  dataSection('lists'),
  dataSection('inbox'),
  dataSection('themes'),
];

export type BlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'text' | 'todo' | 'bullet' | 'numbered' | 'code' | 'callout' | 'warning' | 'error' | 'divider' | 'table' | 'progress' | 'image' | 'audio' | 'drawing';

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

/** A to-do with text of a note (GET /documents/todos). */
export interface DocTodo {
  docId: string;
  blockId: string;
  content: string;
  checked: boolean;
}

/** One bullet looked up by its id (GET /blocks/{id}), e.g. for a link to it. */
export interface BlockInfo {
  documentId: string;
  content: string;
  type: BlockType;
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
  // The note list (GET /documents) leaves both empty; the note itself (GET /documents/{id}) has them
  content: string;
  blocks: DocumentBlock[];
  tags: string[];
  folderPath?: string;
  isPinned: boolean;
  /** The person uses the note as one of their templates (personal, like the pin) */
  isTemplate?: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;

  // What the note list reports of the bullets instead (workspaceListing.ts noteStats)
  // Open to-dos with text
  openTodos?: number;
  // Hashtag (lower case) → number of bullets carrying it
  tagCounts?: Record<string, number>;
  // Hashtag (lower case) → number of open to-dos among the bullets carrying it
  tagOpenTodos?: Record<string, number>;

  // Collaboration & Permissions
  permission?: 'owner' | 'write' | 'read';
  isOwner?: boolean;
  ownerName?: string;
  sharedWith?: DocShare[];
  // The note has a valid public link (only set for its owner)
  hasPublicLink?: boolean;
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
  // The notes carrying the hashtag (the sidebar filters its folder tree by them)
  docIds?: string[];
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
  // Bullets: their raw text, and (with context: 1) the bullet before and after
  content?: string;
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
  // Bullets: also the text of the bullet before and after (costs the server more; large view only)
  context?: 1;
}

export interface SearchResults {
  thoughts: Thought[];
  documents: Document[];
  listItems: ListItem[];
  hits: SearchHit[];
  counts?: Partial<Record<'document' | 'thought' | 'list_item', number>>;
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

// An entry of a list's history: GET /lists/{id}/suggestions (features/lists/itemSuggestions.ts)
export interface ListItemSuggestion {
  content: string;
  category: string;
  count: number;
  lastUsed: string;
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
  // The way back leads to a known AI service or this computer; otherwise the page warns
  knownHost?: boolean;
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

export interface WSMessage<T = unknown> {
  event: string;
  space_id?: string;
  list_id?: string;
  listId?: string;
  payload: T;
  timestamp: string;
}

// A transcription the server does in the background (lib/transcriptionJobs.ts): a recording in a note
// ("note", its text becomes the caption) or one dictated into the inbox ("inbox", becomes an entry)
export interface TranscriptionJob {
  id: string;
  userId: string;
  kind: 'note' | 'inbox';
  docId?: string;
  blockId?: string;
  mediaId?: string;
  status: 'queued' | 'running' | 'failed';
  /** Why the last attempt failed: failed | timeout (also while it waits for its next attempt) */
  error?: string;
  attempts: number;
  /** Parts of an inbox recording */
  pieces?: number;
  createdAt: string;
  updatedAt: string;
}

// The end of a background transcription (TRANSCRIPTION_DONE): text is empty when nothing was heard,
// the recording is gone or the job was discarded; thoughtId names the inbox entry it became
export interface TranscriptionDone {
  id: string;
  kind: 'note' | 'inbox';
  userId: string;
  text: string;
  docId?: string;
  blockId?: string;
  thoughtId?: string;
}

// A logged-in device (Einstellungen → Sicherheit)
export interface Session {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string;
  ip: string;
  current: boolean;
}

// Two-factor sign-in (Einstellungen → Sicherheit, second step of the login)
export type MfaMethod = 'totp' | 'passkey' | 'recovery';

// Answer of POST /auth/login: a session, or the second step when the account has an authenticator app or
// a passkey (tell them apart with `'mfaToken' in res`)
export type LoginResult = { token: string; user: User } | MfaChallenge;

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  methods: MfaMethod[];
  expiresIn: number;
}

export interface MfaLoginResult {
  token: string;
  user: User;
  method: MfaMethod;
  recoveryCodesLeft: number;
  trustToken?: string;
  trustedDeviceId?: string;
}

// A device that signs in without a code until expiresAt
export interface TrustedDevice {
  id: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
}

// A passkey of the own account (Einstellungen → Sicherheit → Passkeys)
export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string; // empty: never used
  synced: boolean; // kept in a backup (password manager, iCloud, Google account)
}

// Why passkeys cannot be used on this server
export type PasskeysOff = '' | 'demo' | 'no_base_url' | 'not_https' | 'ip_address';

export interface MfaStatus {
  available: boolean; // false in the demo
  enabled?: boolean; // a second factor is on: the app or a passkey
  totp: { enabled: boolean; enabledAt: string };
  passkeys?: Passkey[];
  passkeysOff?: PasskeysOff;
  recoveryCodesLeft: number;
  trustedDevices: TrustedDevice[];
  trustDays: number;
}

// A sensitive change confirmed beside the password: a code of the app, a recovery code, or a passkey
export type SecondFactorProof = { code: string } | { passkeyToken: string; passkey: Record<string, unknown> };

// Answer of merging two notes; kept by the client to undo it
// A branch moved into another note (POST /documents/{id}/move)
export interface MoveResult {
  targetId: string;
  targetTitle: string;
  rootId: string; // the branch's bullet in the target note
  moved: Record<string, string>; // new block id in the target → block id here
}

export interface MergeResult {
  targetId: string;
  sourceId: string;
  sourceTitle: string;
  headingId: string;
}

// A note's public link as its owner sees it (GET/PUT /documents/{id}/public-link)
export interface PublicLinkState {
  enabled: boolean;
  maxDays: number;
  link: { token: string; expiresAt: string; hasPassword: boolean } | null;
}

// The own calendar subscription (GET/PUT/DELETE /calendar-feed): enabled = the server allows it,
// active = the person switched it on; url only with BASE_URL (else built from the page's origin);
// unreadable = the stored token no longer decrypts (SECRETS_KEY changed), a new link helps
export interface CalendarFeedState {
  enabled: boolean;
  active: boolean;
  token: string | null;
  url: string | null;
  createdAt?: string;
  unreadable?: boolean;
}

// Backups of an account an admin or user manager deleted, kept until removeAt
export interface DeletedAccountBackups {
  userId: string;
  displayName: string;
  email: string;
  deletedAt: string;
  removeAt: string;
  files: BackupFile[];
}
