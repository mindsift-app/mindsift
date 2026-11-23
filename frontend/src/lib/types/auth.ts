// Accounts: sign-in and setup, the person and their invites, sessions, second factors, API keys, OAuth, own themes.

import type { Capabilities } from '../capabilities';
import type { ServerTime, SharingMode } from './admin';
import type { Retention } from './data';
import type { NotificationSettings } from './notifications';
import type { VoiceMode } from './voice';

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
