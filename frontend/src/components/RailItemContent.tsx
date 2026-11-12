import React from 'react';
import { CountBadge } from './CountBadge';

interface RailItemContentProps {
  icon: React.ReactNode;
  label: string;
  // The rail is expanded: the label stands next to the icon
  expanded: boolean;
  // Counter (accent): after the label when expanded, on the icon's corner when collapsed
  count?: number;
  // Name on hover of the collapsed rail, if it should say more than the label (e.g. the shortcut)
  tip?: string;
  // Small hint on the right of an expanded row (a shortcut)
  hint?: React.ReactNode;
}

// The inside of a row of the desktop navigation rail (app/NavRail.tsx, Doku/ui-patterns.md). Inside a button
// with the class `rail-item`. Collapsed, the label stays for screen readers and tests (the button's name
// starts with it) and appears as a small tip beside the icon on hover.
export function RailItemContent({ icon, label, expanded, count, tip, hint }: RailItemContentProps) {
  return (
    <>
      <span className="relative w-5 h-5 shrink-0 flex items-center justify-center">
        {icon}
        {!expanded && (
          <span aria-hidden>
            <CountBadge count={count} variant="accent" position="corner" />
          </span>
        )}
      </span>
      <span className={expanded ? 'flex-1 min-w-0 inline-flex items-center' : 'sr-only'}>
        <span className="truncate">{label}</span>
        <CountBadge count={count} variant="accent" position="text" />
      </span>
      {expanded && hint && <span className="shrink-0 text-[10px] font-normal text-faint">{hint}</span>}
      {!expanded && (
        <span aria-hidden className="rail-tip">
          {tip || label}
        </span>
      )}
    </>
  );
}
