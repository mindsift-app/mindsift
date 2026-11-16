// Apple devices (macOS, iPadOS, iOS)
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');
}

// Held while dragging a bullet, it moves the bullet without its children: Shift on every platform. Ctrl and Alt
// (Option) do not work: Linux, Windows and macOS turn a drag with them into a copy, and the system then
// refuses the drop; Shift stays a move everywhere.
export function singleDragKey(e: { shiftKey: boolean }): boolean {
  return !!e.shiftKey;
}
