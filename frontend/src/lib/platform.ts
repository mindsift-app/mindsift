// Apple devices (macOS, iPadOS, iOS): there Ctrl + click is a right click, so modifiers used together with
// the mouse take Alt (Option) instead.
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');
}

// Held while dragging a bullet, it moves the bullet without its children: Ctrl, on Apple devices Alt (Option)
export function singleDragKey(e: { ctrlKey: boolean; altKey: boolean }): boolean {
  return !!(isApplePlatform() ? e.altKey : e.ctrlKey);
}
