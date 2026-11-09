import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign, Bell, CalendarClock, CheckCheck, CheckCircle2, Eye, PlusCircle, Share2, Trash2, UserPlus } from 'lucide-react';
import { api, triggerHaptic } from '../lib/api';
import { CenterEntry } from '../lib/types';
import { formatRelative } from '../lib/format';
import { CountBadge } from './CountBadge';

const KIND_ICON: Record<string, React.ReactNode> = {
  assigned: <UserPlus className="w-3.5 h-3.5" />,
  mentioned: <AtSign className="w-3.5 h-3.5" />,
  due: <CalendarClock className="w-3.5 h-3.5" />,
  taskDone: <CheckCircle2 className="w-3.5 h-3.5" />,
  taskCreated: <PlusCircle className="w-3.5 h-3.5" />,
  watched: <Eye className="w-3.5 h-3.5" />,
  shared: <Share2 className="w-3.5 h-3.5" />,
};

// The notification center: a bell with the number of unread entries; it opens a small list (phones: full
// width under the header) of everything that happened, newest first. A click on an entry marks it read and
// opens its task, note or list. Quiet: no sound, nothing pops up; open apps follow over the WebSocket.
export function NotificationBell({ variant, onOpen }: { variant: 'desktop' | 'phone'; onOpen: (entry: CenterEntry) => void }) {
  const { t } = useTranslation('common');
  const [items, setItems] = useState<CenterEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(() => {
    api
      .getNotifications()
      .then((res) => {
        setItems(res.items);
        setUnread(res.unread);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const onWs = (e: Event) => {
      const event = (e as CustomEvent<{ event?: string }>).detail?.event;
      if (event === 'NOTIFICATION' || event === 'NOTIFICATIONS_READ' || event === 'NOTIFICATIONS_CLEARED') load();
    };
    window.addEventListener('mindsift:ws', onWs);
    return () => window.removeEventListener('mindsift:ws', onWs);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    triggerHaptic(10);
    if (!open) {
      load();
      setTop((buttonRef.current?.getBoundingClientRect().bottom || 56) + 6);
    }
    setOpen((v) => !v);
  };

  const pick = (entry: CenterEntry) => {
    setOpen(false);
    if (!entry.read) {
      setItems((prev) => prev.map((e) => (e.id === entry.id ? { ...e, read: true } : e)));
      setUnread((n) => Math.max(0, n - 1));
      api.markNotificationsRead([entry.id]).catch(() => {});
    }
    onOpen(entry);
  };

  const markAll = () => {
    setItems((prev) => prev.map((e) => ({ ...e, read: true })));
    setUnread(0);
    api.markNotificationsRead().catch(() => load());
  };

  const clear = () => {
    setItems([]);
    setUnread(0);
    api.clearNotifications().catch(() => load());
  };

  const label = unread > 0 ? t('center.titleUnread', { count: unread }) : t('center.title');
  const phone = variant === 'phone';

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={label}
        aria-label={label}
        className={
          phone
            ? 'w-11 h-11 rounded-full flex items-center justify-center text-muted hover:text-main transition-transform active:scale-95 cursor-pointer'
            : 'relative w-8 h-8 rounded-full bg-panel border border-border text-muted hover:text-main flex items-center justify-center transition-colors cursor-pointer shrink-0'
        }
      >
        {phone ? (
          <span className="relative w-9 h-9 rounded-full flex items-center justify-center bg-panel border border-border">
            <Bell className="w-4 h-4" />
            <CountBadge count={unread} variant="accent" position="corner" />
          </span>
        ) : (
          <>
            <Bell className="w-3.5 h-3.5" />
            <CountBadge count={unread} variant="accent" position="corner" />
          </>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('center.title')}
          style={phone ? { top } : undefined}
          className={`${
            phone ? 'fixed inset-x-2' : 'absolute right-0 top-full mt-2 w-96'
          } z-50 max-w-[calc(100vw-1rem)] max-h-[70vh] flex flex-col rounded-card bg-panel border border-border shadow-panel overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150 origin-top-right`}
        >
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
            <span className="flex-1 text-xs font-semibold text-main">{t('center.title')}</span>
            <button
              type="button"
              onClick={markAll}
              disabled={unread === 0}
              className="btn-icon h-11 w-11 sm:h-7 sm:w-7 disabled:opacity-40"
              title={t('center.markAllRead')}
              aria-label={t('center.markAllRead')}
            >
              <CheckCheck className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={items.length === 0}
              className="btn-icon h-11 w-11 sm:h-7 sm:w-7 disabled:opacity-40"
              title={t('center.clear')}
              aria-label={t('center.clear')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* 2 px between entries, so tinted unread ones do not merge into one */}
          <div className="overflow-y-auto p-1 space-y-0.5">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-faint">{t('center.empty')}</p>
            ) : (
              items.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => pick(entry)}
                  className={`w-full min-h-[44px] px-2.5 py-2 rounded-btn text-left flex items-start gap-2.5 transition-colors cursor-pointer hover:bg-panel-elevated ${
                    entry.read ? '' : 'bg-accent-dim/60'
                  }`}
                >
                  <span className={`mt-0.5 shrink-0 ${entry.read ? 'text-faint' : 'text-accent'}`}>
                    {KIND_ICON[entry.kind] || <Bell className="w-3.5 h-3.5" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-xs leading-snug line-clamp-2 ${entry.read ? 'text-muted' : 'text-main font-medium'}`}>
                      {entry.text}
                    </span>
                    <span className="block text-[10px] text-faint mt-0.5">{formatRelative(entry.createdAt)}</span>
                  </span>
                  {!entry.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-accent shrink-0" aria-label={t('center.unread')} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
