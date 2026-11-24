import React from 'react';

// "Nothing here yet" in one look everywhere (Doku/ui-patterns.md): a short muted line, centred. Inside a
// framed list (rows with dividers) it stands as a row of it; on its own, `framed` gives it a dashed frame
// in the theme's corners, so the empty area still reads as the place where the items will be. `compact`
// is the small line for menus, popovers and short lists inside a card ("Keine Treffer"), left aligned
// like the entries it stands for.
export function EmptyState({
  children,
  framed = false,
  compact = false,
  className = '',
}: {
  children: React.ReactNode;
  framed?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const base = compact ? 'px-2 py-1.5 text-xs text-muted' : 'px-3 py-6 text-center text-xs text-muted';
  return (
    <div className={`${base} ${framed ? 'border border-dashed border-border rounded-card' : ''} ${className}`}>
      {children}
    </div>
  );
}
