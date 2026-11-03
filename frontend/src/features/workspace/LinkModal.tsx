import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { buildBlockLink } from '../../lib/wikiLink';
import { SnippetRenderer } from '../../components/SnippetRenderer';

export interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertLink: (markdown: string) => void;
  availableDocs?: { id: string; title: string; icon?: string; folderPath?: string }[];
}

export const LinkModal: React.FC<LinkModalProps> = ({
  isOpen,
  onClose,
  onInsertLink,
  availableDocs,
}) => {
  const [tab, setTab] = useState<'note' | 'web'>('note');
  const [search, setSearch] = useState('');
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);

  const [webTitle, setWebTitle] = useState('');
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
    setBlockHitsLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchAll(q)
        .then((res) => {
          if (cancelled) return;
          const docsById = new Map((res.documents || []).map((d) => [d.id, d]));
          const hits = (res.hits || [])
            .filter((h) => h.type === 'document' && h.blockId && h.docId)
            .slice(0, 8)
            .map((h) => {
              const block = docsById.get(h.docId!)?.blocks?.find((b) => b.id === h.blockId);
              return {
                docId: h.docId!,
                blockId: h.blockId!,
                title: h.title,
                icon: h.icon,
                snippet: h.snippet,
                content: block?.content ?? h.snippet.replace(/<\/?mark>/g, ''),
              };
            });
          setBlockHits(hits);
        })
        .catch(() => !cancelled && setBlockHits([]))
        .finally(() => !cancelled && setBlockHitsLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, isOpen, tab, pickDoc]);

  const handleSelectNote = (doc: { title: string }) => {
    const noteTitle = doc.title.trim() || 'Notiz';
    onInsertLink(`[[${noteTitle}]]`);
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
              <h3 className="text-sm font-bold text-main truncate">Link einfügen</h3>
              <p className="text-[11px] text-muted truncate">
                Notiz intern verknüpfen oder externen Web-Link einbetten
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted hover:text-main rounded-btn hover:bg-panel transition-colors cursor-pointer"
            title="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Control Box - matching UnifiedShareModal form header */}
        <div className="space-y-3 p-3 bg-panel-elevated border border-border rounded-card">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-main">Link-Typ:</span>
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
                <span>Notiz</span>
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
                <span>Web-Link</span>
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
                placeholder="Notiz suchen (Titel oder Ordner)…"
                className="input-field bg-panel h-8 pl-8 pr-2.5 text-xs w-full text-main placeholder:text-muted"
              />
            </div>
          ) : (
            <form onSubmit={handleWebLinkSubmit} className="space-y-2.5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-faint mb-1 block">
                  Link-Text / Label
                </label>
                <input
                  ref={webTitleInputRef}
                  type="text"
                  value={webTitle}
                  onChange={(e) => setWebTitle(e.target.value)}
                  placeholder="z. B. MindSift Dokumentation"
                  className="input-field bg-panel h-8 px-2.5 text-xs w-full text-main placeholder:text-muted"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-faint mb-1 block">
                  Web-Adresse (URL) *
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
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={!webUrl.trim()}
                  className="btn-primary text-xs h-8 px-3.5 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Link einfügen</span>
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
                title="Zurück zur Notizliste"
                aria-label="Zurück zur Notizliste"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-semibold text-main truncate">
                Punkt in „{pickDoc.title || 'Unbenannte Notiz'}“ wählen
              </span>
            </div>
            <input
              type="text"
              value={blockSearch}
              onChange={(e) => setBlockSearch(e.target.value)}
              placeholder="Punkte filtern…"
              className="input-field w-full h-11 sm:h-8 px-2.5 text-xs"
              aria-label="Punkte filtern"
            />
            <div className="space-y-0.5 max-h-64 overflow-y-auto pr-0.5">
              {pickBlocks === null ? (
                <div className="p-4 text-xs text-muted flex items-center gap-2 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span>Punkte werden geladen…</span>
                </div>
              ) : pickableBlocks.length === 0 ? (
                <div className="p-4 text-xs text-muted text-center">Keine passenden Punkte.</div>
              ) : (
                pickableBlocks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onInsertLink(buildBlockLink(pickDoc.title || 'Notiz', b.id, b.content))}
                    className="w-full text-left min-h-[44px] sm:min-h-0 py-1.5 pr-2 rounded-btn text-xs text-main hover:bg-panel-elevated hover:text-accent flex items-start gap-1.5 cursor-pointer"
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
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-muted uppercase tracking-wider px-0.5">
              <span>Verfügbare Notizen</span>
              <span className="font-mono text-[11px] font-normal lowercase">
                {filteredDocs.length} {filteredDocs.length === 1 ? 'Notiz' : 'Notizen'}
              </span>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
              {loading ? (
                <div className="p-6 bg-canvas border border-border rounded-card text-xs text-muted flex items-center gap-2 justify-center text-center">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span>Notizen werden geladen…</span>
                </div>
              ) : filteredDocs.length === 0 ? (
                <div className="p-4 bg-canvas border border-border rounded-card text-xs text-muted flex items-center gap-2.5 justify-center text-center">
                  <Search className="w-4 h-4 text-faint shrink-0" />
                  <span>
                    {search
                      ? `Keine Notiz für "${search}" gefunden.`
                      : 'Keine Notizen im Workspace vorhanden.'}
                  </span>
                </div>
              ) : (
                filteredDocs.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => handleSelectNote(d)}
                    className="flex items-center justify-between p-2.5 bg-canvas border border-border rounded-card hover:border-accent/60 transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {d.icon && <span className="text-base shrink-0">{d.icon}</span>}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-main truncate group-hover:text-accent">
                          {d.title || 'Unbenannte Notiz'}
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
                        title="Einen einzelnen Punkt dieser Notiz verlinken"
                        aria-label="Punkt dieser Notiz wählen"
                      >
                        <ListTree className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-action text-xs h-7 px-2.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-accent cursor-pointer"
                      >
                        <span>Einfügen</span>
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
                  <span>Punkte</span>
                  {blockHitsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />}
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                  {blockHits.map((h) => (
                    <button
                      key={`${h.docId}:${h.blockId}`}
                      type="button"
                      onClick={() => onInsertLink(buildBlockLink(h.title || 'Notiz', h.blockId, h.content))}
                      className="w-full text-left p-2.5 min-h-11 bg-canvas border border-border rounded-card hover:border-accent/60 transition-colors cursor-pointer space-y-0.5"
                      title="Diesen Punkt verlinken"
                    >
                      <SnippetRenderer snippet={h.snippet} />
                      <span className="block text-[10px] text-faint truncate">
                        {h.icon ? `${h.icon} ` : ''}
                        {h.title || 'Unbenannte Notiz'}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
