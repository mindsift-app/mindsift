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
}

interface Navigator {
  // iOS Safari: started from the home screen
  readonly standalone?: boolean;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
  // Every realtime message, for listeners outside lib/api/realtime.ts
  'mindsift:ws': CustomEvent<import('./lib/types').WSMessage | undefined>;
}
