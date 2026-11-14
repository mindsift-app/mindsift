// Link previews in notes: a card above a bullet that contains a plain web address. The server fetches
// the page (https only) and keeps title, description, picture and icon; the browser only talks to
// MindSift. Hiding the card for one link turns the address into a named link [Titel](url), so the
// choice syncs with the note; a global switch (this device) turns all previews off. The administration
// can switch them off for the whole server (`linkPreviews` in /auth/status, or the answer
// link_previews_off): then there are no cards and no switch on this device either.
import { useEffect, useState } from 'react';
import { authHeaders } from './api';
import { isPublicView } from './publicNote';

export interface LinkPreview {
  key: string;
  url: string;
  title: string;
  description: string;
  siteName: string;
  hasImage: boolean;
  hasIcon: boolean;
  ok: boolean;
}

// Entire bullet content (trimmed) is a single plain https address
const CARD_URL_RE = /^https:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]$/;

export function linkCardUrl(content: string): string | null {
  const trimmed = (content || '').trim();
  return CARD_URL_RE.test(trimmed) ? trimmed : null;
}

/** Replaces the address by a named link, which shows no preview. */
/** "example.com/pfad" for a short link marker (no scheme, no www.) */
export function linkHost(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return u.host.replace(/^www\./, '') + path;
  } catch {
    return url;
  }
}

export function hidePreviewContent(content: string, url: string, title: string): string {
  const label = (title || new URL(url).hostname).replace(/[[\]]/g, '').trim() || url;
  return content.replace(url, `[${label}](${url})`);
}

const cache = new Map<string, Promise<LinkPreview | null>>();

export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(`/api/v1/link-preview?url=${encodeURIComponent(url)}`, { headers: authHeaders() });
      if (res.status === 404) {
        // Switched off on the server since the app started: no cards (and no switch) from now on
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'link_previews_off') setServerLinkPreviews(false);
      }
      if (!res.ok) return null; // demo, http link, offline: just no card
      const data = (await res.json()) as LinkPreview;
      return data.ok ? data : null;
    })().catch(() => null);
    cache.set(url, p);
  }
  return p;
}

const SETTING_KEY = 'mindsift_link_previews';
const SETTING_EVENT = 'mindsift:link-previews';

// The server's switch, as /auth/status last said (on until it says otherwise)
let serverAllows = true;

export function serverLinkPreviewsOn(): boolean {
  return serverAllows;
}

/** What the server says about link previews (status at start, or a link_previews_off answer). */
export function setServerLinkPreviews(on: boolean): void {
  if (serverAllows === on) return;
  serverAllows = on;
  cache.clear(); // answers from before the change do not count
  window.dispatchEvent(new CustomEvent(SETTING_EVENT));
}

export function linkPreviewsEnabled(): boolean {
  if (isPublicView()) return false; // previews need a login
  if (!serverAllows) return false;
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setLinkPreviewsEnabled(on: boolean): void {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
  } catch {
    // private mode: only for this page
  }
  window.dispatchEvent(new CustomEvent(SETTING_EVENT));
}

function useSetting(read: () => boolean): boolean {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const update = () => setOn(read());
    window.addEventListener(SETTING_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(SETTING_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [read]);
  return on;
}

/** The global switch (this device and the server), kept in sync across all open notes and tabs. */
export function useLinkPreviewsEnabled(): boolean {
  return useSetting(linkPreviewsEnabled);
}

/** Whether the server offers link previews at all (else the device switch is not shown). */
export function useServerLinkPreviews(): boolean {
  return useSetting(serverLinkPreviewsOn);
}
