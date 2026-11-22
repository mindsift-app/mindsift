// Images and audio in notes. A block points to its file through its content:
//   image  ![Beschriftung](media:med_…)
//   audio  [Beschriftung](media:med_…)
// An image whose size was changed by hand carries its displayed width in CSS pixels after an unescaped
// "|" at the end of the caption, as Obsidian does: ![Beschriftung|320](media:med_…). A "|" in the
// caption itself is escaped ("\|"), so older content stays valid and older versions show the width as
// part of the caption at worst. Recordings have no width.
// So the reference travels with the normal note sync. Files are loaded with the login (fetch) and shown
// as blob: URLs; on a public note page through its link (lib/publicNote.ts).
import { authHeaders } from './api';
import i18n from '../i18n';
import { publicMediaRequest } from './publicNote';
import { repairWebmBlob } from './webmDuration';

const MEDIA_RE = /^!?\[((?:[^\]\\]|\\.)*)\]\(media:(med_[0-9a-f]+)\)$/;

// The width at the end of the (still escaped) caption: everything before it is plain characters or
// escaped pairs, so the "|" found is not an escaped one
const WIDTH_RE = /^((?:[^\\]|\\.)*?)\|(\d{1,5})$/;

/** Smallest width an image can be dragged to (px) */
export const MIN_IMAGE_WIDTH = 48;
/** Largest width stored; the note column limits what is shown anyway */
export const MAX_IMAGE_WIDTH = 10000;

export interface MediaRef {
  id: string;
  caption: string;
  /** Displayed width in CSS pixels, when it was changed by hand (images only) */
  width?: number;
}

export function parseMediaContent(content: string): MediaRef | null {
  const trimmed = (content || '').trim();
  const m = MEDIA_RE.exec(trimmed);
  if (!m) return null;
  let raw = m[1];
  let width: number | undefined;
  const w = trimmed.startsWith('!') ? WIDTH_RE.exec(raw) : null;
  if (w && Number(w[2]) > 0) {
    raw = w[1];
    width = Math.min(MAX_IMAGE_WIDTH, Number(w[2]));
  }
  const ref: MediaRef = { id: m[2], caption: raw.replace(/\\(.)/g, '$1') };
  if (width) ref.width = width;
  return ref;
}

export function mediaContent(kind: 'image' | 'audio', id: string, caption = '', width?: number): string {
  const safe = caption.replace(/[\r\n]+/g, ' ').replace(/([\\\]|])/g, '\\$1');
  const w = kind === 'image' && width && width > 0 ? `|${Math.round(Math.min(MAX_IMAGE_WIDTH, width))}` : '';
  return `${kind === 'image' ? '!' : ''}[${safe}${w}](media:${id})`;
}

// Loaded files, once per page. The Blob is kept as well: the CSP does not allow fetch() on blob: URLs.
const loaded = new Map<string, Promise<{ blob: Blob; url: string }>>();

function loadMedia(id: string): Promise<{ blob: Blob; url: string }> {
  const pub = publicMediaRequest(id);
  if (pub) return loadAuthorized(pub.path, pub.headers);
  return loadAuthorized(`/api/v1/media/${encodeURIComponent(id)}`);
}

/** Any picture of the API (needs the login, so no plain <img src>), as Blob plus blob: URL. */
export function loadAuthorized(path: string, headers: Record<string, string> = authHeaders()): Promise<{ blob: Blob; url: string }> {
  let p = loaded.get(path);
  if (!p) {
    p = (async () => {
      const res = await fetch(path, { headers });
      if (!res.ok) throw new Error(res.status === 404 ? i18n.t('common:media.notFound') : `HTTP ${res.status}`);
      const blob = await res.blob();
      return { blob, url: URL.createObjectURL(blob) };
    })();
    p.catch(() => loaded.delete(path)); // try again next time (e.g. was offline)
    loaded.set(path, p);
  }
  return p;
}

// Audio files as played: WebM recordings with their length written in (see webmDuration.ts)
const playable = new Map<string, Promise<string>>();

function playableURL(key: string, load: () => Promise<{ blob: Blob; url: string }>): Promise<string> {
  let p = playable.get(key);
  if (!p) {
    p = load().then(async (m) => {
      const fixed = await repairWebmBlob(m.blob);
      return fixed === m.blob ? m.url : URL.createObjectURL(fixed);
    });
    p.catch(() => playable.delete(key));
    playable.set(key, p);
  }
  return p;
}

/** blob: URL of a file for <img>/<audio>. For 'audio', a WebM recording without length (made with
 *  MediaRecorder) gets it written into the file first, so every player shows it and can seek. */
export function mediaObjectURL(id: string, kind?: 'audio'): Promise<string> {
  if (kind !== 'audio') return loadMedia(id).then((m) => m.url);
  return playableURL(`media:${id}`, () => loadMedia(id));
}

/** A recording of the API (needs the login) as blob: URL for <audio>, repaired like mediaObjectURL's. */
export function authorizedAudioURL(path: string): Promise<string> {
  return playableURL(path, () => loadAuthorized(path));
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

/** Uploads a file into a note; `recording` marks audio recorded in the app (the server's limit for
 * uploaded audio files does not apply to it). */
export function uploadMedia(docId: string, file: Blob, filename: string, source?: 'recording'): Promise<UploadedMedia> {
  const form = new FormData();
  if (source) form.append('source', source);
  form.append('file', file, filename);
  return mediaRequest(`/api/v1/documents/${encodeURIComponent(docId)}/media`, { method: 'POST', body: form });
}

/**
 * An image from another address (https) into a note. The browser may not read other sites' images, so
 * the server fetches it and hands it over (nothing stored); the app compresses it like a picture of its
 * own and uploads it. With the image quality off the server stores its copy as it is.
 */
export async function copyExternalImage(docId: string, url: string): Promise<UploadedMedia> {
  const path = `/api/v1/documents/${encodeURIComponent(docId)}/media/fetch`;
  if (serverQuality === 'off') {
    return mediaRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  }
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ url, download: true }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || i18n.t('common:errors.uploadFailed', { status: res.status }));
  }
  const { blob, name } = await prepareImage(await res.blob());
  return uploadMedia(docId, blob, name);
}

const MAX_EDGE = 2048;

/** How strongly pictures are compressed before upload: the administration's choice (`imageQuality`);
 * `off` uploads the file as it is. */
export type ImageQuality = 'high' | 'medium' | 'low' | 'off';

// Encoder quality per level. The size stays at MAX_EDGE for every level, so text in screenshots and
// diagrams stays readable; only the compression changes. JPEG (no WebP encoder) a little higher.
export const IMAGE_QUALITY: Record<Exclude<ImageQuality, 'off'>, { webp: number; jpeg: number }> = {
  high: { webp: 0.82, jpeg: 0.85 },
  medium: { webp: 0.65, jpeg: 0.7 },
  low: { webp: 0.5, jpeg: 0.55 },
};

// The server's level, as /auth/status (or the administration's last save) said
let serverQuality: ImageQuality = 'high';

export function isImageQuality(v: unknown): v is ImageQuality {
  return v === 'high' || v === 'medium' || v === 'low' || v === 'off';
}

/** What the server says about the image quality; anything unknown counts as high. */
export function setServerImageQuality(level: unknown): void {
  serverQuality = isImageQuality(level) ? level : 'high';
}

export function serverImageQuality(): ImageQuality {
  return serverQuality;
}

/** Images in notes as the server says (`images` in /auth/status): new images allowed at all, copies
 * from other addresses, the largest one in MB. */
export interface ImageSettings {
  enabled: boolean;
  external: boolean;
  limitMB: number;
}

let serverImages: ImageSettings = { enabled: true, external: true, limitMB: 15 };

export function setServerImageSettings(v: Partial<ImageSettings> | undefined | null): void {
  const enabled = v?.enabled !== false;
  serverImages = {
    enabled,
    external: enabled && v?.external !== false,
    limitMB: typeof v?.limitMB === 'number' && v.limitMB > 0 ? v.limitMB : 15,
  };
}

/** Whether new images may go into notes (else /image is not offered and uploads are refused). */
export function imagesAllowed(): boolean {
  return serverImages.enabled;
}

/** Whether images may be copied from other addresses. */
export function externalImagesAllowed(): boolean {
  return serverImages.external;
}

/** Audio in notes as the server says (`audio` in /auth/status): recordings at `bitrate` kbit/s unless
 * compression is off; every audio file, recorded or uploaded, up to `limitMB`; files from the device
 * only while `uploads` is on. */
export interface AudioSettings {
  compression: 'recordings' | 'off';
  bitrate: number;
  limitMB: number;
  uploads: boolean;
}

const DEFAULT_AUDIO: AudioSettings = { compression: 'recordings', bitrate: 32, limitMB: 7, uploads: true };
let serverAudio: AudioSettings = DEFAULT_AUDIO;

export function setServerAudioSettings(v: Partial<AudioSettings> | undefined | null): void {
  serverAudio = {
    compression: v?.compression === 'off' ? 'off' : 'recordings',
    bitrate: typeof v?.bitrate === 'number' && v.bitrate > 0 ? v.bitrate : DEFAULT_AUDIO.bitrate,
    limitMB: typeof v?.limitMB === 'number' && v.limitMB > 0 ? v.limitMB : DEFAULT_AUDIO.limitMB,
    uploads: v?.uploads !== false,
  };
}

/** Bitrate for recordings in bit/s, undefined when compression is off (the browser's own choice). */
export function audioRecordingBitrate(): number | undefined {
  return serverAudio.compression === 'off' ? undefined : serverAudio.bitrate * 1000;
}

/** The largest audio file in a note, recorded or uploaded, in MB. */
export function audioLimitMB(): number {
  return serverAudio.limitMB;
}

/** Whether audio files may be uploaded from the device (else only recordings). */
export function audioUploadsAllowed(): boolean {
  return serverAudio.uploads;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Shrinks photos to at most 2048 px and stores them as WebP (JPEG where the browser cannot write WebP),
 * compressed as the server's image quality says. Re-encoding also drops EXIF data such as the location.
 * GIFs stay as they are (animation); anything the browser cannot decode is sent unchanged and checked by
 * the server. With the quality `off` every picture is sent as it is (size, EXIF data and all).
 */
export async function prepareImage(file: Blob, quality: ImageQuality = serverQuality): Promise<{ blob: Blob; name: string }> {
  if (quality === 'off') return { blob: file, name: 'bild' };
  const q = IMAGE_QUALITY[quality] ?? IMAGE_QUALITY.high;
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
  const webp = await canvasBlob(canvas, 'image/webp', q.webp);
  if (webp && webp.type === 'image/webp') return { blob: webp, name: 'bild.webp' };
  // No WebP encoder (older Safari): JPEG on white, since JPEG has no transparency
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jpeg = await canvasBlob(canvas, 'image/jpeg', q.jpeg);
  return jpeg ? { blob: jpeg, name: 'bild.jpg' } : { blob: file, name: 'bild' };
}
