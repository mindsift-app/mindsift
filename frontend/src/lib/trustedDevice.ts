// "Trust this device" of the two-factor sign-in: the token the server hands out is kept per account in
// localStorage, beside the session token, and sent with every password login (the server picks the one
// of the account). Logging out keeps it: sparing the code on this device is the point. It goes when the
// trust is removed in the settings or two-factor sign-in is switched off.

const KEY = 'mindsift_trusted_devices';
// The server looks at no more than this many
const MAX = 10;

interface Entry {
  id: string;
  token: string;
}

function read(): Record<string, Entry> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function write(entries: Record<string, Entry>): void {
  try {
    if (Object.keys(entries).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked: the code is asked again next time
  }
}

// All trust tokens of this browser, newest first
export function trustTokens(): string[] {
  return Object.values(read())
    .map((e) => e?.token)
    .filter((t): t is string => typeof t === 'string' && t !== '')
    .reverse()
    .slice(0, MAX);
}

export function rememberTrust(userId: string, id: string, token: string): void {
  const entries = read();
  delete entries[userId];
  entries[userId] = { id, token };
  const keys = Object.keys(entries);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete entries[k];
  write(entries);
}

// The id of this browser's trusted device of the account, to mark it in the list
export function trustedDeviceId(userId: string): string | undefined {
  return read()[userId]?.id;
}

export function forgetTrust(userId: string): void {
  const entries = read();
  if (!(userId in entries)) return;
  delete entries[userId];
  write(entries);
}
