import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Link as LinkIcon,
  FileText,
  Globe,
  X,
  Search,
  ExternalLink,
  Loader2,
  Plus,
  ArrowLeft,
  ListTree,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Document, DocumentBlock } from '../../lib/types';
import { buildBlockLink, buildNoteLink } from '../../lib/wikiLink';
import { SnippetRenderer } from '../../components/SnippetRenderer';
import { NO_AUTOFILL } from '../../lib/noAutofill';

export interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertLink: (markdown: string) => void;
  availableDocs?: { id: string; title: string; icon?: string; folderPath?: string }[];
  /** Text marked in the bullet: the link's own text (without it a note link shows the note's title) */
  label?: string;
}

export const LinkModal: React.FC<LinkModalProps> = ({
  isOpen,
  onClose,
  onInsertLink,
  availableDocs,
  label = '',
}) => {
  const { t } = useTranslation('workspace');
  const [tab, setTab] = useState<'note' | 'web'>('note');
  const [search, setSearch] = useState('');
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);

  const [webTitle, setWebTitle] = useState(label);
  const [webUrl, setWebUrl] = useState('');

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const webTitleInputRef = useRef<HTMLInputElement | null>(null);

  // Load documents when modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (availableDocs && availableDocs.length > 0) {
      setDocs(availableDocs as Document[]);
      return;
    }
    let isCancelled = false;
    setLoading(true);
    api
      .getDocuments()
      .then((fetched) => {
        if (!isCancelled) {
          setDocs(fetched);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, availableDocs]);

  // Focus input on mount or tab change
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (tab === 'note') {
        searchInputRef.current?.focus();
      } else {
        webTitleInputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen, tab]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredDocs = useMemo(() => {
    if (!search.trim()) return docs;
    const q = search.toLowerCase();
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.folderPath && d.folderPath.toLowerCase().includes(q))
    );
  }, [docs, search]);

  // Picking a single bullet of a note (link to that bullet)
  const [pickDoc, setPickDoc] = useState<Document | null>(null);
  const [pickBlocks, setPickBlocks] = useState<DocumentBlock[] | null>(null);
  const [blockSearch, setBlockSearch] = useState('');
  useEffect(() => {
    if (!isOpen) {
      setPickDoc(null);
      setPickBlocks(null);
      setBlockSearch('');
    }
  }, [isOpen]);
  const openBlockPicker = (doc: Document) => {
    setPickDoc(doc);
    setBlockSearch('');
    if (doc.blocks && doc.blocks.length > 0) {
      setPickBlocks(doc.blocks);
      return;
    }
    setPickBlocks(null);
    api
      .getDocument(doc.id)
      .then((full) => setPickBlocks(full.blocks || []))
      .catch(() => setPickBlocks([]));
  };
  const pickableBlocks = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    return (pickBlocks || []).filter(
      (b) => b.content.trim() !== '' && b.type !== 'divider' && (!q || b.content.toLowerCase().includes(q))
    );
  }, [pickBlocks, blockSearch]);

  // Bullets of all notes matching the search (full-text index, like the global search), from 3 letters
  type BlockHit = { docId: string; blockId: string; title: string; icon?: string; snippet: string; content: string };
  const [blockHits, setBlockHits] = useState<BlockHit[]>([]);
  const [blockHitsLoading, setBlockHitsLoading] = useState(false);
  useEffect(() => {
    const q = search.trim();
    if (!isOpen || tab !== 'note' || pickDoc || q.length < 3) {
      setBlockHits([]);
      setBlockHitsLoading(false);
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    setBlockHitsLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchAll(q, { type: 'document' }, abort.signal)
        .then((res) => {
          if (cancelled) return;
          const hits = (res.hits || [])
            .filter((h) => h.type === 'document' && h.blockId && h.docId)
            .slice(0, 8)
            .map((h) => ({
              docId: h.docId!,
              blockId: h.blockId!,
              title: h.title,
              icon: h.icon,
              snippet: h.snippet,
              content: h.content ?? h.snippet.replace(/<\/?mark>/g, ''),
            }));
          setBlockHits(hits);
        })
        .catch(() => !cancelled && setBlockHits([]))
        .finally(() => !cancelled && setBlockHitsLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [search, isOpen, tab, pickDoc]);

  const handleSelectNote = (doc: { id: string; title: string }) => {
    onInsertLink(buildNoteLink(doc.title.trim() || t('link.note'), doc.id, label));
  };

  // Arrow keys move through the list under the search field, Enter inserts the marked entry. In the list
  // of notes, ArrowRight (caret at the end) opens the bullets of the marked note; ArrowLeft in an empty
  // bullet filter goes back.
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const blockSearchInputRef = useRef<HTMLInputElement | null>(null);
  const entryCount = pickDoc ? pickableBlocks.length : filteredDocs.length + blockHits.length;
  useEffect(() => setActive(0), [search, blockSearch, pickDoc, tab]);
  useEffect(() => {
    if (active >= entryCount && entryCount > 0) setActive(entryCount - 1);
  }, [active, entryCount]);
  useEffect(() => {
    listRef.current?.querySelector('[data-link-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, pickDoc]);
  useEffect(() => {
    if (pickDoc) blockSearchInputRef.current?.focus();
    else if (isOpen && tab === 'note') searchInputRef.current?.focus();
  }, [pickDoc, isOpen, tab]);

  const chooseActive = () => {
    if (pickDoc) {
      const b = pickableBlocks[active];
      if (b) onInsertLink(buildBlockLink(pickDoc.title || t('link.note'), pickDoc.id, b.id, label));
      return;
    }
    if (active < filteredDocs.length) {
      handleSelectNote(filteredDocs[active]);
      return;
    }
    const h = blockHits[active - filteredDocs.length];
    if (h) onInsertLink(buildBlockLink(h.title || t('link.note'), h.docId, h.blockId, label));
  };

  const handleListKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const input = e.currentTarget;
    const caretAtEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (entryCount === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + entryCount) % entryCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      chooseActive();
    } else if (e.key === 'ArrowRight' && !pickDoc && caretAtEnd && active < filteredDocs.length) {
      e.preventDefault();
      openBlockPicker(filteredDocs[active]);
    } else if (e.key === 'ArrowLeft' && pickDoc && input.value === '') {
      e.preventDefault();
      setPickDoc(null);
    }
  };

  const handleWebLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = webUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !url.startsWith('#') && !url.startsWith('/')) {
      url = `https://${url}`;
    }
    const label = webTitle.trim() || url;
    onInsertLink(`[${label}](${url})`);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 !m-0 modal-overlay z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-surface w-full max-w-lg p-5 shadow-panel rounded-card border border-border space-y-4 animate-in fade-in zoom-in-95 duration-150">
        {/* Header - identical to UnifiedShareModal */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-btn bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <LinkIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-main truncate">{t('link.title')}</h3>
              <p className="text-[11px] text-muted truncate">
                {t('link.intro')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted hover:text-main rounded-btn hover:bg-panel transition-colors cursor-pointer"
            title={t('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Control Box - matching UnifiedShareModal form header */}
        <div className="space-y-3 p-3 bg-panel-elevated border border-border rounded-card">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-main">{t('link.type')}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTab('note')}
                className={`h-7 px-2.5 text-xs rounded-btn font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                  tab === 'note'
                    ? 'bg-panel border-accent text-accent font-semibold shadow-xs'
                    : 'bg-canvas border-border text-muted hover:text-main'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{t('link.note')}</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('web')}
                className={`h-7 px-2.5 text-xs rounded-btn font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                  tab === 'web'
                    ? 'bg-panel border-accent text-accent font-semibold shadow-xs'
                    : 'bg-canvas border-border text-muted hover:text-main'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{t('link.web')}</span>
              </button>
            </div>
          </div>

          {tab === 'note' ? (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleListKeys}
                {...NO_AUTOFILL}
                placeholder={t('link.searchNote')}
                className="input-field bg-panel h-8 pl-8 pr-2.5 text-xs w-full text-main placeholder:text-muted"
              />
            </div>
          ) : (
            <form onSubmit={handleWebLinkSubmit} className="space-y-2.5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-faint mb-1 block">
                  {t('workspace:link.textLabel')}
                </label>
                <input
                  ref={webTitleInputRef}
                  type="text"
                  value={webTitle}
                  onChange={(e) => setWebTitle(e.target.value)}
                  placeholder={t('link.textPlaceholder')}
                  className="input-field bg-panel h-8 px-2.5 text-xs w-full text-main placeholder:text-muted"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-faint mb-1 block">
                  {t('workspace:link.urlLabel')}
                </label>
                <input
                  type="text"
                  required
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="input-field bg-panel h-8 px-2.5 text-xs w-full text-main placeholder:text-muted"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-action text-xs h-8 px-3.5 cursor-pointer"
                >
                  {t('common:cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!webUrl.trim()}
                  className="btn-primary text-xs h-8 px-3.5 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('link.title')}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Bullets of one note: link to a single bullet */}
        {tab === 'note' && pickDoc && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPickDoc(null)}
                className="btn-icon h-11 w-11 sm:h-7 sm:w-7 shrink-0"
                title={t('link.backToList')}
                aria-label={t('link.backToList')}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-semibold text-main truncate">
                {t('link.pickBlockIn', { title: pickDoc.title || t('editor.untitled') })}
              </span>
            </div>
            <input
              ref={blockSearchInputRef}
              type="text"
              value={blockSearch}
              onChange={(e) => setBlockSearch(e.target.value)}
              onKeyDown={handleListKeys}
              {...NO_AUTOFILL}
              placeholder={t('link.filterBlocks')}
              className="input-field w-full h-11 sm:h-8 px-2.5 text-xs"
              aria-label={t('link.filterBlocksLabel')}
            />
            <div ref={pickDoc ? listRef : undefined} className="space-y-0.5 max-h-64 overflow-y-auto pr-0.5">
              {pickBlocks === null ? (
                <div className="p-4 text-xs text-muted flex items-center gap-2 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span>{t('link.loadingBlocks')}</span>
                </div>
              ) : pickableBlocks.length === 0 ? (
                <div className="p-4 text-xs text-muted text-center">{t('link.noBlocks')}</div>
              ) : (
                pickableBlocks.map((b, i) => (
                  <button
                    key={b.id}
                    type="button"
                    data-link-active={i === active}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => onInsertLink(buildBlockLink(pickDoc.title || t('link.note'), pickDoc.id, b.id, label))}
                    className={`w-full text-left min-h-[44px] sm:min-h-0 py-1.5 pr-2 rounded-btn text-xs flex items-start gap-1.5 cursor-pointer ${
                      i === active ? 'bg-panel-elevated text-accent' : 'text-main'
                    }`}
                    style={{ paddingLeft: `${0.5 + Math.min(b.level || 0, 5) * 0.875}rem` }}
                  >
                    <span className="text-faint shrink-0">•</span>
                    <span className="line-clamp-2 break-words">{b.content}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Note List Section (Matching Active Shares list in UnifiedShareModal) */}
        {tab === 'note' && !pickDoc && (
          <div ref={listRef} className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-muted uppercase tracking-wider px-0.5">
              <span>{t('link.available')}</span>
              <span className="font-mono text-[11px] font-normal lowercase">
                {t('link.notesCount', { count: filteredDocs.length })}
              </span>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
              {loading ? (
                <div className="p-6 bg-canvas border border-border rounded-card text-xs text-muted flex items-center gap-2 justify-center text-center">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span>{t('link.loadingNotes')}</span>
                </div>
              ) : filteredDocs.length === 0 ? (
                <div className="p-4 bg-canvas border border-border rounded-card text-xs text-muted flex items-center gap-2.5 justify-center text-center">
                  <Search className="w-4 h-4 text-faint shrink-0" />
                  <span>
                    {search
                      ? t('link.noneFor', { query: search })
                      : t('link.noNotes')}
                  </span>
                </div>
              ) : (
                filteredDocs.map((d, i) => (
                  <div
                    key={d.id}
                    data-link-active={i === active}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => handleSelectNote(d)}
                    className={`flex items-center justify-between p-2.5 bg-canvas border rounded-card transition-colors group cursor-pointer ${
                      i === active ? 'border-accent' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {d.icon && <span className="text-base shrink-0">{d.icon}</span>}
                      <div className="min-w-0">
                        <div className={`text-xs font-semibold truncate ${i === active ? 'text-accent' : 'text-main'}`}>
                          {d.title || t('editor.untitled')}
                        </div>
                        {d.folderPath && (
                          <div className="text-[10px] text-muted truncate">
                            📁 {d.folderPath}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openBlockPicker(d as Document);
                        }}
                        className="btn-icon h-11 w-11 sm:h-7 sm:w-7 text-muted hover:text-accent"
                        title={t('link.pickBlockTitle')}
                        aria-label={t('link.pickBlock')}
                      >
                        <ListTree className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className={`btn-action text-xs h-7 px-2.5 transition-opacity flex items-center gap-1 text-accent cursor-pointer ${
                          i === active ? 'opacity-100' : 'opacity-0'
                        }`}
                      >
                        <span>{t('link.insert')}</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Matching bullets of all notes: a click links that bullet */}
            {search.trim().length >= 3 && (blockHitsLoading || blockHits.length > 0) && (
              <>
                <div className="flex items-center justify-between text-xs font-semibold text-muted uppercase tracking-wider px-0.5 pt-1">
                  <span>{t('link.blocks')}</span>
                  {blockHitsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />}
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                  {blockHits.map((h, j) => {
                    const i = filteredDocs.length + j;
                    return (
                    <button
                      key={`${h.docId}:${h.blockId}`}
                      type="button"
                      data-link-active={i === active}
                      onMouseMove={() => i !== active && setActive(i)}
                      onClick={() => onInsertLink(buildBlockLink(h.title || t('link.note'), h.docId, h.blockId, label))}
                      className={`w-full text-left p-2.5 min-h-11 bg-canvas border rounded-card transition-colors cursor-pointer space-y-0.5 ${
                        i === active ? 'border-accent' : 'border-border'
                      }`}
                      title={t('link.linkBlock')}
                    >
                      <SnippetRenderer snippet={h.snippet} />
                      <span className="block text-[10px] text-faint truncate">
                        {h.icon ? `${h.icon} ` : ''}
                        {h.title || t('editor.untitled')}
                      </span>
                    </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
