// Images and audio in notes. A block points to its file through its content:
//   image  ![Beschriftung](media:med_…)
//   audio  [Beschriftung](media:med_…)
// so the reference travels with the normal note sync. Files are loaded with the login (fetch) and
// shown as blob: URLs; there are no public links.
import { authHeaders } from './api';
import i18n from '../i18n';

const MEDIA_RE = /^!?\[((?:[^\]\\]|\\.)*)\]\(media:(med_[0-9a-f]+)\)$/;

export interface MediaRef {
  id: string;
  caption: string;
}

export function parseMediaContent(content: string): MediaRef | null {
  const m = MEDIA_RE.exec((content || '').trim());
  if (!m) return null;
  return { id: m[2], caption: m[1].replace(/\\(.)/g, '$1') };
}

export function mediaContent(kind: 'image' | 'audio', id: string, caption = ''): string {
  const safe = caption.replace(/[\r\n]+/g, ' ').replace(/([\\\]])/g, '\\$1');
  return `${kind === 'image' ? '!' : ''}[${safe}](media:${id})`;
}

// Loaded files, once per page. The Blob is kept as well: the CSP does not allow fetch() on blob: URLs.
const loaded = new Map<string, Promise<{ blob: Blob; url: string }>>();

function loadMedia(id: string): Promise<{ blob: Blob; url: string }> {
  return loadAuthorized(`/api/v1/media/${encodeURIComponent(id)}`);
}

/** Any picture of the API (needs the login, so no plain <img src>), as Blob plus blob: URL. */
export function loadAuthorized(path: string): Promise<{ blob: Blob; url: string }> {
  let p = loaded.get(path);
  if (!p) {
    p = (async () => {
      const res = await fetch(path, { headers: authHeaders() });
      if (!res.ok) throw new Error(res.status === 404 ? i18n.t('common:media.notFound') : `HTTP ${res.status}`);
      const blob = await res.blob();
      return { blob, url: URL.createObjectURL(blob) };
    })();
    p.catch(() => loaded.delete(path)); // try again next time (e.g. was offline)
    loaded.set(path, p);
  }
  return p;
}

/** blob: URL of a file for <img>/<audio>. */
export function mediaObjectURL(id: string): Promise<string> {
  return loadMedia(id).then((m) => m.url);
}

/** The file itself, e.g. to send a recording to the speech recognition. */
export function mediaBlob(id: string): Promise<Blob> {
  return loadMedia(id).then((m) => m.blob);
}

export interface UploadedMedia {
  id: string;
  kind: 'image' | 'audio';
  mime: string;
  size: number;
  url: string;
}

async function mediaRequest(path: string, init: RequestInit): Promise<UploadedMedia> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...authHeaders() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || i18n.t('common:errors.uploadFailed', { status: res.status }));
  return data as UploadedMedia;
}

export function uploadMedia(docId: string, file: Blob, filename: string): Promise<UploadedMedia> {
  const form = new FormData();
  form.append('file', file, filename);
  return mediaRequest(`/api/v1/documents/${encodeURIComponent(docId)}/media`, { method: 'POST', body: form });
}

/** Lets the server copy an external image (https). */
export function copyExternalImage(docId: string, url: string): Promise<UploadedMedia> {
  return mediaRequest(`/api/v1/documents/${encodeURIComponent(docId)}/media/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

const MAX_EDGE = 2048;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Shrinks photos to at most 2048 px and stores them as WebP (JPEG where the browser cannot write WebP).
 * Re-encoding also drops EXIF data such as the location. GIFs stay as they are (animation); anything
 * the browser cannot decode is sent unchanged and checked by the server.
 */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; name: string }> {
  if (file.type === 'image/gif' || typeof createImageBitmap === 'undefined') return { blob: file, name: 'bild' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    return { blob: file, name: 'bild' };
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: file, name: 'bild' };
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const webp = await canvasBlob(canvas, 'image/webp', 0.82);
  if (webp && webp.type === 'image/webp') return { blob: webp, name: 'bild.webp' };
  // No WebP encoder (older Safari): JPEG on white, since JPEG has no transparency
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.85);
  return jpeg ? { blob: jpeg, name: 'bild.jpg' } : { blob: file, name: 'bild' };
}
