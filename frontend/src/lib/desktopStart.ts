// The desktop app's start view lives at this address on the window's own origin (served by the shell,
// desktop/internal/shell); main.tsx shows it there instead of the app. Kept apart from lib/desktopShell.ts
// so the start chunk of every page does not carry the shell's client.
export const DESKTOP_START_PATH = '/__desktop/start';
export const isDesktopStart = (path = window.location.pathname): boolean => path === DESKTOP_START_PATH;
