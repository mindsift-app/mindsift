// Administration: server settings, mail, legal pages, sign-in providers, updates, audit log, statistics.

import type { RegistrationMode } from './auth';
import type { SpeechSettings } from './voice';

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
