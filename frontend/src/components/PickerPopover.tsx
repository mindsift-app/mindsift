import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search } from 'lucide-react';
import { NO_AUTOFILL } from '../lib/noAutofill';

export interface PickerItem {
  id: string;
  label: string;
  /** Second line in the row (e.g. an e-mail address) and searched as well */
  hint?: string;
  /** Avatar, icon or emoji in front */
  lead?: React.ReactNode;
  /** Something small at the end of the row (e.g. a count) */
  trail?: React.ReactNode;
  /** Already chosen: a check at the end, the row in the accent's text colour */
  selected?: boolean;
}

interface PickerPopoverProps {
  /** The button it opens from; the popover sits below it, kept inside the window */
  anchor: HTMLElement;
  items: PickerItem[];
  placeholder: string;
  empty: string;
  onPick: (item: PickerItem) => void;
  onClose: () => void;
  /** Rows shown at most (default 8); the list scrolls */
  maxResults?: number;
}

const MARGIN = 8;
const MAX_RESULTS = 8;

/** Small search-and-pick popover in the style of "In eigene Notiz umwandeln" (ExtractPopover): a search
 *  field, matching rows, arrows and Enter pick, Escape or a click outside closes. See Doku/ui-patterns.md. */
export const PickerPopover: React.FC<PickerPopoverProps> = ({
  anchor,
  items,
  placeholder,
  empty,
  onPick,
  onClose,
  maxResults = MAX_RESULTS,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, ready: false });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? items.filter((i) => i.label.toLowerCase().includes(q) || (i.hint || '').toLowerCase().includes(q)) : items;
    return hits.slice(0, maxResults);
  }, [items, query, maxResults]);

  useEffect(() => setActive(0), [query]);
  // Arrow keys in a long list: the chosen row stays in view
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-picker-row="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    let left = a.left;
    let top = a.bottom + 4;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
    if (top + height > window.innerHeight - MARGIN) top = a.top - height - 4;
    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top), ready: true });
  }, [anchor]);

  // Only once it is visible: a hidden field cannot take the focus
  useEffect(() => {
    if (pos.ready) inputRef.current?.focus();
  }, [pos.ready]);

  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchor, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) onPick(results[active]);
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      className="fixed z-[70] w-72 max-w-[calc(100vw-1rem)] p-1.5 bg-panel border border-border rounded-card shadow-panel text-xs text-main space-y-1"
    >
      <div className="flex items-center gap-1.5 px-2 h-11 sm:h-8">
        <Search className="w-3.5 h-3.5 text-faint shrink-0" />
        {/* type="search": password managers leave search fields alone (the attributes alone were not enough) */}
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          {...NO_AUTOFILL}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-main placeholder:text-faint text-base sm:text-xs"
        />
      </div>
      {results.length > 0 ? (
        <div className="max-h-64 overflow-y-auto space-y-0.5 border-t border-border pt-1">
          {results.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item)}
              onMouseMove={() => setActive(i)}
              data-picker-row={i}
              className={`w-full min-h-11 sm:min-h-0 flex items-center gap-2 px-2 py-1.5 rounded-btn text-left cursor-pointer transition-colors ${
                active === i ? 'bg-accent-dim text-main' : 'text-main hover:bg-panel-elevated'
              }`}
            >
              {item.lead && <span className="shrink-0 flex items-center">{item.lead}</span>}
              <span className="flex-1 min-w-0">
                <span className={`block truncate ${item.selected ? 'text-accent font-semibold' : ''}`}>{item.label}</span>
                {item.hint && <span className="block truncate text-[10px] text-faint">{item.hint}</span>}
              </span>
              {item.trail}
              {item.selected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
            </button>
          ))}
        </div>
      ) : (
        <p className="px-2 py-1.5 text-faint border-t border-border">{empty}</p>
      )}
    </div>,
    document.body
  );
};
