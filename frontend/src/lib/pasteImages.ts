// Images pasted into a note (Ctrl+V, Cmd+V, paste from the phone's context menu). Decides from the
// clipboard what becomes an image bullet; uploading and inserting the bullets is OutlinerBlock's job.
//
// - Image files on the clipboard (screenshot, "Copy image" in a browser or app) win over everything else.
//   Browsers add an HTML <img> and sometimes the address as plain text: neither is pasted as text then.
// - Image files together with real text: office apps (LibreOffice, Excel, Word) put a picture of the copied
//   text next to it, so the text wins and the picture is dropped. Only when the HTML shows images as part of
//   the selection (a copied part of a page or document) are the files added as image bullets after the text.
//   Where they stood within the text is unknown (the clipboard has no position for them), so they follow it.
// - HTML with only images and no file (some browsers and apps): https images are copied by the server
//   (POST /documents/{id}/media/fetch, same protection as the /image link), data: images are uploaded.
// - HTML with text and images but no file (a part of a web page): only the text, as before; fetching every
//   image of a page selection would pull in tracking pixels and icons nobody meant to paste.

import { copyExternalImage, mediaContent, prepareImage, uploadMedia } from './media';

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

/** The images a paste should insert, or null when it stays a text paste. */
export function pastedImages(data: DataTransfer | null | undefined): PastedImages | null {
  if (!data) return null;
  const files = imageFiles(data);
  const html = parseHtml(data.getData('text/html'));
  const text = data.getData('text/plain').trim();
  // Plain text that is only the image's address (Firefox puts it there with "Copy image")
  const textIsAddress = !!text && !/\s/.test(text) && (html.srcs.includes(text) || (files.length > 0 && /^https?:\/\/\S+$/i.test(text)));
  const imageOnly = (!text || textIsAddress) && !html.text;

  const pick = (all: Blob[] | string[], keepText: boolean): PastedImages => {
    const dropped = Math.max(0, all.length - MAX_PASTED_IMAGES);
    const kept = all.slice(0, MAX_PASTED_IMAGES);
    return typeof kept[0] === 'string'
      ? { files: [], urls: kept as string[], keepText, dropped }
      : { files: kept as Blob[], urls: [], keepText, dropped };
  };

  if (files.length > 0) {
    if (imageOnly) return pick(files, false);
    return html.srcs.length > 0 ? pick(files, true) : null;
  }
  if (html.srcs.length > 0 && imageOnly) return pick(html.srcs, false);
  return null;
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
export async function uploadPastedImages(docId: string, images: PastedImages): Promise<{ contents: string[]; errors: unknown[] }> {
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
