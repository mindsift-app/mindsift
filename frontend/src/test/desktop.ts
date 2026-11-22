import { setCurrentDesktop } from '../lib/api/client';
import { setCapabilities, type Capabilities } from '../lib/capabilities';

// What the desktop app's server reports (internal/api/capabilities.go): every capability off but the
// system notifications its shell shows
export const DESKTOP_CAPABILITIES: Capabilities = {
  accounts: false,
  signIn: false,
  sharing: false,
  email: false,
  push: false,
  passkeys: false,
  publicLinks: false,
  publicAddress: false,
  liveDrawing: false,
  install: false,
  desktopNotify: true,
};

// The desktop app as /auth/status tells it: its shell and its capabilities
export function actAsDesktopApp() {
  setCurrentDesktop({ platform: 'linux', realtime: 'sse' });
  setCapabilities(DESKTOP_CAPABILITIES);
}

// Back to a server with everything on (setup.ts does it after every test)
export function actAsServer() {
  setCurrentDesktop(null);
  setCapabilities(undefined);
}
