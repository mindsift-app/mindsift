/// <reference types="vite/client" />
declare module 'prismjs/components/*';

// The browser's offer to install the app (Chromium; not in TypeScript's DOM types)
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

interface Window {
  // The install offer when it came before the app was ready (public/pwa-install.js)
  __deferredPwaPrompt?: BeforeInstallPromptEvent | null;
  // A server's page in the desktop app's window: the address of the app's start view, set by the app
  // (desktop/main.go, shellMarker; lib/useDesktopShellStart.ts)
  __msDesktopShell?: unknown;
}

interface Navigator {
  // iOS Safari: started from the home screen
  readonly standalone?: boolean;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
  // The page reloads for a new version: editors hand over text still waiting in a typing pause (lib/appReload.ts)
  'mindsift:flush-edits': Event;
  // The desktop app set window.__msDesktopShell (after the page loaded)
  'mindsift:desktop-shell': Event;
}
