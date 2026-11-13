import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FilePlusCorner, Search } from 'lucide-react';
import { NO_AUTOFILL } from '../../lib/noAutofill';

export interface ExtractTarget {
  id: string;
  title: string;
  icon?: string;
}

interface ExtractPopoverProps {
  // Where the click was (clientX/clientY); opens right there, kept inside the window. left: x is the
  // popover's left edge (the slash command, under the bullet's text) instead of the button at the right
  x: number;
  y: number;
  align?: 'left' | 'right';
  notes: ExtractTarget[];
  onNewNote: () => void;
  onExisting: (note: ExtractTarget) => void;
  onCancel: () => void;
}

const MARGIN = 8;
const MAX_RESULTS = 8;

// "In eigene Notiz auslagern" at the bullet: a new note (preselected, so click + Enter is the old one-step
// action) or, by typing, one of the existing notes. Escape or a click outside closes it.
export const ExtractPopover: React.FC<ExtractPopoverProps> = ({ x, y, align = 'right', notes, onNewNote, onExisting, onCancel }) => {
  const { t } = useTranslation('workspace');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [query, setQuery] = useState('');
  // 0 = new note, 1… = the results
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes.slice(0, MAX_RESULTS);
    return notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [notes, query]);

  useEffect(() => {
    setActive(query.trim() && results.length > 0 ? 1 : 0);
  }, [query, results.length]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = align === 'left' ? x : x - width + 12;
    let top = y + MARGIN;
    if (left < MARGIN) left = MARGIN;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
    if (top + height > window.innerHeight - MARGIN) top = y - height - MARGIN;
    setPos({ left, top: Math.max(MARGIN, top), ready: true });
    inputRef.current?.focus();
    // The bullet takes the focus back right after the click on its button; typing must go here
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [x, y, align]);

  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [onCancel]);

  // The pointer marks a row only once it really moves: opening the popover under a resting pointer must
  // not take the preselected "new note" away
  const hoverRow = (i: number) => (e: React.MouseEvent) => {
    if (Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > 3) setActive(i);
  };

  const choose = (i: number) => {
    if (i === 0) onNewNote();
    else if (results[i - 1]) onExisting(results[i - 1]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  };

  const rowClass = (on: boolean) =>
    `w-full min-h-11 sm:min-h-0 flex items-center gap-2 px-2 py-1.5 rounded-btn text-left cursor-pointer transition-colors ${
      on ? 'bg-accent-dim text-main' : 'text-main hover:bg-panel-elevated'
    }`;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t('extractMenu.title')}
      onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      className="fixed z-[70] w-72 max-w-[calc(100vw-1rem)] p-1.5 bg-panel border border-border rounded-card shadow-panel text-xs text-main space-y-1"
    >
      <button type="button" onClick={() => choose(0)} onMouseMove={hoverRow(0)} className={rowClass(active === 0)}>
        <FilePlusCorner className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="flex-1 font-medium">{t('extractMenu.newNote')}</span>
        {active === 0 && <kbd className="text-[10px] text-faint font-mono">⏎</kbd>}
      </button>
      <div className="flex items-center gap-1.5 px-2 h-11 sm:h-8 border-t border-border">
        <Search className="w-3.5 h-3.5 text-faint shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          {...NO_AUTOFILL}
          placeholder={t('extractMenu.search')}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-main placeholder:text-faint text-sm sm:text-xs"
        />
      </div>
      {results.length > 0 ? (
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {results.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onClick={() => choose(i + 1)}
              onMouseMove={hoverRow(i + 1)}
              className={rowClass(active === i + 1)}
            >
              <span className="w-4 text-center shrink-0">{n.icon || '🗒️'}</span>
              <span className="flex-1 truncate">{n.title || t('editor.untitled')}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-2 py-1.5 text-faint">{t('extractMenu.none')}</p>
      )}
    </div>,
    document.body
  );
};
