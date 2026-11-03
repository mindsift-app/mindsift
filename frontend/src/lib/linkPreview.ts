// Link previews in notes: a card above a bullet that contains a plain web address. The server fetches
// the page (https only) and keeps title, description, picture and icon; the browser only talks to
// MindSift. Hiding the card for one link turns the address into a named link [Titel](url), so the
// choice syncs with the note; a global switch (this device) turns all previews off.
import { useEffect, useState } from 'react';
import { getToken } from './api';

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
      const token = getToken();
      const res = await fetch(`/api/v1/link-preview?url=${encodeURIComponent(url)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
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

export function linkPreviewsEnabled(): boolean {
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

/** The global switch, kept in sync across all open notes and tabs. */
export function useLinkPreviewsEnabled(): boolean {
  const [on, setOn] = useState(linkPreviewsEnabled);
  useEffect(() => {
    const update = () => setOn(linkPreviewsEnabled());
    window.addEventListener(SETTING_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(SETTING_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return on;
}
