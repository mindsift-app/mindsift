import React, { useEffect, useRef, useState } from 'react';
import { Bot, Webhook } from 'lucide-react';
import { Origin } from '../lib/types';
import { formatDateTime } from '../lib/format';

interface OriginBadgeProps {
  origin: Origin | undefined;
  // When the entry was created, for the details
  createdAt?: string;
  // xs: Kanban cards and list items; sm: task rows, inbox, detail view; md: triage cards
  size?: 'xs' | 'sm' | 'md';
}

const VIA_LABEL = { api: 'API', mcp: 'MCP' } as const;

const formatWhen = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDateTime(d, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// originDetails: who created and who last changed the entry, as one line for tooltip and detail view
export const originDetails = (origin: Origin | undefined, createdAt?: string): string => {
  if (!origin || (!origin.createdVia && !origin.changedVia)) return '';
  const parts: string[] = [];
  const created = formatWhen(createdAt);
  if (origin.createdVia) {
    const key = origin.createdKey ? ` (${origin.createdKey})` : '';
    parts.push(`Angelegt per ${VIA_LABEL[origin.createdVia]}${key}${created ? ` am ${created}` : ''}`);
  } else {
    parts.push(`In der App angelegt${created ? ` am ${created}` : ''}`);
  }
  if (origin.changedVia) {
    const key = origin.changedKey ? ` (${origin.changedKey})` : '';
    const when = formatWhen(origin.changedAt);
    parts.push(`zuletzt geändert per ${VIA_LABEL[origin.changedVia]}${key}${when ? ` am ${when}` : ''}`);
  }
  return parts.join(' · ');
};

const SIZE_CLASS = {
  xs: 'px-1.5 py-0.2 text-[9px]',
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-[11px]',
};

// One badge for entries an API key created or changed (Doku/ui-patterns.md): icon for the access
// (webhook = REST, robot = MCP) and the key's name. Hover shows the details; a tap opens them, so it
// works on phones too. It stays for good.
export const OriginBadge: React.FC<OriginBadgeProps> = ({ origin, createdAt, size = 'sm' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const via = origin?.createdVia || origin?.changedVia;
  if (!origin || !via) return null;
  const key = origin.createdVia ? origin.createdKey : origin.changedKey;
  const label = key || VIA_LABEL[via];
  const details = originDetails(origin, createdAt);
  const Icon = via === 'mcp' ? Bot : Webhook;

  return (
    <span ref={ref} className="relative inline-flex flex-shrink-0 max-w-full">
      <button
        type="button"
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={details}
        aria-label={details}
        aria-expanded={open}
        className={`relative border border-border bg-canvas text-muted rounded-btn font-medium inline-flex items-center gap-1 max-w-[12rem] cursor-pointer hover:text-main before:absolute before:content-[''] before:inset-x-0 before:-inset-y-3 sm:before:hidden ${SIZE_CLASS[size]}`}
      >
        <Icon className="w-2.5 h-2.5 text-accent flex-shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full mt-1 z-40 w-64 max-w-[80vw] p-2 bg-panel border border-border rounded-card shadow-panel text-[11px] leading-snug text-main whitespace-normal"
        >
          {details}
        </span>
      )}
    </span>
  );
};
