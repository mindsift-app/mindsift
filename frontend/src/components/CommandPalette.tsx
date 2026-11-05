import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  Search,
  FileText,
  CheckSquare,
  ShoppingCart,
  X,
  Loader2,
  CornerDownLeft,
  Maximize2,
  Minimize2,
  Check,
} from 'lucide-react';
import { ListItem, SearchFilter, SearchHit, SearchResults, SharedList, TaskList, Thought } from '../lib/types';
import { api } from '../lib/api';
import { formatDue } from '../lib/due';
import { SnippetRenderer } from './SnippetRenderer';
import { requestDocFocus } from '../lib/docFocusRequest';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDocument: (docId: string, blockId?: string) => void;
  onOpenTask: (taskId: string) => void;
  onOpenList: (listId: string) => void;
  // For list names and the list filter of the large view
  lists?: SharedList[];
}

type Kind = 'all' | 'document' | 'thought' | 'list_item';

// The filter chips, in this order (Tab and Strg+1–4 follow it)
// Labels from common:palette.kind.<kind> in the language shown when read
const kind = (k: Kind) => ({
  kind: k,
  get label() {
    return i18n.t(`common:palette.kind.${k}`);
  },
});
const KINDS: { kind: Kind; readonly label: string }[] = [kind('all'), kind('document'), kind('thought'), kind('list_item')];

const priorityLabel = (p: string) => i18n.t(`common:priority.${p}`);

// Hits per kind: a few for the overview, more once narrowed to one kind or in the large view
const LIMIT_ALL = 40;
const LIMIT_ONE = 100;
const LIMIT_LARGE = 200;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onOpenDocument,
  onOpenTask,
  onOpenList,
  lists = [],
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<Kind>('all');
  // Large view (desktop): bigger window, filters per kind and context for every hit
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<SearchFilter>({});
  // Hits per kind of the current text, for the chips (also while narrowed to one kind)
  const [counts, setCounts] = useState<{ query: string; limit: number; values: SearchResults['counts'] }>({ query: '', limit: LIMIT_ALL, values: {} });
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [folders, setFolders] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<number | null>(null);

  // Group hits by category: Notizen, Aufgaben, Listen
  const groupedHits = useMemo(() => {
    const docs: SearchHit[] = [];
    const tasks: SearchHit[] = [];
    const listHits: SearchHit[] = [];

    for (const h of hits) {
      if (h.type === 'document') {
        docs.push(h);
      } else if (h.type === 'thought') {
        tasks.push(h);
      } else if (h.type === 'list_item') {
        listHits.push(h);
      }
    }

    return [
      { key: 'documents', label: i18n.t('common:palette.kind.document'), icon: FileText, items: docs },
      { key: 'tasks', label: i18n.t('common:palette.kind.thought'), icon: CheckSquare, items: tasks },
      { key: 'lists', label: i18n.t('common:palette.kind.list_item'), icon: ShoppingCart, items: listHits },
    ].filter((g) => g.items.length > 0);
  }, [hits]);

  // Flattened array for simple up/down index navigation
  const flatHits = useMemo(() => {
    return groupedHits.flatMap((g) => g.items);
  }, [groupedHits]);

  const thoughtById = useMemo(() => new Map(thoughts.map((t) => [t.id, t])), [thoughts]);
  const itemById = useMemo(() => new Map(listItems.map((li) => [li.id, li])), [listItems]);
  const listTitle = (id?: string) => lists.find((l) => l.id === id)?.title;
  const taskListTitle = (id?: string) => (id ? taskLists.find((l) => l.id === id)?.title : t('tasks:trash.personal'));

  // Focus input and reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHits([]);
      setSelectedIndex(0);
      setKind('all');
      setFilter({});
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Task lists and folders for the filters of the large view
  useEffect(() => {
    if (!isOpen || !expanded) return;
    api.getTaskLists().then(setTaskLists).catch(() => {});
    api.getFolders().then(setFolders).catch(() => {});
  }, [isOpen, expanded]);

  // Filters only count for the kind they belong to, and only in the large view
  const activeFilter = useMemo((): SearchFilter => {
    const limit = expanded ? LIMIT_LARGE : kind === 'all' ? LIMIT_ALL : LIMIT_ONE;
    const out: SearchFilter = { limit };
    if (kind !== 'all') out.type = kind;
    if (!expanded) return out;
    if (kind === 'thought') {
      out.taskStatus = filter.taskStatus;
      out.taskListId = filter.taskListId;
      out.priority = filter.priority;
      out.due = filter.due;
    } else if (kind === 'document') {
      out.folder = filter.folder;
    } else if (kind === 'list_item') {
      out.listId = filter.listId;
      out.itemStatus = filter.itemStatus;
    }
    return out;
  }, [kind, expanded, filter]);

  // 150ms debounce search
  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setLoading(false);
      setSelectedIndex(0);
      return;
    }

    setLoading(true);
    debounceTimerRef.current = window.setTimeout(async () => {
      try {
        const countLimit = expanded ? LIMIT_LARGE : LIMIT_ALL;
        // Narrowed to one kind: the chips still need the numbers of all kinds for this text
        const needCounts = kind !== 'all' && (counts.query !== trimmed || counts.limit !== countLimit);
        const [res, all] = await Promise.all([
          api.searchAll(trimmed, activeFilter),
          needCounts ? api.searchAll(trimmed, { limit: countLimit }) : Promise.resolve(null),
        ]);
        setHits(res.hits || []);
        setThoughts(res.thoughts || []);
        setListItems(res.listItems || []);
        if (kind === 'all') setCounts({ query: trimmed, limit: countLimit, values: res.counts || {} });
        else if (all) setCounts({ query: trimmed, limit: countLimit, values: all.counts || {} });
        setSelectedIndex(0);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
    // counts is only read to skip a second request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, activeFilter]);

  // Keyboard navigation: ↑, ↓, Enter, Escape; Tab and Strg+1–4 switch the kind
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && document.activeElement === inputRef.current) {
        e.preventDefault();
        setKind((cur) => {
          const i = KINDS.findIndex((k) => k.kind === cur);
          return KINDS[(i + (e.shiftKey ? KINDS.length - 1 : 1)) % KINDS.length].kind;
        });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        setKind(KINDS[Number(e.key) - 1].kind);
        return;
      }

      if (flatHits.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % flatHits.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + flatHits.length) % flatHits.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = flatHits[selectedIndex];
        if (selected) {
          executeSelection(selected);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, flatHits, selectedIndex]);

  // Tick a task or list item off (or open it again) without leaving the search
  const toggleDone = async (hit: SearchHit) => {
    if (hit.type === 'thought') {
      const t = thoughtById.get(hit.id);
      if (!t) return;
      const next = !t.isCompleted;
      setThoughts((prev) => prev.map((x) => (x.id === t.id ? { ...x, isCompleted: next } : x)));
      try {
        await api.updateThought(t.id, { isCompleted: next });
      } catch {
        setThoughts((prev) => prev.map((x) => (x.id === t.id ? { ...x, isCompleted: !next } : x)));
      }
    } else if (hit.type === 'list_item') {
      const li = itemById.get(hit.id);
      if (!li) return;
      const next = !li.isCompleted;
      setListItems((prev) => prev.map((x) => (x.id === li.id ? { ...x, isCompleted: next } : x)));
      try {
        await api.toggleListItem(li.listId, li.id, next);
      } catch {
        setListItems((prev) => prev.map((x) => (x.id === li.id ? { ...x, isCompleted: !next } : x)));
      }
    }
  };

  const executeSelection = (hit: SearchHit) => {
    onClose();
    if (hit.type === 'document') {
      // A bullet hit puts the cursor into that bullet already; a note hit into its first bullet
      if (!hit.blockId) requestDocFocus(hit.docId || hit.id);
      onOpenDocument(hit.docId || hit.id, hit.blockId);
    } else if (hit.type === 'thought') {
      onOpenTask(hit.id);
    } else if (hit.type === 'list_item') {
      if (hit.listId) {
        onOpenList(hit.listId);
      }
    }
  };

  if (!isOpen) return null;

  const countLabel = (k: Kind) => {
    if (!query.trim() || counts.query !== query.trim()) return null;
    const v = counts.values || {};
    const n = k === 'all' ? (v.document || 0) + (v.thought || 0) + (v.list_item || 0) : v[k] || 0;
    const capped = k !== 'all' && n >= counts.limit;
    return capped ? `${n}+` : String(n);
  };

  const setFilterValue = (key: keyof SearchFilter, value: string) =>
    setFilter((prev) => ({ ...prev, [key]: value || undefined }));
  const selectClass = 'h-8 px-2 input-field text-xs bg-panel max-w-[12rem]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-0 sm:p-4 sm:pt-16 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Search Modal Container */}
      <div
        className={`w-full h-full bg-panel flex flex-col overflow-hidden shadow-2xl sm:rounded-card sm:border sm:border-border ${
          expanded ? 'sm:h-[85vh] sm:max-w-5xl' : 'sm:h-auto sm:max-h-[80vh] sm:max-w-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Input Bar */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-canvas/40 shrink-0">
          <Search className="w-5 h-5 text-accent shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('palette.placeholder')}
            className="flex-1 bg-transparent border-0 outline-none text-main placeholder-muted text-base sm:text-sm focus:ring-0 p-0"
          />
          {/* One fixed slot for the spinner or the clear button, so the field keeps its width while typing */}
          <span className="w-6 h-6 shrink-0 flex items-center justify-center">
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
            ) : query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setHits([]);
                  inputRef.current?.focus();
                }}
                className="w-6 h-6 flex items-center justify-center text-muted hover:text-main"
                title={t('palette.clear')}
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </span>
          {/* Large view with filters (desktop; on phones the search fills the screen anyway) */}
          <button
            type="button"
            onClick={() => {
              setExpanded((v) => !v);
              if (expanded) setFilter({});
              inputRef.current?.focus();
            }}
            className="hidden sm:flex w-7 h-7 items-center justify-center rounded-btn text-muted hover:text-main hover:bg-panel-elevated shrink-0"
            title={expanded ? t('palette.small') : t('palette.large')}
            aria-label={expanded ? t('palette.small') : t('palette.large')}
            aria-pressed={expanded}
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="sm:hidden px-2 py-1 text-xs font-semibold text-accent"
          >
            {t('common:done')}
          </button>
        </div>

        {/* Kinds as chips, with the number of hits */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border overflow-x-auto shrink-0" role="tablist" aria-label={t('palette.kindLabel')}>
          {KINDS.map((k) => {
            const active = kind === k.kind;
            const n = countLabel(k.kind);
            return (
              <button
                key={k.kind}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setKind(k.kind);
                  inputRef.current?.focus();
                }}
                className={`h-9 sm:h-7 px-3 rounded-pill border text-xs flex items-center gap-1.5 shrink-0 transition-colors ${
                  active ? 'bg-accent/10 border-accent text-main font-semibold' : 'bg-canvas border-border text-muted hover:text-main'
                }`}
              >
                <span>{k.label}</span>
                {n !== null && <span className="text-[10px] font-mono opacity-70">{n}</span>}
              </button>
            );
          })}
        </div>

        {/* Large view: filters of the chosen kind */}
        {expanded && kind !== 'all' && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-canvas/40 shrink-0 text-xs text-muted">
            {kind === 'thought' && (
              <>
                <select className={selectClass} value={filter.taskStatus || ''} onChange={(e) => setFilterValue('taskStatus', e.target.value)} aria-label={t('palette.status')}>
                  <option value="">{t('palette.taskStatusAll')}</option>
                  <option value="open">{t('palette.onlyOpen')}</option>
                  <option value="done">{t('palette.onlyDone')}</option>
                </select>
                <select className={selectClass} value={filter.taskListId || ''} onChange={(e) => setFilterValue('taskListId', e.target.value)} aria-label={t('palette.taskList')}>
                  <option value="">{t('palette.allLists')}</option>
                  <option value="personal">{t('palette.personal')}</option>
                  {taskLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {[l.icon, l.title].filter(Boolean).join(' ')}
                    </option>
                  ))}
                </select>
                <select className={selectClass} value={filter.priority || ''} onChange={(e) => setFilterValue('priority', e.target.value)} aria-label={t('palette.priority')}>
                  <option value="">{t('palette.anyPriority')}</option>
                  <option value="urgent">{t('priority.urgent')}</option>
                  <option value="high">{t('priority.high')}</option>
                  <option value="normal">{t('priority.normal')}</option>
                  <option value="low">{t('priority.low')}</option>
                </select>
                <select className={selectClass} value={filter.due || ''} onChange={(e) => setFilterValue('due', e.target.value)} aria-label={t('palette.due')}>
                  <option value="">{t('palette.anyDue')}</option>
                  <option value="overdue">{t('palette.overdue')}</option>
                  <option value="today">{t('palette.today')}</option>
                  <option value="week">{t('palette.week')}</option>
                </select>
              </>
            )}
            {kind === 'document' && (
              <select className={selectClass} value={filter.folder || ''} onChange={(e) => setFilterValue('folder', e.target.value)} aria-label={t('palette.folder')}>
                <option value="">{t('palette.allFolders')}</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
            {kind === 'list_item' && (
              <>
                <select className={selectClass} value={filter.listId || ''} onChange={(e) => setFilterValue('listId', e.target.value)} aria-label={t('palette.list')}>
                  <option value="">{t('palette.allLists')}</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {[l.icon, l.title].filter(Boolean).join(' ')}
                    </option>
                  ))}
                </select>
                <select className={selectClass} value={filter.itemStatus || ''} onChange={(e) => setFilterValue('itemStatus', e.target.value)} aria-label={t('palette.status')}>
                  <option value="">{t('palette.itemStatusAll')}</option>
                  <option value="open">{t('palette.onlyOpen')}</option>
                  <option value="done">{t('palette.onlyChecked')}</option>
                </select>
              </>
            )}
          </div>
        )}

        {/* Results Container */}
        <div className="flex-1 overflow-y-auto p-2 space-y-4 min-h-[160px]">
          {query.trim() === '' ? (
            <div className="py-12 px-4 text-center text-xs text-muted space-y-1">
              <p className="font-semibold text-main">{t('palette.title')}</p>
              <p>{t('palette.hint')}</p>
            </div>
          ) : flatHits.length === 0 && !loading ? (
            <div className="py-12 px-4 text-center text-xs text-muted space-y-1">
              <p className="font-semibold text-main">{t('palette.noHits')}</p>
              <p>{t('palette.noHitsText', { query })}</p>
            </div>
          ) : (
            groupedHits.map((group) => {
              const GroupIcon = group.icon;
              return (
                <div key={group.key} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold text-accent uppercase tracking-wider">
                    <GroupIcon className="w-3.5 h-3.5" />
                    <span>{group.label}</span>
                  </div>

                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const overallIndex = flatHits.indexOf(item);
                      const isSelected = overallIndex === selectedIndex;
                      const task = item.type === 'thought' ? thoughtById.get(item.id) : undefined;
                      const listItem = item.type === 'list_item' ? itemById.get(item.id) : undefined;
                      const finished = Boolean(task?.isCompleted || listItem?.isCompleted);
                      return (
                        <div
                          key={item.id}
                          onClick={() => executeSelection(item)}
                          onMouseEnter={() => setSelectedIndex(overallIndex)}
                          className={`
                            px-3 py-2.5 rounded-btn flex items-start gap-2.5 transition-colors cursor-pointer border
                            ${
                              isSelected
                                ? 'bg-panel-elevated border-accent text-main'
                                : 'bg-canvas/50 border-transparent text-main hover:bg-panel-elevated'
                            }
                          `}
                        >
                          {task || listItem ? (
                            // Tasks and list items: their real state, ticked off right here
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void toggleDone(item);
                              }}
                              className={`mt-0.5 w-4 h-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors before:absolute before:-inset-3 relative ${
                                finished ? 'bg-status-ok border-status-ok text-on-accent' : 'border-strong hover:border-accent text-transparent'
                              }`}
                              title={finished ? t('palette.reopen') : t('palette.check')}
                              aria-label={finished ? t('palette.reopen') : t('palette.check')}
                              aria-pressed={finished}
                            >
                              <Check className="w-3 h-3 stroke-[3]" />
                            </button>
                          ) : (
                            <div className="mt-0.5 shrink-0 text-base leading-none">{item.icon || '🗒️'}</div>
                          )}

                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`font-semibold text-xs truncate ${finished ? 'line-through text-muted' : ''}`}>
                                {item.title || 'Unbenannt'}
                              </span>
                              {isSelected && (
                                <span className="hidden sm:inline-flex items-center text-[10px] text-accent gap-0.5 shrink-0">
                                  <span>{t('palette.open')}</span>
                                  <CornerDownLeft className="w-3 h-3" />
                                </span>
                              )}
                            </div>

                            {/* Large view: the bullet before the hit */}
                            {expanded && item.before && <p className="text-[11px] text-faint truncate">{item.before}</p>}
                            {item.snippet && (
                              <div>
                                <SnippetRenderer snippet={item.snippet} />
                              </div>
                            )}
                            {expanded && item.after && <p className="text-[11px] text-faint truncate">{item.after}</p>}

                            {/* Large view: where a task or list item belongs and its state */}
                            {expanded && task && (
                              <p className="text-[11px] text-faint flex flex-wrap gap-x-2">
                                <span>{taskListTitle(task.taskListId) || t('palette.taskList')}</span>
                                {task.dueDate && <span>{t('palette.dueOn', { due: formatDue(task.dueDate) })}</span>}
                                {task.priority && task.priority !== 'normal' && <span>{priorityLabel(task.priority)}</span>}
                                {task.isCompleted && <span>{t('palette.done')}</span>}
                              </p>
                            )}
                            {expanded && listItem && (
                              <p className="text-[11px] text-faint flex flex-wrap gap-x-2">
                                <span>{listTitle(listItem.listId) || t('palette.list')}</span>
                                {listItem.isCompleted && <span>{t('palette.checked')}</span>}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Shortcut Bar (Desktop) */}
        <div className="hidden sm:flex items-center justify-between px-4 py-2 bg-canvas/40 border-t border-border text-[11px] text-muted shrink-0">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 bg-panel border border-border rounded font-mono text-[10px] text-accent">↑</kbd>{' '}
              <kbd className="px-1 py-0.5 bg-panel border border-border rounded font-mono text-[10px] text-accent">↓</kbd> {t('common:palette.navigate')}
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-panel border border-border rounded font-mono text-[10px] text-accent">↵</kbd> {t('palette.select')}
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-panel border border-border rounded font-mono text-[10px] text-accent">Tab</kbd> {t('palette.switchKind')}
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-panel border border-border rounded font-mono text-[10px] text-accent">Esc</kbd> {t('close')}
            </span>
          </div>

          <div>
            <span>{t('palette.hits', { count: flatHits.length })}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
