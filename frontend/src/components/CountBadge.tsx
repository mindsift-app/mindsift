import React from 'react';

interface CountBadgeProps {
  count: number | undefined | null;
  // accent: something waits for you (nav bar); muted: plain amount (tabs, lists)
  variant?: 'accent' | 'muted';
  // corner: notification badge on the top right of the nearest `relative` parent (icons);
  // text: right after a label, raised and hanging a little over its last letter (tabs, nav bar)
  position?: 'inline' | 'corner' | 'text';
  showZero?: boolean;
  className?: string; // e.g. to fine-tune the corner offset
}

// Full class names: Tailwind drops component classes it cannot find literally in the source
const VARIANT_CLASS = { accent: 'count-badge-accent', muted: 'count-badge-muted' };
const POSITION_CLASS = { inline: '', corner: 'count-badge-corner', text: 'count-badge-text' };

// The one counter of the app (Doku/ui-patterns.md); hides itself at 0 unless showZero
export const CountBadge: React.FC<CountBadgeProps> = ({
  count,
  variant = 'muted',
  position = 'inline',
  showZero = false,
  className = '',
}) => {
  if (count === undefined || count === null || (count <= 0 && !showZero)) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className={`count-badge ${VARIANT_CLASS[variant]} ${POSITION_CLASS[position]} ${className}`}
      aria-label={String(count)}
    >
      {label}
    </span>
  );
};
