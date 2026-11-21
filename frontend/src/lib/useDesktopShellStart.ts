import { useSyncExternalStore } from 'react';

// A server's page shown in the desktop app's window: the app names its start view in
// window.__msDesktopShell once the page has loaded (desktop/main.go, shellMarker) and fires
// mindsift:desktop-shell. The login page and the profile menu then offer "Switch instance", which loads the
// start view on the app's own origin, as the tray and Ctrl+Shift+O do. Only the app's two start view
// addresses count, so nothing else can be put there to send the page elsewhere.
const START_ADDRESSES = ['wails://localhost/__desktop/start', 'http://wails.localhost/__desktop/start'];

export const desktopShellStart = (): string | null => {
  const v = typeof window === 'undefined' ? undefined : window.__msDesktopShell;
  return typeof v === 'string' && START_ADDRESSES.includes(v) ? v : null;
};

const subscribe = (onChange: () => void) => {
  window.addEventListener('mindsift:desktop-shell', onChange);
  return () => window.removeEventListener('mindsift:desktop-shell', onChange);
};

// The start view's address while this page is a server's page in the desktop app, else null
export function useDesktopShellStart(): string | null {
  return useSyncExternalStore(subscribe, desktopShellStart, () => null);
}

export const openDesktopShellStart = (address: string): void => window.location.assign(address);
