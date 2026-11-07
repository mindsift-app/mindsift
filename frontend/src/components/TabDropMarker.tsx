// Line beside a tab where the dragged tab would land
export function TabDropMarker({ side }: { side: 'before' | 'after' | null }) {
  if (!side) return null;
  return (
    <span
      aria-hidden
      className={`absolute top-0 bottom-0 w-0.5 bg-accent rounded-full pointer-events-none ${side === 'before' ? '-left-[3px]' : '-right-[3px]'}`}
    />
  );
}
