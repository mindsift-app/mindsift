import React, { useEffect, useState } from 'react';
import i18n from '../i18n';
import { useTranslation } from 'react-i18next';
import { ArrowRight, SquareCheckBig, Inbox, ShoppingCart, X } from 'lucide-react';
import { api, triggerHaptic } from '../lib/api';
import type { SharedList } from '../lib/types';

// After sharing from another app: the items are already in the Quick Dump (nothing to tap), and for a
// few seconds they can be sent on as a task or onto a list instead – one tap, the flow stays as fast.
const AUTO_HIDE_MS = 8000;

interface SharedImportToastProps {
  thoughtIds: string[]; // created on the server (offline captures have no id yet and get no buttons)
  lists: SharedList[];
  onClose: () => void;
  onConverted: (message: string) => void;
}

export const SharedImportToast: React.FC<SharedImportToastProps> = ({ thoughtIds, lists, onClose, onConverted }) => {
  const { t } = useTranslation();
  const [choosingList, setChoosingList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const writableLists = lists.filter((l) => l.isOwner || l.role !== 'viewer');
  const count = thoughtIds.length;

  // Disappears on its own unless a list is being picked or a conversion runs
  useEffect(() => {
    if (choosingList || busy) return;
    const timer = window.setTimeout(onClose, AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [choosingList, busy, onClose]);

  const convert = async (convertTo: 'task' | 'list_item', list?: SharedList) => {
    triggerHaptic(15);
    setBusy(true);
    setFailed(false);
    try {
      for (const id of thoughtIds) {
        await api.triageAction(id, 'keep', { convertTo, targetListId: list?.id });
      }
      onConverted(
        convertTo === 'task'
          ? i18n.t('common:sharedImport.tasksCreated', { count })
          : i18n.t('common:sharedImport.onList', { count, title: list?.title })
      );
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const toList = () => {
    if (writableLists.length === 1) convert('list_item', writableLists[0]);
    else setChoosingList(true);
  };

  const big =
    'min-h-[52px] px-3 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 touch-manipulation cursor-pointer active:scale-98 disabled:opacity-50';

  return (
    <>
      {/* Tapping anywhere else closes it (transparent, the page stays visible) */}
      <div className="fixed inset-0 z-[59]" onClick={onClose} aria-hidden />
      <div
        role="status"
        className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-4 z-[60] w-[calc(100vw-1.5rem)] max-w-md panel-surface shadow-panel overflow-hidden p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="absolute top-2 right-2 h-8 w-8 flex items-center justify-center rounded-btn text-faint hover:text-main"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="pr-8">
          <p className="flex items-center gap-2 text-base font-semibold text-main">
            <Inbox className="w-5 h-5 text-accent shrink-0" />
            {t('sharedImport.queued', { count })}
          </p>
          <p className="text-xs text-muted mt-1">
            {choosingList ? t('sharedImport.whichList') : t('sharedImport.elsewhere')}
          </p>
        </div>

        {failed && <p className="text-xs text-status-err">{t('sharedImport.failed')}</p>}

        {!choosingList ? (
          <div className={`grid gap-2 ${writableLists.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {writableLists.length > 0 && (
              <button type="button" disabled={busy} onClick={toList} className={`${big} bg-canvas border border-border text-main`}>
                <ShoppingCart className="w-4 h-4 text-accent" />
                <span>{t('sharedImport.list')}</span>
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => convert('task')} className={`${big} bg-accent text-on-accent`}>
              <SquareCheckBig className="w-4 h-4" />
              <span>{t('sharedImport.task')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {writableLists.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={busy}
                onClick={() => convert('list_item', l)}
                className={`${big} bg-canvas border border-border text-main`}
              >
                <span>{l.icon}</span>
                <span className="truncate">{l.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
