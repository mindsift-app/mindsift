// The visitor's side of a public link (/p/<token>, internal/api/publiclinks.go). No login: the token is
// the access, a password-protected link also needs the key the unlock returns (kept for this tab only).
// While a public page is open, images and recordings load through the link, hidden values stay dots
// and link previews are off (they need a login).
import { Block } from './docSync/model';
import i18n from '../i18n';

let access: { token: string; key: string } | null = null;

export const isPublicView = () => access !== null;

export function setPublicAccess(token: string, key: string): void {
  access = { token, key };
}

/** Path and headers to load a file of the public note, or null outside a public page. */
export function publicMediaRequest(id: string): { path: string; headers: Record<string, string> } | null {
  if (!access) return null;
  return {
    path: `/api/v1/public/${encodeURIComponent(access.token)}/media/${encodeURIComponent(id)}`,
    headers: access.key ? { 'X-Public-Key': access.key } : {},
  };
}

export interface PublicNote {
  title: string;
  icon: string;
  themeFamily: string;
  expiresAt: string;
  headSeq: number;
  titleVersion: number;
  blocks: Block[];
}

export type PublicNoteResult =
  | { status: 'ok'; note: PublicNote }
  | { status: 'unchanged' }
  | { status: 'locked' }
  | { status: 'gone' };

const keyStorage = (token: string) => `mindsift_public_key_${token}`;

export function storedPublicKey(token: string): string {
  try {
    return sessionStorage.getItem(keyStorage(token)) || '';
  } catch {
    return '';
  }
}

/** The note, or 'unchanged' when nothing happened since the log position `since`. */
export async function fetchPublicNote(token: string, key: string, since?: number): Promise<PublicNoteResult> {
  const q = since !== undefined ? `?since=${since}` : '';
  const res = await fetch(`/api/v1/public/${encodeURIComponent(token)}${q}`, {
    headers: { 'Accept-Language': i18n.language || 'de', ...(key ? { 'X-Public-Key': key } : {}) },
    cache: 'no-store',
  });
  if (res.status === 204) return { status: 'unchanged' };
  if (res.status === 401) return { status: 'locked' };
  if (!res.ok) return { status: 'gone' };
  return { status: 'ok', note: (await res.json()) as PublicNote };
}

/** Unlocks a password-protected link; throws with the server's message (wrong password, too many tries). */
export async function unlockPublicNote(token: string, password: string): Promise<string> {
  const res = await fetch(`/api/v1/public/${encodeURIComponent(token)}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': i18n.language || 'de' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || i18n.t('public:wrongPassword'));
  try {
    sessionStorage.setItem(keyStorage(token), data.key || '');
  } catch {
    // private mode: the key lives until the page closes
  }
  return data.key || '';
}
