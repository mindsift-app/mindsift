import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellOff, Check, Ellipsis } from 'lucide-react';
import { CountBadge } from './CountBadge';
import { OVERFLOW_HIDDEN_TAB } from '../lib/useOverflowTabs';

export interface MoreTabItem {
  id: string;
  icon?: string;
  title: string;
  count?: number;
  muted?: boolean;
}

interface MoreTabsButtonProps {
  // The tabs that did not fit (empty: the button is only there to be measured)
  items: MoreTabItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  // Something is being dragged that tabs accept: hovering the button opens the list
  dragActive?: boolean;
  // Drop handling of a row, the same as on the tab (move a task or entry into that list)
  rowDropProps?: (id: string) => Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  highlightId?: string | null;
}

// "⋯ 3" at the end of a tab row (useOverflowTabs): a dropdown of the lists that did not fit, like the
// list switcher on phones. While dragging, resting on the button opens it, and its rows take drops.
export const MoreTabsButton = forwardRef<HTMLDivElement, MoreTabsButtonProps>(function MoreTabsButton(
  { items, activeId, onSelect, dragActive, rowDropProps, highlightId },
  ref
) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const empty = items.length === 0;

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
  // A drag that ends anywhere closes a list it opened
  useEffect(() => {
    if (!dragActive) {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, [dragActive]);
  useEffect(() => {
    if (empty) setOpen(false);
  }, [empty]);

  return (
    <div
      ref={(el) => {
        boxRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      className={`shrink-0 ${empty ? OVERFLOW_HIDDEN_TAB : 'relative'}`}
      aria-hidden={empty || undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onDragOver={(e) => {
          if (!dragActive) return;
          e.preventDefault();
          if (!open && !hoverTimer.current) {
            hoverTimer.current = window.setTimeout(() => {
              hoverTimer.current = null;
              setOpen(true);
            }, 400);
          }
        }}
        onDragLeave={() => {
          if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
          hoverTimer.current = null;
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('listMenu.moreLists')}
        className="tool-btn !gap-1"
      >
        <Ellipsis className="w-3.5 h-3.5" />
        <span>{items.length}</span>
      </button>
      {open && !empty && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1.5 z-40 w-72 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto p-1 rounded-card bg-panel border border-border shadow-panel text-xs origin-top-left animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(item.id);
              }}
              {...(rowDropProps ? rowDropProps(item.id) : {})}
              className={`w-full px-2.5 py-1.5 rounded-btn text-left flex items-center gap-2 transition-colors cursor-pointer ${
                highlightId === item.id ? 'ring-2 ring-accent/60 bg-accent/10 text-main' : 'hover:bg-panel-elevated text-main'
              }`}
            >
              <span className="w-4 text-center shrink-0">{item.icon}</span>
              <span className="flex-1 min-w-0 truncate inline-flex items-center">
                <span className="truncate">{item.title}</span>
                <CountBadge count={item.count} position="text" />
              </span>
              {item.muted && <BellOff className="w-3 h-3 text-faint shrink-0" aria-label={t('listMenu.muted')} />}
              {item.id === activeId && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
