import { isPhoneWidth } from '../breakpoints';

// What a note editor tells the server about itself along with its leases, so the person's own other tabs and
// devices can show where a bullet is being edited ("Du" with a phone, computer or tab icon). The server
// shows this only to the same person and keeps the browser id to itself (it only answers "same browser").

export type DeviceKind = 'phone' | 'computer';

const BROWSER_KEY = 'mindsift-browser-id';
let fallbackBrowserId: string | null = null;

const newId = (): string => {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** An id all tabs of this browser share (local storage); a tab without storage keeps one of its own. */
export function browserId(): string {
  try {
    let id = localStorage.getItem(BROWSER_KEY);
    if (!id || !/^[0-9a-f]{12}$/.test(id)) {
      id = newId();
      localStorage.setItem(BROWSER_KEY, id);
    }
    return id;
  } catch {
    return (fallbackBrowserId ??= newId());
  }
}

/** Phone (and tablet): phone width or a touch screen as the main pointer; anything else is a computer. */
export function deviceKind(): DeviceKind {
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  return isPhoneWidth() || coarse ? 'phone' : 'computer';
}
