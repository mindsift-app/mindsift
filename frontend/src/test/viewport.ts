// The window's width in tests (jsdom: 1024 px, the desktop layout). Phone layouts check window.innerWidth
// (lib/breakpoints.ts); every test starts at the default width again (test/setup.ts).
export const DEFAULT_VIEWPORT_WIDTH = 1024;

/** Sets window.innerWidth and tells the listeners (usePhoneWidth) like a resized window. */
export function setViewportWidth(width: number): void {
  if (window.innerWidth === width) return;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

/** Back to the default width (test/setup.ts after every test). */
export const resetViewportWidth = () => setViewportWidth(DEFAULT_VIEWPORT_WIDTH);
