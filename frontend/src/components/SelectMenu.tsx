import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useAnchoredPopover } from '../lib/useAnchoredPopover';

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
  // In front of the label, on the button and in the list: a colour dot, an icon or an emoji
  lead?: React.ReactNode;
  disabled?: boolean;
  // Second line in muted text, e.g. why an option is disabled
  hint?: string;
}

interface BaseProps<T extends string> {
  options: SelectMenuOption<T>[];
  ariaLabel: string;
  disabled?: boolean;
  // md: form field in full width (44 px on phones, 32 px from sm); sm: small, as wide as its content
  size?: 'md' | 'sm';
  // Replaces the look of the button (e.g. a tiny field in a task row or a code block's header)
  buttonClassName?: string;
  title?: string;
}

interface SelectMenuProps<T extends string> extends BaseProps<T> {
  value: T;
  onChange: (value: T) => void;
}

interface MultiSelectMenuProps<T extends string> extends BaseProps<T> {
  values: T[];
  onChange: (values: T[]) => void;
  // What the button says; default: the chosen labels, comma-separated
  summary?: string;
  placeholder?: string;
}

// Room the list may take below (or above) the button before it scrolls
const MAX_LIST_HEIGHT = 288;
// From this many options the list gets a search field
const SEARCH_FROM = 13;

const BUTTON_CLASS = {
  md: 'w-full h-11 sm:h-8 input-field px-2.5 gap-2 text-base sm:text-xs bg-panel',
  sm: 'max-w-full h-11 sm:h-8 input-field px-2 gap-1.5 text-sm sm:text-xs bg-panel',
};

// Dropdown in the app's look instead of the browser's <select> (Doku/ui-patterns.md): a field with the
// chosen option, a click opens the options below it (above when there is no room). Arrows, Home, End,
// Enter, Escape and typing the first letters work as in a <select>; long lists get a search field. The
// list is portalled to <body>, so a scrolling dialog does not cut it off; clicks in it still bubble to
// React parents like the dialog, not to its backdrop.
export function SelectMenu<T extends string>({ value, onChange, ...rest }: SelectMenuProps<T>) {
  const selected = rest.options.find((o) => o.value === value) ?? rest.options[0];
  return (
    <MenuBase
      {...rest}
      isSelected={(v) => v === value}
      onPick={(v) => v !== value && onChange(v)}
      closeOnPick
      display={
        <>
          {selected?.lead && <span className="shrink-0 flex items-center">{selected.lead}</span>}
          <span className="flex-1 min-w-0 truncate">{selected?.label}</span>
        </>
      }
    />
  );
}

// The same with ticks: several options at once, the list stays open while ticking
export function MultiSelectMenu<T extends string>({ values, onChange, summary, placeholder, ...rest }: MultiSelectMenuProps<T>) {
  const chosen = rest.options.filter((o) => values.includes(o.value));
  const text = summary ?? chosen.map((o) => o.label).join(', ');
  return (
    <MenuBase
      {...rest}
      multi
      isSelected={(v) => values.includes(v)}
      onPick={(v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])}
      display={<span className={`flex-1 min-w-0 truncate ${text ? '' : 'text-faint'}`}>{text || placeholder}</span>}
    />
  );
}

interface MenuBaseProps<T extends string> extends BaseProps<T> {
  isSelected: (value: T) => boolean;
  onPick: (value: T) => void;
  closeOnPick?: boolean;
  multi?: boolean;
  display: React.ReactNode;
}

function MenuBase<T extends string>({
  options,
  ariaLabel,
  disabled,
  size = 'md',
  buttonClassName,
  title,
  isSelected,
  onPick,
  closeOnPick,
  multi,
  display,
}: MenuBaseProps<T>) {
  const { t } = useTranslation();
  const searchable = options.length >= SEARCH_FROM;
  const { open, setOpen, show, pos, anchorRef, popRef } = useAnchoredPopover<HTMLButtonElement>(
    Math.min(MAX_LIST_HEIGHT, options.length * 44 + (searchable ? 48 : 8)),
    160
  );
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();

  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  const openList = () => {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => isSelected(o.value))));
    show();
  };

  const pick = (index: number) => {
    const option = visible[index];
    if (!option || option.disabled) return;
    if (closeOnPick) setOpen(false);
    onPick(option.value);
  };

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, popRef]);

  // Typing the first letters jumps to the option, like a <select> (the search field takes over in long lists)
  const typeAhead = (key: string) => {
    const now = Date.now();
    const text = (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase();
    typed.current = { text, at: now };
    const index = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(text));
    if (index >= 0) setActive(index);
  };

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < visible.length; i += dir) if (!visible[i].disabled) return i;
    return from;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        openList();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !searchable) {
        openList();
        typeAhead(e.key);
      }
      return;
    }
    if (e.key === 'ArrowDown') setActive((i) => step(i, 1));
    else if (e.key === 'ArrowUp') setActive((i) => step(i, -1));
    else if (e.key === 'Home') setActive(step(-1, 1));
    else if (e.key === 'End') setActive(step(visible.length, -1));
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) pick(active);
    else if (e.key === 'Escape') {
      setOpen(false);
      anchorRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
      return;
    } else {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !searchable) typeAhead(e.key);
      return;
    }
    // Escape closes only the list; a dialog around it checks defaultPrevented and stays open. Keys the list
    // used do not reach the editor around it either (Enter in a code block's header).
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && !searchable ? `${id}-${active}` : undefined}
        className={`${buttonClassName ?? BUTTON_CLASS[size]} flex items-center text-left cursor-pointer disabled:opacity-50 disabled:cursor-default`}
      >
        {display}
        <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ left: pos.left, minWidth: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            className="fixed z-[60] min-w-40 max-w-[calc(100vw-1rem)] flex flex-col bg-panel border border-border rounded-card shadow-panel text-sm sm:text-xs animate-in fade-in duration-100"
            // Keeps the focus where it is (button or search field), so the keys keep working after a click.
            // Events in the list stay in it: React would bubble them to the parents of the button (a note's
            // bullet, a dialog's backdrop).
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.target !== searchRef.current) e.preventDefault();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {searchable && (
              <div className="p-1 border-b border-border flex items-center gap-1.5 px-2.5">
                <Search className="w-3.5 h-3.5 text-muted shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={t('select.search')}
                  aria-label={t('select.search')}
                  aria-controls={`${id}-list`}
                  aria-activedescendant={`${id}-${active}`}
                  className="flex-1 min-w-0 h-11 sm:h-8 bg-transparent text-base sm:text-xs text-main outline-none placeholder:text-faint"
                />
              </div>
            )}
            <div id={`${id}-list`} role="listbox" aria-label={ariaLabel} aria-multiselectable={multi || undefined} className="overflow-y-auto p-1">
              {visible.length === 0 && <div className="px-2 py-2 text-muted">{t('select.noMatch')}</div>}
              {visible.map((option, i) => {
                const chosen = isSelected(option.value);
                return (
                  <div
                    key={option.value}
                    id={`${id}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={chosen}
                    aria-disabled={option.disabled || undefined}
                    onPointerEnter={() => !option.disabled && setActive(i)}
                    onClick={() => pick(i)}
                    className={`min-h-11 sm:min-h-8 px-2 py-1 rounded-btn flex items-center gap-2 ${
                      option.disabled ? 'text-faint cursor-default' : 'cursor-pointer'
                    } ${i === active && !option.disabled ? 'bg-panel-elevated' : ''} ${
                      option.disabled ? '' : chosen ? 'text-main font-semibold' : 'text-muted'
                    }`}
                  >
                    {multi && (
                      <span
                        className={`w-3.5 h-3.5 checkbox-square border flex items-center justify-center shrink-0 ${
                          chosen ? 'bg-accent border-accent text-on-accent' : 'border-strong'
                        }`}
                      >
                        {chosen && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </span>
                    )}
                    {option.lead && <span className="shrink-0 flex items-center">{option.lead}</span>}
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.hint && <span className="text-[10px] font-normal text-muted">{option.hint}</span>}
                    </span>
                    {!multi && chosen && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
