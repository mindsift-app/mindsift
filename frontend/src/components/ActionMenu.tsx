import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface ActionMenuItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  // Gets the click, e.g. for a confirmation at the mouse position
  onSelect: (e: React.MouseEvent) => void;
  disabled?: boolean;
  // Second line in muted text, e.g. why an entry is disabled
  hint?: string;
  // Longer explanation on mouse-over
  tooltip?: string;
  danger?: boolean;
}

// "⋯" button with a menu of actions, in the style of the note menu: closes on a click outside, on Escape
// and after picking an entry.
export function ActionMenu({ items, label, buttonClassName = 'btn-icon' }: { items: ActionMenuItem[]; label: string; buttonClassName?: string }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        className={buttonClassName}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-max min-w-56 max-w-[calc(100vw-2rem)] rounded-card bg-panel border border-border shadow-lg p-1 z-30 text-xs origin-top-right animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.tooltip}
              onClick={(e) => {
                setOpen(false);
                item.onSelect(e);
              }}
              className={`w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn text-left font-medium flex items-start gap-2 transition-colors ${
                item.disabled
                  ? 'text-faint cursor-default'
                  : item.danger
                  ? 'text-status-err hover:bg-status-err/10 cursor-pointer'
                  : 'text-main hover:bg-panel-elevated cursor-pointer'
              }`}
            >
              <span className={`mt-px shrink-0 ${item.disabled ? '' : item.danger ? '' : 'text-accent'}`}>{item.icon}</span>
              <span className="flex flex-col">
                <span>{item.label}</span>
                {item.hint && <span className="text-[10px] font-normal text-muted">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
