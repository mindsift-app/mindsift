import React, { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import {
  X,
  Check,
  CheckSquare,
  Calendar,
  FileText,
  ShoppingCart,
  RotateCcw,
  Sparkles,
  Mic,
  Keyboard,
  Tag,
  Clock,
  SkipForward,
  Edit3,
  Layers,
  MoreHorizontal,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import { SharedList, Thought } from '../../lib/types';
import { addDays, formatDue } from '../../lib/due';
import { api, triggerHaptic } from '../../lib/api';
import { OriginBadge } from '../../components/OriginBadge';
import { formatDateTime } from '../../lib/format';

interface TriageDeckProps {
  deck: Thought[];
  lists: SharedList[];
  onDeckChange: () => void;
  onOpenDocument: (docId: string) => void;
  onFocusCapture: () => void;
  // The triage's own trash (TriageTrash): thoughts thrown away while sorting
  discardedCount: number;
  onOpenTrash: () => void;
}

interface SwipeableQueueItemProps {
  item: Thought;
  lists: SharedList[];
  onBringToFront: (id: string) => void;
  onOpenActionSheet: (item: Thought) => void;
  onAction: (
    action: 'keep' | 'discard',
    options?: {
      convertTo?: 'task' | 'document' | 'list_item';
      targetListId?: string;
      dueDate?: string;
      thoughtOverride?: Thought;
    }
  ) => void;
}

const SwipeableQueueItem: React.FC<SwipeableQueueItemProps> = ({
  item,
  lists,
  onBringToFront,
  onOpenActionSheet,
  onAction,
}) => {
  const { t } = useTranslation('triage');
  const qx = useMotionValue(0);
  const rightBgOpacity = useTransform(qx, [20, 85], [0, 1]);
  const leftBgOpacity = useTransform(qx, [-85, -20], [1, 0]);
  const didDragRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  return (
    <div className="relative overflow-hidden select-none">
      {/* Swipe Right Background Indicator (Als Aufgabe) */}
      <motion.div
        style={{ opacity: rightBgOpacity }}
        className="pointer-events-none absolute inset-0 bg-accent/20 flex items-center justify-start px-4 text-accent font-semibold text-xs uppercase tracking-wide"
      >
        <span className="flex items-center gap-1.5">
          <CheckSquare className="w-4 h-4" />
          <span>{t('swipe.toTask')}</span>
        </span>
      </motion.div>

      {/* Swipe Left Background Indicator (Wegwerfen) */}
      <motion.div
        style={{ opacity: leftBgOpacity }}
        className="pointer-events-none absolute inset-0 bg-status-err-bg flex items-center justify-end px-4 text-status-err font-semibold text-xs uppercase tracking-wide"
      >
        <span className="flex items-center gap-1.5">
          <span>{t('swipe.discard')}</span>
          <X className="w-4 h-4" />
        </span>
      </motion.div>

      <motion.div
        style={{ x: qx }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.65}
        onPointerDown={(e) => {
          didDragRef.current = false;
          startPosRef.current = { x: e.clientX, y: e.clientY };
          clearHoldTimer();
          holdTimerRef.current = window.setTimeout(() => {
            if (!didDragRef.current) {
              didDragRef.current = true;
              triggerHaptic([20, 40]);
              onOpenActionSheet(item);
            }
          }, 420);
        }}
        onPointerMove={(e) => {
          if (startPosRef.current) {
            const dx = Math.abs(e.clientX - startPosRef.current.x);
            const dy = Math.abs(e.clientY - startPosRef.current.y);
            if (dx > 10 || dy > 10) {
              clearHoldTimer();
            }
          }
        }}
        onPointerUp={clearHoldTimer}
        onPointerCancel={clearHoldTimer}
        onDragStart={() => {
          didDragRef.current = true;
          clearHoldTimer();
        }}
        onDragEnd={(_, info) => {
          clearHoldTimer();
          if (info.offset.x > 85 || info.velocity.x > 450) {
            onAction('keep', { convertTo: 'task', thoughtOverride: item });
          } else if (info.offset.x < -85 || info.velocity.x < -450) {
            onAction('discard', { thoughtOverride: item });
          }
        }}
        onClick={() => {
          if (!didDragRef.current) {
            onBringToFront(item.id);
          }
        }}
        className="relative bg-panel px-4 py-3.5 sm:px-3.5 sm:py-2.5 min-h-[56px] sm:min-h-[44px] flex items-center justify-between gap-3 hover:bg-panel-hover transition-colors group cursor-pointer"
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
          <span className="text-sm sm:text-xs font-medium text-main line-clamp-2 sm:truncate">
            {item.content}
          </span>
          {item.source?.toLowerCase() === 'voice' && (
            <span className="px-1.5 py-0.5 text-[10px] bg-canvas text-accent border border-border rounded-btn flex items-center gap-1 flex-shrink-0">
              <Mic className="w-2.5 h-2.5" /> {t('triage:dictation')}
            </span>
          )}
          <OriginBadge origin={item.origin} createdAt={item.createdAt} />
        </div>

        {/* Desktop quick buttons (hidden on mobile so queue items are clean & easy to tap/swipe) */}
        <div
          className="hidden sm:flex items-center gap-1.5 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onAction('keep', { convertTo: 'task', thoughtOverride: item })}
            title={t('action.taskTitle')}
            className="h-7 px-2.5 bg-canvas hover:bg-accent hover:text-on-accent border border-border rounded-btn text-xs text-muted flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t('action.task')}</span>
          </button>

          <button
            type="button"
            onClick={() => onAction('keep', { convertTo: 'document', thoughtOverride: item })}
            title={t('action.noteTitle')}
            className="h-7 px-2.5 bg-canvas hover:bg-panel-elevated border border-border rounded-btn text-xs text-muted hover:text-main flex items-center gap-1 transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-accent" />
            <span>{t('action.note')}</span>
          </button>

          {lists.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onAction('keep', {
                  convertTo: 'list_item',
                  targetListId: lists[0].id,
                  thoughtOverride: item,
                })
              }
              title={t('putOnList', { title: lists[0].title })}
              className="h-7 px-2.5 bg-canvas hover:bg-panel-elevated border border-border rounded-btn text-xs text-muted hover:text-main flex items-center gap-1 transition-colors cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5 text-accent" />
              <span className="hidden md:inline">{lists[0].title}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onAction('discard', { thoughtOverride: item })}
            title={t('action.discard')}
            className="h-7 w-7 bg-canvas hover:bg-panel-elevated border border-border rounded-btn text-muted hover:text-main flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export const TriageDeck: React.FC<TriageDeckProps> = ({
  deck,
  lists,
  onDeckChange,
  onFocusCapture,
  discardedCount,
  onOpenTrash,
}) => {
  const { t } = useTranslation('triage');
  const writableLists = lists.filter((l) => l.isOwner || l.role !== 'viewer');
  const singleWritableList = writableLists.length === 1 ? writableLists[0] : null;

  const [cards, setCards] = useState<Thought[]>(deck);
  const [lastTriaged, setLastTriaged] = useState<Thought | null>(null);
  const [showDateModal, setShowDateModal] = useState(false);
  // Phones: the waiting queue is folded until asked for
  const [showQueueMobile, setShowQueueMobile] = useState(false);
  const queueRef = useRef<HTMLDivElement | null>(null);
  const [taskDueDate, setTaskDueDate] = useState(() => addDays(1));
  const [showListSelector, setShowListSelector] = useState(false);

  // Long-Press Action Sheet state (for Triage Card or Queue Item)
  const [actionSheetCard, setActionSheetCard] = useState<Thought | null>(null);
  const [sheetMode, setSheetMode] = useState<'main' | 'date' | 'list'>('main');
  const cardHoldTimerRef = useRef<number | null>(null);
  const cardPointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // Inline edit state for cleaning up a hasty Quick Dump note before converting
  const [isEditingCard, setIsEditingCard] = useState(false);
  const [editDraft, setEditDraft] = useState('');

  // Cards sorted here stay out for a while: a deck loaded before the server had the action (the reload
  // after a live event can overtake the one after the action) would otherwise bring them back for a moment
  const sortedOutRef = useRef<Map<string, number>>(new Map());
  const SORTED_OUT_MS = 10_000;
  useEffect(() => {
    const now = Date.now();
    for (const [id, at] of sortedOutRef.current) if (now - at > SORTED_OUT_MS) sortedOutRef.current.delete(id);
    setCards(deck.filter((c) => !sortedOutRef.current.has(c.id)));
  }, [deck]);

  const activeCard = cards[0];
  const nextCard = cards[1];

  useEffect(() => {
    setIsEditingCard(false);
    setEditDraft(activeCard?.content || '');
  }, [activeCard?.id]);

  const clearCardHoldTimer = () => {
    if (cardHoldTimerRef.current !== null) {
      window.clearTimeout(cardHoldTimerRef.current);
      cardHoldTimerRef.current = null;
    }
  };

  const openActionSheetForCard = (card: Thought) => {
    setSheetMode('main');
    setActionSheetCard(card);
  };

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-8, 0, 8]);
  const keepOpacity = useTransform(x, [25, 110], [0, 1]);
  const discardOpacity = useTransform(x, [-110, -25], [1, 0]);
  const cardBorderColor = useTransform(
    x,
    [-140, 0, 140],
    ['rgba(239, 68, 68, 0.7)', 'rgba(255, 255, 255, 0.08)', 'rgba(29, 140, 248, 0.8)']
  );

  const handleAction = async (
    action: 'keep' | 'discard',
    options?: {
      convertTo?: 'task' | 'document' | 'list_item';
      targetListId?: string;
      dueDate?: string;
      thoughtOverride?: Thought;
    }
  ) => {
    const targetCard = options?.thoughtOverride || activeCard;
    if (!targetCard) return;

    triggerHaptic(action === 'keep' ? [10, 20] : 15);

    // Optimistic removal from local deck
    sortedOutRef.current.set(targetCard.id, Date.now());
    setCards((prev) => prev.filter((c) => c.id !== targetCard.id));
    setLastTriaged(targetCard);
    setShowDateModal(false);
    setShowListSelector(false);
    setActionSheetCard(null);
    setIsEditingCard(false);
    x.set(0);

    try {
      await api.triageAction(targetCard.id, action, {
        convertTo: options?.convertTo,
        targetListId: options?.targetListId,
        dueDate: options?.dueDate,
      });
      onDeckChange();
    } catch {
      sortedOutRef.current.delete(targetCard.id); // not sorted after all: it comes back with the reload
      onDeckChange();
    }
  };

  const handleSkipCard = (targetId?: string) => {
    if (cards.length <= 1) return;
    triggerHaptic(10);
    setShowDateModal(false);
    setShowListSelector(false);
    setActionSheetCard(null);
    setIsEditingCard(false);
    x.set(0);
    if (targetId && targetId !== cards[0]?.id) {
      setCards((prev) => {
        const chosen = prev.find((c) => c.id === targetId);
        if (!chosen) return prev;
        return [...prev.filter((c) => c.id !== targetId), chosen];
      });
    } else {
      setCards((prev) => [...prev.slice(1), prev[0]]);
    }
  };

  const handleBringToFront = (thoughtId: string) => {
    triggerHaptic(10);
    setCards((prev) => {
      const chosen = prev.find((c) => c.id === thoughtId);
      if (!chosen) return prev;
      return [chosen, ...prev.filter((c) => c.id !== thoughtId)];
    });
  };

  const handleSaveInlineEdit = async () => {
    if (!activeCard) return;
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed === activeCard.content) {
      setIsEditingCard(false);
      return;
    }
    try {
      const updated = await api.updateThought(activeCard.id, { content: trimmed });
      setCards((prev) => prev.map((c) => (c.id === activeCard.id ? updated : c)));
      setIsEditingCard(false);
      onDeckChange();
    } catch {
      setIsEditingCard(false);
    }
  };

  const handleUndo = async () => {
    if (!lastTriaged) return;
    triggerHaptic(15);
    const toRestore = lastTriaged;
    setLastTriaged(null);
    sortedOutRef.current.delete(toRestore.id);
    await api.triageAction(toRestore.id, 'restore');
    onDeckChange();
  };

  // Keyboard shortcuts for desktop power users
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        !activeCard
      ) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        handleAction('discard');
      } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleAction('keep', { convertTo: 'task' });
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setShowListSelector(false);
        setShowDateModal((prev) => !prev);
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleAction('keep', { convertTo: 'document' });
      } else if (e.key === ' ') {
        e.preventDefault();
        handleSkipCard();
      } else if (e.key === 'Escape' && actionSheetCard) {
        setActionSheetCard(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCard, cards.length, actionSheetCard]);

  const priorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold border border-accent rounded-btn text-accent">
            {t('priority.urgent')}
          </span>
        );
      case 'high':
        return (
          <span className="px-2 py-0.5 text-[11px] font-medium border border-strong rounded-btn text-main">
            {t('priority.high')}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[11px] font-medium bg-panel-elevated text-muted border border-border rounded-btn">
            {t('quickDump')}
          </span>
        );
    }
  };

  const sourceBadge = (source?: string) => {
    const s = (source || '').toLowerCase().trim();
    if (s === 'voice') {
      return (
        <span className="px-2 py-0.5 text-[11px] bg-canvas text-accent border border-border rounded-btn flex items-center gap-1">
          <Mic className="w-3 h-3" /> {t('triage:dictation')}
        </span>
      );
    }
    return null;
  };

  if (!activeCard) {
    return (
      <div className="max-w-xl mx-auto mt-2 p-6 panel-surface text-center">
        <div className="w-12 h-12 bg-accent text-on-accent rounded-xl flex items-center justify-center mx-auto mb-3 shadow-sm">
          <Sparkles className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-main mb-1">{t('empty.title')}</h2>
        <p className="text-muted text-xs sm:text-sm max-w-md mx-auto mb-4">
          <Trans
            t={t}
            i18nKey="empty.text"
            components={{
              b: <strong className="text-main" />,
              kbd: <kbd className="px-1.5 py-0.5 bg-canvas border border-border rounded-btn text-main" />,
            }}
          />
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onFocusCapture}
            className="btn-primary h-10 px-5 text-sm"
          >
            {t('empty.capture')}
          </button>

          {lastTriaged && (
            <button
              onClick={handleUndo}
              className="btn-action h-10 px-4 text-sm"
            >
              <RotateCcw className="w-4 h-4 text-accent" />
              {t('undoLast')}
            </button>
          )}

          {discardedCount > 0 && (
            <button onClick={onOpenTrash} className="btn-action h-10 px-4 text-sm">
              <Trash2 className="w-4 h-4" />
              {t('trashCount', { count: discardedCount })}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    // Desktop: a column filling the height under the header; card and buttons keep their size, the queue
    // takes the rest and scrolls inside (the page only scrolls when the window is too low even for that)
    <div className="w-full max-w-2xl mx-auto select-none space-y-4 sm:flex-1 sm:min-h-0 sm:flex sm:flex-col">
      {/* Top Deck Status & Undo Bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="badge-accent text-xs py-1 px-2.5">
            {t('openCount', { count: cards.length })}
          </span>
          <span className="hidden sm:inline text-xs text-faint">•</span>
          <span className="hidden sm:flex items-center gap-1 text-xs text-muted">
            <Keyboard className="w-3 h-3" /> {t('shortcuts')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {lastTriaged && (
            <button
              onClick={handleUndo}
              className="btn-action h-8 px-3 text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5 text-accent" />
              {t('undo')}
            </button>
          )}
          {/* Phones reach the trash through the menu */}
          {discardedCount > 0 && (
            <button onClick={onOpenTrash} className="hidden sm:inline-flex btn-action h-8 px-3 text-xs" title={t('trashTitle')}>
              <Trash2 className="w-3.5 h-3.5" />
              {discardedCount}
            </button>
          )}
        </div>
      </div>

      {/* Card Stack Container */}
      <div className="relative h-[290px] sm:h-[300px] w-full flex items-center justify-center">
        {/* Background Preview Card */}
        {nextCard && (
          <div
            key={nextCard.id + '-preview'}
            className="absolute inset-x-3 top-3 bottom-0 panel-surface p-4 opacity-40 scale-[0.97] pointer-events-none flex flex-col justify-between"
          >
            <div className="flex items-center gap-1.5">
              {priorityBadge(nextCard.priority)}
              {sourceBadge(nextCard.source)}
              <OriginBadge origin={nextCard.origin} createdAt={nextCard.createdAt} size="md" />
            </div>
            <p className="text-sm text-muted line-clamp-2">{nextCard.content}</p>
            <div className="text-[11px] text-faint">{t('next')}</div>
          </div>
        )}

        {/* Active Draggable & Long-Pressable Card */}
        {/* No exit animation: the leaving card goes at once and the next one slides in. With framer-motion's
            exit (popLayout) a re-render right after it (the deck reloading) showed the leaving card again for a
            frame, which looked like a flicker. */}
        <>
          <motion.div
            key={activeCard.id}
            style={{ x, rotate, borderColor: cardBorderColor }}
            drag={isEditingCard ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.8}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            onPointerDown={(e) => {
              if (isEditingCard) return;
              cardPointerStartRef.current = { x: e.clientX, y: e.clientY };
              clearCardHoldTimer();
              cardHoldTimerRef.current = window.setTimeout(() => {
                triggerHaptic([20, 40]);
                openActionSheetForCard(activeCard);
              }, 420);
            }}
            onPointerMove={(e) => {
              if (cardPointerStartRef.current) {
                const dx = Math.abs(e.clientX - cardPointerStartRef.current.x);
                const dy = Math.abs(e.clientY - cardPointerStartRef.current.y);
                if (dx > 12 || dy > 12) {
                  clearCardHoldTimer();
                }
              }
            }}
            onPointerUp={clearCardHoldTimer}
            onPointerCancel={clearCardHoldTimer}
            onDragStart={clearCardHoldTimer}
            onDragEnd={(_, info) => {
              clearCardHoldTimer();
              if (info.offset.x > 105 || info.velocity.x > 520) {
                handleAction('keep', { convertTo: 'task' });
              } else if (info.offset.x < -105 || info.velocity.x < -520) {
                handleAction('discard');
              }
            }}
            // Slides in by CSS (once, when the card appears): framer-motion's initial/animate started over for a
            // frame on every re-render (the deck reloading), which made the card flash
            className="relative w-full h-full panel-surface p-5 cursor-grab active:cursor-grabbing flex flex-col justify-between overflow-hidden animate-in fade-in zoom-in-[0.97] slide-in-from-bottom-2 duration-200"
          >
            {/* Dynamic Swipe Overlays */}
            <motion.div
              style={{ opacity: keepOpacity }}
              className="pointer-events-none absolute top-3.5 right-3.5 px-3 py-1.5 bg-accent-dim border border-accent rounded-btn text-accent font-semibold text-xs tracking-wide uppercase"
            >
              {t('swipe.toTask')}
            </motion.div>

            <motion.div
              style={{ opacity: discardOpacity }}
              className="pointer-events-none absolute top-3.5 left-3.5 px-3 py-1.5 bg-panel-elevated border border-strong rounded-btn text-main font-semibold text-xs tracking-wide uppercase"
            >
              {t('swipe.discard')}
            </motion.div>

            {/* Card Header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {priorityBadge(activeCard.priority)}
                {sourceBadge(activeCard.source)}
                <OriginBadge origin={activeCard.origin} createdAt={activeCard.createdAt} size="md" />
              </div>
              <div
                className="flex items-center gap-2"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="text-xs text-muted flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(activeCard.createdAt, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => openActionSheetForCard(activeCard)}
                  title={t('moreOptions')}
                  className="h-8 w-8 bg-canvas hover:bg-panel-hover border border-border rounded-btn text-muted hover:text-main flex items-center justify-center cursor-pointer"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Card Body */}
            <div
              className="my-auto py-2"
              onPointerDown={(e) => {
                if (isEditingCard) e.stopPropagation();
              }}
            >
              {isEditingCard ? (
                <div className="space-y-2.5">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={3}
                    autoFocus
                    className="w-full input-field p-2.5 text-sm resize-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingCard(false)}
                      className="btn-action h-9 px-3.5 text-xs"
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveInlineEdit}
                      className="btn-primary h-9 px-4 text-xs"
                    >
                      {t('saveText')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-lg sm:text-xl font-medium text-main leading-relaxed break-words whitespace-pre-wrap">
                  {activeCard.content}
                </p>
              )}
            </div>

            {/* Card Footer: Tags & Touch Gesture Hints */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
              <div className="flex flex-wrap items-center gap-1.5">
                {activeCard.tags && activeCard.tags.length > 0 ? (
                  activeCard.tags.map((tag) => (
                    <span key={tag} className="badge-accent">
                      <Tag className="w-2.5 h-2.5" />#{tag}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-faint">
                    {t('swipeHint')}
                  </span>
                )}
              </div>

              {activeCard.dueDate && (
                <span className="px-2 py-0.5 bg-canvas text-muted border border-border rounded-btn text-xs">
                  📅 {formatDue(activeCard.dueDate)}
                </span>
              )}
            </div>
          </motion.div>
        </>
      </div>

      {/* Desktop-only Popovers */}
      {showDateModal && (
        <div className="hidden sm:flex p-3 panel-surface flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Calendar className="w-4 h-4 text-accent" />
            <span>{t('date.title')}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={taskDueDate}
              onChange={(e) => setTaskDueDate(e.target.value)}
              className="input-field px-2.5 py-1 text-xs"
            />
            <button
              onClick={() => handleAction('keep', { convertTo: 'task', dueDate: taskDueDate })}
              className="btn-primary h-8 px-3 text-xs"
            >
              {t('date.save')}
            </button>
          </div>
        </div>
      )}

      {showListSelector && (
        <div className="hidden sm:block p-3 panel-surface">
          <p className="text-xs text-muted mb-2">
            {t('list.title')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {writableLists.length > 0 ? (
              writableLists.map((lst) => (
                <button
                  key={lst.id}
                  onClick={() =>
                    handleAction('keep', { convertTo: 'list_item', targetListId: lst.id })
                  }
                  className="btn-action h-8 px-3 text-xs"
                >
                  <span>{lst.icon}</span>
                  <span>{lst.title}</span>
                </button>
              ))
            ) : (
              <span className="text-xs text-muted">{t('list.none')}</span>
            )}
          </div>
        </div>
      )}

      {/* Phones: the swipe actions on top (← discard, → task), below a 2×2 block like the long-press sheet */}
      <div className="sm:hidden space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleAction('discard')}
            className="min-h-[52px] px-3 py-2 rounded-xl bg-status-err-bg border border-status-err/30 text-status-err text-sm font-semibold flex items-center justify-center gap-2 touch-manipulation cursor-pointer active:scale-98"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('action.discard')}</span>
          </button>
          <button
            type="button"
            onClick={() => handleAction('keep', { convertTo: 'task' })}
            className="min-h-[52px] px-3 py-2 rounded-xl bg-accent text-on-accent text-sm font-semibold flex items-center justify-center gap-2 touch-manipulation cursor-pointer active:scale-98"
          >
            <span>{t('action.task')}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={writableLists.length === 0}
            onClick={() => {
              if (singleWritableList) {
                handleAction('keep', { convertTo: 'list_item', targetListId: singleWritableList.id });
                return;
              }
              // Phones: the list choice of the bottom sheet (the inline choice above is desktop-only)
              if (!activeCard) return;
              openActionSheetForCard(activeCard);
              setSheetMode('list');
            }}
            className={`min-h-[52px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border text-left flex items-center gap-3 transition-colors cursor-pointer active:scale-98 touch-manipulation ${
              writableLists.length === 0 ? 'opacity-40 cursor-not-allowed' : ''
            }`}
          >
            <ShoppingCart className="w-5 h-5 text-accent flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-main">{t('toList')}</div>
              <div className="text-[11px] text-muted truncate">
                {writableLists.length === 0
                  ? t('noList')
                  : singleWritableList
                  ? singleWritableList.title
                  : t('listHint')}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              // Phones: the date choice of the bottom sheet (the inline one above is desktop-only)
              if (!activeCard) return;
              openActionSheetForCard(activeCard);
              setSheetMode('date');
            }}
            className="min-h-[52px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border text-left flex items-center gap-3 transition-colors cursor-pointer active:scale-98 touch-manipulation"
          >
            <Calendar className="w-5 h-5 text-accent flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-main">{t('withDate')}</div>
              <div className="text-[11px] text-muted">{t('chooseDate')}</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleAction('keep', { convertTo: 'document' })}
            className="min-h-[52px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border text-left flex items-center gap-3 transition-colors cursor-pointer active:scale-98 touch-manipulation"
          >
            <FileText className="w-5 h-5 text-accent flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-main">{t('asNote')}</div>
              <div className="text-[11px] text-muted">{t('inWorkspace')}</div>
            </div>
          </button>

          <button
            type="button"
            disabled={cards.length <= 1}
            onClick={() => handleSkipCard()}
            className={`min-h-[52px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border text-left flex items-center gap-3 transition-colors cursor-pointer active:scale-98 touch-manipulation ${cards.length <= 1 ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <SkipForward className="w-5 h-5 text-muted flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-main">{t('later')}</div>
              <div className="text-[11px] text-muted">{t('laterHint')}</div>
            </div>
          </button>
        </div>
      </div>

      {/* Primary Triage Decision Bar: Hidden on mobile (handled via Mobile Quick Actions / Swipe), shown on Desktop */}
      <div className="hidden sm:flex items-center gap-1.5">
        <button
          onClick={() => handleAction('discard')}
          title={t('discardTitle')}
          className="btn-action flex-1 h-9 px-3 justify-center whitespace-nowrap"
        >
          <X className="w-3.5 h-3.5 text-muted flex-shrink-0" />
          <span>{t('action.discard')}</span>
        </button>

        <button
          onClick={() => handleSkipCard()}
          disabled={cards.length <= 1}
          title={t('laterTitle')}
          className={`btn-action flex-1 h-9 px-3 justify-center whitespace-nowrap ${
            cards.length <= 1 ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          <SkipForward className="w-3.5 h-3.5 text-muted flex-shrink-0" />
          <span>{t('later')}</span>
        </button>

        <button
          disabled={writableLists.length === 0}
          onClick={() => {
            if (singleWritableList) {
              handleAction('keep', {
                convertTo: 'list_item',
                targetListId: singleWritableList.id,
              });
              return;
            }
            setShowDateModal(false);
            setShowListSelector((prev) => !prev);
          }}
          title={
            writableLists.length === 0
              ? t('noList')
              : singleWritableList
              ? t('onList', { title: singleWritableList.title })
              : t('toSharedList')
          }
          className={`btn-action flex-1 min-w-0 h-9 px-3 justify-center whitespace-nowrap ${
            writableLists.length === 0
              ? 'opacity-40 cursor-not-allowed'
              : showListSelector
              ? 'border-accent text-accent bg-accent-dim'
              : ''
          }`}
        >
          <ShoppingCart className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          {/* A long list name is cut off (full name in the tooltip), so the bar never grows wider than the card */}
          <span className="truncate">{singleWritableList ? t('onList', { title: singleWritableList.title }) : t('toList')}</span>
        </button>

        <button
          onClick={() => handleAction('keep', { convertTo: 'document' })}
          title={t('noteTitle')}
          className="btn-action flex-1 h-9 px-3 justify-center whitespace-nowrap"
        >
          <FileText className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          <span>{t('asNote')}</span>
        </button>

        <button
          onClick={() => {
            setShowListSelector(false);
            setShowDateModal((prev) => !prev);
          }}
          title={t('dateTitle')}
          className={`btn-action flex-1 h-9 px-3 justify-center whitespace-nowrap ${
            showDateModal ? 'border-accent text-accent bg-accent-dim' : ''
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          <span>{t('withDate')}</span>
        </button>

        <button
          onClick={() => handleAction('keep', { convertTo: 'task' })}
          title={t('taskTitle')}
          className="btn-primary flex-[1.25] h-9 px-4 justify-center whitespace-nowrap font-semibold"
        >
          <CheckSquare className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{t('action.task')}</span>
        </button>
      </div>

      {/* Waiting Quick Dump Queue List (Touch-sized & Swipeable Left/Right) */}
      {cards.length > 1 && (
        <div className="pt-2 sm:flex-1 sm:min-h-[9rem] sm:flex sm:flex-col" ref={queueRef}>
          {/* Phones: the queue stays folded so the card and its buttons fit on the screen */}
          <button
            type="button"
            aria-expanded={showQueueMobile}
            onClick={() => {
              const opening = !showQueueMobile;
              setShowQueueMobile(opening);
              if (opening) {
                window.setTimeout(() => queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 320);
              }
            }}
            className="sm:hidden w-full min-h-[48px] px-3 rounded-xl border border-border bg-panel text-sm font-medium text-main flex items-center justify-center gap-2 touch-manipulation cursor-pointer"
          >
            <Layers className="w-4 h-4 text-accent" />
            <span>
              {showQueueMobile ? t('queue.hide', { count: cards.length - 1 }) : t('queue.show', { count: cards.length - 1 })}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-muted transition-transform duration-300 ${showQueueMobile ? 'rotate-180' : ''}`}
            />
          </button>
          {/* Folds open/closed on phones; always open from sm upwards */}
          <div
            className={`grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-out sm:flex-1 sm:min-h-0 sm:grid-rows-[1fr] sm:opacity-100 sm:visible ${
              showQueueMobile ? 'grid-rows-[1fr] opacity-100 visible' : 'grid-rows-[0fr] opacity-0 invisible'
            }`}
          >
            <div className="overflow-hidden min-h-0 sm:flex sm:flex-col">
              <div className="flex items-center justify-between mb-2 px-1 pt-2 sm:pt-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-accent" />
                  {t('queue.title', { count: cards.length - 1 })}
                </span>
                <span className="text-[11px] text-faint">
                  {t('queue.hint')}
                </span>
              </div>

              <div className="panel-surface divide-y divide-border max-h-80 sm:max-h-none sm:flex-1 sm:min-h-0 overflow-y-auto overflow-x-hidden">
                {cards.slice(1).map((item) => (
                  <SwipeableQueueItem
                    key={item.id}
                    item={item}
                    lists={writableLists}
                    onBringToFront={handleBringToFront}
                    onOpenActionSheet={openActionSheetForCard}
                    onAction={handleAction}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LONG-PRESS / MORE OPTIONS ACTION SHEET (For Triage Card & Queue Items) */}
      {actionSheetCard && (
        <div
          className="fixed inset-0 !m-0 modal-overlay z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setActionSheetCard(null)}
        >
          <div
            className="w-full sm:max-w-md bg-panel border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-panel p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-4 space-y-3 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Header with Preview */}
            <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-border">
              <div className="min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                  {t('sheet.title')}
                </span>
                <p className="text-sm font-medium text-main line-clamp-2 mt-0.5">
                  {actionSheetCard.content}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionSheetCard(null)}
                className="p-1.5 text-faint hover:text-main rounded-btn cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {sheetMode === 'main' && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={writableLists.length === 0}
                    onClick={() => {
                      if (singleWritableList) {
                        handleAction('keep', {
                          convertTo: 'list_item',
                          targetListId: singleWritableList.id,
                          thoughtOverride: actionSheetCard,
                        });
                        return;
                      }
                      setSheetMode('list');
                    }}
                    title={
                      writableLists.length === 0
                        ? t('noList')
                        : singleWritableList
                        ? t('onList', { title: singleWritableList.title })
                        : t('setOnList')
                    }
                    className={`min-h-[52px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border text-left flex items-center gap-3 transition-colors cursor-pointer active:scale-98 ${
                      writableLists.length === 0 ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    <ShoppingCart className="w-5 h-5 text-accent flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-main">{t('toList')}</div>
                      <div className="text-[11px] text-muted truncate">
                        {writableLists.length === 0
                          ? t('noList')
                          : singleWritableList
                          ? singleWritableList.title
                          : t('listHint')}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSheetMode('date')}
                    className="min-h-[52px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border text-left flex items-center gap-3 transition-colors cursor-pointer active:scale-98"
                  >
                    <Calendar className="w-5 h-5 text-accent flex-shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-main">{t('withDate')}</div>
                      <div className="text-[11px] text-muted">{t('chooseDate')}</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleAction('keep', {
                        convertTo: 'document',
                        thoughtOverride: actionSheetCard,
                      })
                    }
                    className="min-h-[52px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border text-left flex items-center gap-3 transition-colors cursor-pointer active:scale-98"
                  >
                    <FileText className="w-5 h-5 text-accent flex-shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-main">{t('asNote')}</div>
                      <div className="text-[11px] text-muted">{t('inWorkspace')}</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={cards.length <= 1}
                    onClick={() => handleSkipCard(actionSheetCard.id)}
                    className={`min-h-[52px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border text-left flex items-center gap-3 transition-colors cursor-pointer active:scale-98 ${
                      cards.length <= 1 ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    <SkipForward className="w-5 h-5 text-muted flex-shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-main">{t('later')}</div>
                      <div className="text-[11px] text-muted">{t('laterHint')}</div>
                    </div>
                  </button>
                </div>

                {/* Edit Text Button */}
                <button
                  type="button"
                  onClick={() => {
                    const target = actionSheetCard;
                    setActionSheetCard(null);
                    if (target.id !== activeCard.id) {
                      handleBringToFront(target.id);
                    }
                    setEditDraft(target.content);
                    setIsEditingCard(true);
                  }}
                  className="w-full min-h-[46px] px-3.5 py-2 rounded-xl bg-canvas hover:bg-panel-elevated border border-border flex items-center justify-center gap-2 text-sm font-medium text-main transition-colors cursor-pointer"
                >
                  <Edit3 className="w-4 h-4 text-accent" />
                  <span>{t('sheet.editText')}</span>
                </button>

                {/* Primary Swipe Equivalents */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                  <button
                    type="button"
                    onClick={() =>
                      handleAction('discard', { thoughtOverride: actionSheetCard })
                    }
                    className="min-h-[46px] px-3 py-2 rounded-xl bg-status-err-bg border border-status-err/30 text-status-err text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                    <span>{t('action.discard')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleAction('keep', {
                        convertTo: 'task',
                        thoughtOverride: actionSheetCard,
                      })
                    }
                    className="min-h-[46px] px-4 py-2 rounded-xl bg-accent text-on-accent text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <CheckSquare className="w-4 h-4 flex-shrink-0" />
                    <span>{t('action.task')}</span>
                  </button>
                </div>
              </div>
            )}

            {sheetMode === 'date' && (
              <div className="space-y-3">
                <label className="block text-xs font-medium text-muted">
                  {t('sheet.dateTitle')}
                </label>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="input-field w-full h-11 px-3 text-sm"
                />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setSheetMode('main')}
                    className="btn-action flex-1 h-11 text-sm"
                  >
                    {t('sheet.back')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleAction('keep', {
                        convertTo: 'task',
                        dueDate: taskDueDate,
                        thoughtOverride: actionSheetCard,
                      })
                    }
                    className="btn-primary flex-1 h-11 text-sm font-semibold"
                  >
                    {t('sheet.saveDate')}
                  </button>
                </div>
              </div>
            )}

            {sheetMode === 'list' && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted">
                  {t('sheet.listTitle')}
                </p>
                <div className="max-h-60 overflow-y-auto space-y-1.5">
                  {writableLists.length > 0 ? (
                    writableLists.map((lst) => (
                      <button
                        key={lst.id}
                        type="button"
                        onClick={() =>
                          handleAction('keep', {
                            convertTo: 'list_item',
                            targetListId: lst.id,
                            thoughtOverride: actionSheetCard,
                          })
                        }
                        className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl bg-canvas hover:bg-panel-elevated border border-border flex items-center gap-3 text-sm font-medium text-main transition-colors cursor-pointer"
                      >
                        <span className="text-lg">{lst.icon}</span>
                        <span>{lst.title}</span>
                      </button>
                    ))
                  ) : (
                    <div className="py-4 text-center text-xs text-muted">
                      {t('list.none')}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSheetMode('main')}
                  className="btn-action w-full h-10 text-xs"
                >
                  {t('sheet.back')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

