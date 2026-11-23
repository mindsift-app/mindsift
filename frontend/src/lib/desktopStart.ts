// The desktop app's start view lives at this address on the window's own origin (served by the shell,
// desktop/internal/shell); main.tsx shows it there instead of the app. Kept apart from lib/desktopShell.ts
// so the start chunk of every page does not carry the shell's client.
const DESKTOP_START_PATH = '/__desktop/start';
export const isDesktopStart = (path = window.location.pathname): boolean => path === DESKTOP_START_PATH;
// Back to the start view from a local instance (profile menu "Switch instance"), as the tray and
// Ctrl+Shift+O do: the shell serves it on this address whatever is open
export const openDesktopStart = (): void => window.location.assign(DESKTOP_START_PATH);
