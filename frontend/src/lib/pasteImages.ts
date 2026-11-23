// Images pasted into a note (Ctrl+V, Cmd+V, paste from the phone's context menu). Decides from the
// clipboard what becomes an image bullet; uploading and inserting the bullets is OutlinerBlock's job.
//
// - Image files on the clipboard (screenshot, "Copy image" in a browser or app) win over everything else.
//   Browsers add an HTML <img> and sometimes the address as plain text: neither is pasted as text then.
// - Image files together with real text: office apps (LibreOffice, Excel, Word) put a picture of the copied
//   text next to it, so the text wins and the picture is dropped. Only when the HTML shows images as part of
//   the selection (a copied part of a page or document) are the files added as image bullets after the text.
//   Where they stood within the text is unknown (the clipboard has no position for them), so they follow it.
// - HTML with only images and no file (some browsers and apps): https images are fetched by the server
//   (POST /documents/{id}/media/fetch, same protection as the /image link) and compressed like any other
//   picture, data: images are uploaded. While the administration has switched off images from other
//   addresses, https images are left out (the paste stays text when nothing else is left).
// - HTML with text and images but no file (a part of a web page): only the text, as before; fetching every
//   image of a page selection would pull in tracking pixels and icons nobody meant to paste.
//
// Image files dragged onto a note (from the desktop, a file manager or a browser tab) go the same way
// (draggedFiles while dragging, droppedImages on the drop); a drop's image files always win, whatever text
// the file manager adds (paths, file:// addresses).

import i18n from '../i18n';
import { showError } from '../components/ErrorNotice';
import { errorMessage } from './errorMessage';
import { copyExternalImage, externalImagesAllowed, mediaContent, prepareImage, uploadMedia } from './media';

/** At most this many images per paste; more are reported, not uploaded. */
export const MAX_PASTED_IMAGES = 10;

export interface PastedImages {
  /** Image files to upload, in clipboard order */
  files: Blob[];
  /** Images only known by their address (https for the server copy, data: to upload) */
  urls: string[];
  /** The text on the clipboard is pasted as before; the images follow it as bullets */
  keepText: boolean;
  /** More images than MAX_PASTED_IMAGES were on the clipboard (the rest is dropped) */
  dropped: number;
}

function imageFiles(data: DataTransfer): Blob[] {
  const files = Array.from(data.files || []).filter((f) => f.type.startsWith('image/'));
  if (files.length > 0) return files;
  // Some browsers list the pasted file only under items
  const out: Blob[] = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

function parseHtml(html: string): { srcs: string[]; text: string } {
  if (!html || typeof DOMParser === 'undefined') return { srcs: [], text: '' };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const srcs: string[] = [];
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = (img.getAttribute('src') || '').trim();
    if (/^https?:\/\//i.test(src) || /^data:image\//i.test(src)) srcs.push(src);
  }
  return { srcs, text: (doc.body?.textContent || '').trim() };
}

// Addresses of images that may become bullets: data: always (uploaded), https only while the server may
// copy images from other addresses
function usableUrls(urls: string[]): string[] {
  return externalImagesAllowed() ? urls : urls.filter((u) => /^data:/i.test(u));
}

function pick(all: Blob[] | string[], keepText: boolean): PastedImages {
  const dropped = Math.max(0, all.length - MAX_PASTED_IMAGES);
  const kept = all.slice(0, MAX_PASTED_IMAGES);
  return typeof kept[0] === 'string'
    ? { files: [], urls: kept as string[], keepText, dropped }
    : { files: kept as Blob[], urls: [], keepText, dropped };
}

/** The images a paste should insert, or null when it stays a text paste. */
export function pastedImages(data: DataTransfer | null | undefined): PastedImages | null {
  if (!data) return null;
  const files = imageFiles(data);
  const html = parseHtml(data.getData('text/html'));
  const text = data.getData('text/plain').trim();
  // Plain text that is only the image's address (Firefox puts it there with "Copy image")
  const textIsAddress = !!text && !/\s/.test(text) && (html.srcs.includes(text) || (files.length > 0 && /^https?:\/\/\S+$/i.test(text)));
  const imageOnly = (!text || textIsAddress) && !html.text;

  if (files.length > 0) {
    if (imageOnly) return pick(files, false);
    return html.srcs.length > 0 ? pick(files, true) : null;
  }
  const urls = usableUrls(html.srcs);
  if (urls.length > 0 && imageOnly) return pick(urls, false);
  return null;
}

/**
 * What a drag over the note carries, as far as the browser tells while dragging (only the types, the files
 * themselves come with the drop): 'images' for files with at least one image (or files of unknown type,
 * decided on the drop), 'other' for files without an image, null for anything else (a bullet dragged by its
 * handle, text dragged within or into a field, a link).
 */
export function draggedFiles(data: DataTransfer | null | undefined): 'images' | 'other' | null {
  if (!data || !Array.from(data.types || []).includes('Files')) return null;
  const items = Array.from(data.items || []).filter((item) => item.kind === 'file');
  if (items.length === 0 || items.some((item) => !item.type || item.type.startsWith('image/'))) return 'images';
  return 'other';
}

/**
 * The images a drop onto the note inserts: dropped image files (other files are counted, not uploaded), or
 * an image dragged out of a browser tab, known only by its HTML or address. images is null when the drop
 * holds no image; then it stays the browser's (text dropped into a field) unless otherFiles is set.
 */
export function droppedImages(data: DataTransfer | null | undefined): { images: PastedImages | null; otherFiles: number } {
  if (!data) return { images: null, otherFiles: 0 };
  const all = Array.from(data.files || []);
  const files = imageFiles(data);
  if (all.length > 0 || files.length > 0) {
    const otherFiles = all.filter((f) => !f.type.startsWith('image/')).length;
    return { images: files.length > 0 ? pick(files, false) : null, otherFiles };
  }
  const pasted = pastedImages(data);
  if (pasted && !pasted.keepText) return { images: pasted, otherFiles: 0 };
  // Only an address, without HTML: an image link dragged from a page
  const uris = (data.getData('text/uri-list') || '')
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => u && !u.startsWith('#'));
  if (uris.length > 0 && !data.getData('text/html') && uris.every((u) => /^https:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(u)) && externalImagesAllowed()) {
    return { images: pick(uris, false), otherFiles: 0 };
  }
  return { images: null, otherFiles: 0 };
}

/** A data: image as a Blob for the upload (decoded here: the CSP does not allow fetch() on data: URLs). */
export function dataUrlBlob(url: string): Blob {
  const m = /^data:([^;,]+)((?:;[^;,]*)*),(.*)$/is.exec(url);
  if (!m) throw new Error('invalid data URL');
  const payload = m[3];
  if (!/;base64/i.test(m[2])) return new Blob([decodeURIComponent(payload)], { type: m[1] });
  const bin = atob(payload.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/**
 * Uploads the pasted images (in parallel, results in clipboard order) the same way the /image picker does:
 * shrunk and re-encoded by prepareImage, checked by the server (type, MEDIA_MAX_IMAGE_MB). Returns the
 * contents of the image bullets that succeeded and the error of each one that failed.
 */
async function uploadPastedImages(docId: string, images: PastedImages): Promise<{ contents: string[]; errors: unknown[] }> {
  const jobs: Promise<string>[] = [
    ...images.files.map(async (file) => {
      const { blob, name } = await prepareImage(file);
      return (await uploadMedia(docId, blob, name)).id;
    }),
    ...images.urls.map(async (url) => {
      if (/^data:/i.test(url)) {
        const { blob, name } = await prepareImage(dataUrlBlob(url));
        return (await uploadMedia(docId, blob, name)).id;
      }
      return (await copyExternalImage(docId, url)).id;
    }),
  ];
  const results = await Promise.allSettled(jobs);
  const contents: string[] = [];
  const errors: unknown[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') contents.push(mediaContent('image', r.value));
    else errors.push(r.reason);
  }
  return { contents, errors };
}

/**
 * Uploads pasted or dropped images and hands the contents of their image bullets to insert. Every image
 * that does not make it is reported, nothing disappears without a word. pending counts the images on their
 * way (+n before the upload, -n after it), for the "uploading" placeholder.
 */
export async function insertImages(
  docId: string,
  images: PastedImages,
  insert: (contents: string[]) => void,
  pending?: (delta: number) => void
): Promise<void> {
  const count = images.files.length + images.urls.length;
  const tooMany = images.dropped > 0 ? i18n.t('workspace:media.pasteTooMany', { max: MAX_PASTED_IMAGES }) : '';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showError(i18n.t('workspace:media.pasteOffline'));
    return;
  }
  pending?.(count);
  let result: { contents: string[]; errors: unknown[] };
  try {
    result = await uploadPastedImages(docId, images);
  } finally {
    pending?.(-count);
  }
  if (result.contents.length > 0) insert(result.contents);
  if (result.errors.length > 0) {
    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || result.errors.some((err) => err instanceof TypeError);
    const error = offline ? i18n.t('workspace:media.pasteOffline') : errorMessage(result.errors[0], i18n.t('workspace:media.uploadFailed'));
    showError([i18n.t('workspace:media.pasteFailed', { count: result.errors.length, error }), tooMany].filter(Boolean).join(' '));
  } else if (tooMany) {
    showError(tooMany);
  }
}
