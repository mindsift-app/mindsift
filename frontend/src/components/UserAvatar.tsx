import React, { useState } from 'react';

export interface UserAvatarProps {
  user?: {
    displayName?: string;
    email?: string;
    avatarUrl?: string;
  } | null;
  name?: string;
  avatarUrl?: string;
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  alt?: string;
  showTitle?: boolean; // native name tooltip on hover
}

const SIZE_MAP = {
  xxs: 'w-4 h-4 text-[7px]',
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-2xl',
};

const BG_COLORS = [
  'bg-primary/20 text-primary border-primary/30',
  'bg-secondary/20 text-secondary border-secondary/30',
  'bg-accent/20 text-accent border-accent/30',
  'bg-info/20 text-info border-info/30',
  'bg-success/20 text-success border-success/30',
  'bg-warning/20 text-warning border-warning/30',
];

function getInitials(name?: string, email?: string): string {
  const cleanName = (name || '').trim();
  if (cleanName) {
    const parts = cleanName.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return cleanName.slice(0, 2).toUpperCase();
  }
  const cleanEmail = (email || '').trim();
  if (cleanEmail) {
    return cleanEmail.slice(0, 2).toUpperCase();
  }
  return '?';
}

function getColorIndex(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % BG_COLORS.length;
}

export function isEmoji(str?: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  // Simple heuristic: length <= 8 and not a URL or base64 image
  return !trimmed.startsWith('data:') && !trimmed.startsWith('http') && !trimmed.startsWith('/') && trimmed.length <= 8;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  user,
  name,
  avatarUrl,
  size = 'md',
  className = '',
  alt,
  showTitle = true,
}) => {
  const [imageError, setImageError] = useState(false);

  const effectiveAvatarUrl = avatarUrl !== undefined ? avatarUrl : user?.avatarUrl;
  const effectiveName = name !== undefined ? name : (user?.displayName || user?.email || '');
  const effectiveEmail = user?.email || '';

  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;
  const initials = getInitials(effectiveName, effectiveEmail);
  const colorIndex = getColorIndex(effectiveName || effectiveEmail || 'user');
  const colorClass = BG_COLORS[colorIndex];

  const hasImage = Boolean(
    effectiveAvatarUrl &&
    !imageError &&
    (effectiveAvatarUrl.startsWith('data:image/') ||
     effectiveAvatarUrl.startsWith('http://') ||
     effectiveAvatarUrl.startsWith('https://') ||
     effectiveAvatarUrl.startsWith('/'))
  );

  const isEmojiAvatar = Boolean(effectiveAvatarUrl && isEmoji(effectiveAvatarUrl));

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full aspect-square shrink-0 select-none overflow-hidden font-semibold transition-all ${sizeClass} ${className}`}
      title={showTitle ? effectiveName || alt : undefined}
    >
      {hasImage ? (
        <img
          src={effectiveAvatarUrl}
          alt={alt || effectiveName || 'Avatar'}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover rounded-full"
        />
      ) : isEmojiAvatar ? (
        <div className="w-full h-full flex items-center justify-center bg-base-300/80 rounded-full">
          <span className="leading-none">{effectiveAvatarUrl}</span>
        </div>
      ) : (
        <div className={`w-full h-full flex items-center justify-center rounded-full border ${colorClass}`}>
          <span className="leading-none tracking-tight">{initials}</span>
        </div>
      )}
    </div>
  );
};

/**
 * Resizes and center-crops an uploaded image file to a compact base64 Data URL.
 */
export async function resizeImageToDataUrl(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Fehler beim Lesen der Datei'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Fehler beim Laden des Bildes'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas Context konnte nicht erstellt werden'));
          return;
        }

        // Center crop calculation
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxSize, maxSize);

        // Try webp first, fallback to jpeg
        let dataUrl = canvas.toDataURL('image/webp', 0.85);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        }
        resolve(dataUrl);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
