import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
  // In front of the label, on the button and in the list: a colour dot, an icon or an emoji
  lead?: React.ReactNode;
}

interface SelectMenuProps<T extends string> {
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}

// Room the list may take below (or above) the button before it scrolls
const MAX_LIST_HEIGHT = 288;

// Dropdown in the app's look instead of the browser's <select> (Doku/ui-patterns.md): a full-width field
// with the chosen option, a click opens the options below it (above when there is no room). Arrows, Home,
// End, Enter and Escape work as in a <select>. The list is portalled to <body>, so a scrolling dialog does
// not cut it off; clicks in it still bubble to React parents like the dialog, not to its backdrop.
export function SelectMenu<T extends string>({ value, options, onChange, ariaLabel, disabled }: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selectedIndex];

  const place = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < Math.min(MAX_LIST_HEIGHT, options.length * 44) && above > below;
    setPos({
      left: r.left,
      width: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      maxHeight: Math.min(MAX_LIST_HEIGHT, up ? above : below),
    });
  };

  const placeRef = useRef(place);
  placeRef.current = place;

  const openList = () => {
    if (disabled) return;
    setActive(selectedIndex);
    place();
    setOpen(true);
  };

  const pick = (index: number) => {
    setOpen(false);
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
  };

  useLayoutEffect(() => {
    if (!open) return;
    // Keep the list at the button while the dialog scrolls or the window changes size
    const follow = () => placeRef.current();
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === 'ArrowDown') setActive((i) => Math.min(last, i + 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Tab') {
      setOpen(false);
      return;
    } else return;
    // Escape closes only the list; a dialog around it checks defaultPrevented and stays open
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className="w-full h-11 sm:h-8 input-field px-2.5 text-base sm:text-xs bg-panel flex items-center gap-2 text-left cursor-pointer disabled:opacity-50 disabled:cursor-default"
      >
        {selected?.lead && <span className="shrink-0 flex items-center">{selected.lead}</span>}
        <span className="flex-1 min-w-0 truncate">{selected?.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={ariaLabel}
            style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            className="fixed z-[60] min-w-40 overflow-y-auto p-1 bg-panel border border-border rounded-card shadow-panel text-sm sm:text-xs animate-in fade-in duration-100"
          >
            {options.map((option, i) => {
              const isSelected = i === selectedIndex;
              return (
                <div
                  key={option.value}
                  id={`${id}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActive(i)}
                  // Keeps the focus on the button, so the keys keep working after a click
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                  className={`h-11 sm:h-8 px-2 rounded-btn flex items-center gap-2 cursor-pointer ${
                    i === active ? 'bg-panel-elevated' : ''
                  } ${isSelected ? 'text-main font-semibold' : 'text-muted'}`}
                >
                  {option.lead && <span className="shrink-0 flex items-center">{option.lead}</span>}
                  <span className="flex-1 min-w-0 truncate">{option.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
