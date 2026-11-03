import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CountBadge } from './CountBadge';

export interface ListSwitcherItem {
  id: string;
  title: string;
  icon?: string;
  count?: number;
}

interface ListSwitcherProps {
  // Shown on the button: the list that is open now
  label: string;
  items: ListSwitcherItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

// Title of the open list in the phone header (Doku/ui-patterns.md): a tap opens all lists to switch to
export const ListSwitcher: React.FC<ListSwitcherProps> = ({ label, items, activeId, onSelect }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Liste wechseln"
        className="h-11 -my-1 max-w-full flex items-center gap-1 text-sm font-semibold text-main cursor-pointer"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`w-4 h-4 text-muted flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Liste wechseln"
          className="absolute left-0 top-full mt-1 z-40 w-72 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto py-1 bg-panel border border-border rounded-card shadow-panel"
        >
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  if (!active) onSelect(item.id);
                }}
                className={`w-full h-11 px-3 flex items-center gap-2 text-left text-sm cursor-pointer hover:bg-panel-elevated ${
                  active ? 'text-main font-semibold' : 'text-muted'
                }`}
              >
                {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
                <span className="truncate flex-1">{item.title}</span>
                <CountBadge count={item.count} />
                {active && <Check className="w-4 h-4 text-accent flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
