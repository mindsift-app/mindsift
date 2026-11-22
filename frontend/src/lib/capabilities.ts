import { useSyncExternalStore } from 'react';

// What this instance offers, as the server decides it in one place (internal/api/capabilities.go) and sends
// with every /auth/status. The app asks these instead of "am I the desktop app?": the desktop app is just an
// instance that switches several off, and a server switches some off too (sharing mode private,
// SMTP_DISABLED …). isDesktopApp() stays for the app's own shell only (start view, switching instances,
// the local API, its setup wizard, the backup folder); a test keeps it there (capabilityGuard.test.ts).
export type Capability =
  // Several accounts: registration, invites, the administration's people, organizations, roles, login names
  | 'accounts'
  // People sign in and out: passwords, a second factor, devices, the own address
  | 'signIn'
  // Sharing with others: share buttons, groups, assignees, mentions, muting shared lists
  | 'sharing'
  // The instance may send mail at all (e-mail alarms, invite mails)
  | 'email'
  // Web push to browsers and installed apps
  | 'push'
  // Signing in with a passkey
  | 'passkeys'
  // Notes shareable by a public link
  | 'publicLinks'
  // Others reach the instance at an address: calendar feeds, connectors from claude.ai or ChatGPT, Home
  // Assistant, the imprint and privacy notice
  | 'publicAddress'
  // Drawing together live (WebSocket)
  | 'liveDrawing'
  // Running in a browser: installable as an app, working offline
  | 'install'
  // Alarms as notifications of the operating system (a local instance of the desktop app), in place of web push
  | 'desktopNotify'
  // The administration restores the whole instance from a backup (the server can reopen its data)
  | 'restore';

export type Capabilities = Record<Capability, boolean>;

// Until the first status arrives: what a server offers by default
const SERVER_DEFAULTS: Capabilities = {
  accounts: true,
  signIn: true,
  sharing: true,
  email: true,
  push: true,
  passkeys: true,
  publicLinks: true,
  publicAddress: true,
  liveDrawing: true,
  install: true,
  desktopNotify: false,
  restore: false,
};

let current: Capabilities = SERVER_DEFAULTS;
const listeners = new Set<() => void>();

// From /auth/status (lib/api/auth.ts); what the status leaves out counts as a server's default (on, but
// desktopNotify and restore off: an older server does not know them)
export function setCapabilities(caps: Partial<Capabilities> | undefined) {
  current = { ...SERVER_DEFAULTS, ...caps };
  listeners.forEach((listener) => listener());
}

// Outside components and in handlers; components that must follow a change use useCapabilities
export const can = (capability: Capability): boolean => current[capability];

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useCapabilities(): Capabilities {
  return useSyncExternalStore(subscribe, () => current);
}
