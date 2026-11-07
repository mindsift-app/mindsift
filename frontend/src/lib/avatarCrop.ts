import i18n from '../i18n';

// Placing a picture in the round avatar frame. The frame is a square of side 1; the picture covers it
// at zoom 1 (its short side fills the frame) and is drawn at x/y (top left, in frame units) with size
// w × h. The frame always stays covered, so there is never an empty edge.
export interface AvatarPlacement {
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

// Size of the picture in frame units at the given zoom
export function placedSize(imgW: number, imgH: number, zoom: number): { w: number; h: number } {
  const short = Math.min(imgW, imgH) || 1;
  return { w: (imgW / short) * zoom, h: (imgH / short) * zoom };
}

// Keeps zoom within its range and the picture over the whole frame
export function clampPlacement(imgW: number, imgH: number, p: AvatarPlacement): AvatarPlacement {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.zoom));
  const { w, h } = placedSize(imgW, imgH, zoom);
  return {
    zoom,
    x: Math.min(0, Math.max(1 - w, p.x)),
    y: Math.min(0, Math.max(1 - h, p.y)),
  };
}

// Centred at zoom 1, like the old automatic crop
export function initialPlacement(imgW: number, imgH: number): AvatarPlacement {
  const { w, h } = placedSize(imgW, imgH, 1);
  return { zoom: 1, x: (1 - w) / 2, y: (1 - h) / 2 };
}

// Zooms while the point (cx, cy) of the frame stays over the same spot of the picture
export function zoomAround(imgW: number, imgH: number, p: AvatarPlacement, zoom: number, cx = 0.5, cy = 0.5): AvatarPlacement {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const factor = next / p.zoom;
  return clampPlacement(imgW, imgH, {
    zoom: next,
    x: cx - (cx - p.x) * factor,
    y: cy - (cy - p.y) * factor,
  });
}

// The square of the picture (in its own pixels) that the frame shows
export function cropRect(imgW: number, imgH: number, p: AvatarPlacement): { sx: number; sy: number; size: number } {
  const { w } = placedSize(imgW, imgH, p.zoom);
  const pxPerUnit = imgW / w;
  return { sx: -p.x * pxPerUnit, sy: -p.y * pxPerUnit, size: pxPerUnit };
}

// Reads a picture file the user picked
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(i18n.t('common:avatar.readFailed')));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error(i18n.t('common:avatar.loadFailed')));
      img.onload = () => resolve(img);
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// The part of the picture the frame shows, as a square data URL of the given size (WebP, else JPEG)
export function cropImageToDataUrl(img: HTMLImageElement, p: AvatarPlacement, size = 256): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(i18n.t('common:avatar.canvasFailed'));
  const { sx, sy, size: sSize } = cropRect(img.naturalWidth, img.naturalHeight, p);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, size, size);
  let dataUrl = canvas.toDataURL('image/webp', 0.85);
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  }
  return dataUrl;
}
