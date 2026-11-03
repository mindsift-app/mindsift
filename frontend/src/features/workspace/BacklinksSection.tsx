import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Link2 } from 'lucide-react';
import { Backlink } from '../../lib/types';
import { api } from '../../lib/api';
import { useTranslation } from 'react-i18next';

interface BacklinksSectionProps {
  docId: string;
  title: string;
  onOpen: (docId: string, blockId?: string) => void;
}

const COLLAPSED_KEY = 'mindsift:backlinks_collapsed';

// Shows the [[Wiki-Link]] parts of a block in the accent color, the rest as plain text
const Snippet: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\[\[[^\]]*\]\])/g).map((part, i) =>
      part.startsWith('[[') && part.endsWith(']]') ? (
        <span key={i} className="text-accent font-medium">
          {part}
        </span>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    )}
  </>
);

// "Verlinkt auf diese Notiz" at the end of a note. Hidden while nothing links here; reloads shortly
// after the title changes, since links are matched by title.
export const BacklinksSection: React.FC<BacklinksSectionProps> = ({ docId, title, onOpen }) => {
  const { t } = useTranslation('workspace');
  const [links, setLinks] = useState<Backlink[]>([]);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .getBacklinks(docId)
        .then((res) => !cancelled && setLinks(res))
        .catch(() => !cancelled && setLinks([]));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [docId, title]);

  if (links.length === 0) return null;

  const toggle = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, String(!prev));
      } catch {}
      return !prev;
    });
  };

  return (
    <section className="mt-10 pt-4 border-t border-border" aria-label={t('backlinks.label')}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-1.5 min-h-[44px] sm:min-h-0 py-1 text-xs font-semibold text-muted hover:text-main cursor-pointer"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <Link2 className="w-3.5 h-3.5 text-accent" />
        <span>{t('backlinks.title', { count: links.length })}</span>
      </button>
      {!collapsed && (
        <ul className="mt-2 space-y-2">
          {links.map((l) => (
            <li key={l.docId} className="p-3 bg-panel border border-border rounded-card">
              <button
                type="button"
                onClick={() => onOpen(l.docId)}
                className="flex items-center gap-2 min-w-0 max-w-full text-left cursor-pointer group"
              >
                {l.icon && <span className="shrink-0">{l.icon}</span>}
                <span className="text-sm font-semibold text-main truncate group-hover:text-accent">
                  {l.title || t('editor.untitled')}
                </span>
                {l.folderPath && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-faint min-w-0">
                    <Folder className="w-3 h-3 shrink-0" />
                    <span className="truncate">{l.folderPath}</span>
                  </span>
                )}
              </button>
              <ul className="mt-1.5 space-y-1">
                {l.blocks.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(l.docId, b.id)}
                      className="w-full text-left text-xs text-muted hover:text-main px-2 py-1.5 rounded-btn hover:bg-panel-elevated border-l-2 border-border line-clamp-3 break-words cursor-pointer"
                    >
                      <Snippet text={b.content} />
                    </button>
                  </li>
                ))}
              </ul>
              {!!l.more && <p className="mt-1 text-[11px] text-faint">{t('backlinks.more', { count: l.more })}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
