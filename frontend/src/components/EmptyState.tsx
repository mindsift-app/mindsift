import React from 'react';

// "Nothing here yet" in one look everywhere (Doku/ui-patterns.md): a short muted line, centred. Inside a
// framed list (rows with dividers) it stands as a row of it; on its own, `framed` gives it a dashed frame
// in the theme's corners, so the empty area still reads as the place where the items will be.
export function EmptyState({
  children,
  framed = false,
  className = '',
}: {
  children: React.ReactNode;
  framed?: boolean;
  className?: string;
}) {
  return (
    <div className={`px-3 py-6 text-center text-xs text-muted ${framed ? 'border border-dashed border-border rounded-card' : ''} ${className}`}>
      {children}
    </div>
  );
}
