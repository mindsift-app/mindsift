import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crop, ZoomIn, ZoomOut } from 'lucide-react';
import { FormSheet } from '../../../components/FormSheet';
import {
  AvatarPlacement,
  MAX_ZOOM,
  MIN_ZOOM,
  clampPlacement,
  initialPlacement,
  placedSize,
  zoomAround,
} from '../../../lib/avatarCrop';

// Place a picked picture in the round avatar frame before it is saved: drag to move it, zoom with the
// slider, the mouse wheel or two fingers. The square around the circle is what gets stored.
export function AvatarCropSheet({
  image,
  onApply,
  onClose,
}: {
  image: HTMLImageElement;
  onApply: (placement: AvatarPlacement) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const imgW = image.naturalWidth;
  const imgH = image.naturalHeight;
  const [placement, setPlacement] = useState<AvatarPlacement>(() => initialPlacement(imgW, imgH));
  const placementRef = useRef(placement);
  placementRef.current = placement;
  const frameRef = useRef<HTMLDivElement>(null);
  // Active pointers (one: drag, two: pinch), in frame units
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const toFrame = (clientX: number, clientY: number) => {
    const rect = frameRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, toFrame(e.clientX, e.clientY));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    const now = toFrame(e.clientX, e.clientY);
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId);
    pointers.current.set(e.pointerId, now);
    const p = placementRef.current;
    if (others.length === 0) {
      setPlacement(clampPlacement(imgW, imgH, { ...p, x: p.x + now.x - last.x, y: p.y + now.y - last.y }));
      return;
    }
    // Pinch: zoom by the change in distance around the point between the fingers
    const other = others[0][1];
    const before = Math.hypot(last.x - other.x, last.y - other.y);
    const after = Math.hypot(now.x - other.x, now.y - other.y);
    if (before < 0.01) return;
    setPlacement(zoomAround(imgW, imgH, p, p.zoom * (after / before), (now.x + other.x) / 2, (now.y + other.y) / 2));
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  // The wheel needs a non-passive listener so the page does not scroll along
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const p = placementRef.current;
      const factor = Math.exp(-e.deltaY * 0.002);
      setPlacement(zoomAround(imgW, imgH, p, p.zoom * factor, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [imgW, imgH]);

  const { w, h } = placedSize(imgW, imgH, placement.zoom);

  return (
    <FormSheet
      title={t('profile.cropTitle')}
      icon={<Crop className="w-4 h-4 text-accent" />}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        onApply(placement);
      }}
      submitLabel={t('profile.cropApply')}
    >
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className="relative mx-auto w-full max-w-[16rem] aspect-square overflow-hidden rounded-card bg-canvas touch-none select-none cursor-grab active:cursor-grabbing"
      >
        <img
          src={image.src}
          alt=""
          draggable={false}
          className="absolute max-w-none pointer-events-none"
          style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
        />
        {/* Darkens what falls outside the round avatar */}
        <div className="absolute inset-0 rounded-full pointer-events-none shadow-[0_0_0_999px_var(--bg-overlay)] ring-2 ring-accent" />
      </div>
      <div className="flex items-center gap-2 max-w-[16rem] mx-auto">
        <ZoomOut className="w-4 h-4 text-muted flex-shrink-0" aria-hidden="true" />
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={placement.zoom}
          onChange={(e) => setPlacement(zoomAround(imgW, imgH, placement, Number(e.target.value)))}
          aria-label={t('profile.cropZoom')}
          className="flex-1 h-11 sm:h-6 accent-[var(--accent-primary)]"
        />
        <ZoomIn className="w-4 h-4 text-muted flex-shrink-0" aria-hidden="true" />
      </div>
      <p className="text-[11px] text-muted text-center">{t('profile.cropHint')}</p>
    </FormSheet>
  );
}
