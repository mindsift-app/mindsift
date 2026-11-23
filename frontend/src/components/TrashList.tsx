import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Trash } from 'lucide-react';
import { askConfirm } from './askConfirm';
import { EmptyState } from './EmptyState';
import { showError } from './ErrorNotice';
import { errorMessage } from '../lib/errorMessage';

interface TrashListProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  // Title and details of an entry (the note's title opens it read-only, the task shows its list …)
  renderItem: (item: T) => React.ReactNode;
  // The name the question before deleting for good quotes
  itemTitle: (item: T) => string;
  onRestore: (item: T) => Promise<void> | void;
  onPurge: (item: T) => Promise<void> | void;
  // Entries one may not change (a shared task list read only) show no buttons
  canEdit?: (item: T) => boolean;
  empty: React.ReactNode;
  // Below the last entry, inside the frame (e.g. "only the newest 500")
  footer?: React.ReactNode;
}

// The trashes of notes, tasks and the Quick Dump in one look (Doku/ui-patterns.md): one framed list,
// each row with "Wiederherstellen" and a red bin that deletes for good after asking at the click
// (askConfirm); nothing is deleted for good with a single tap.
export function TrashList<T>({ items, itemKey, renderItem, itemTitle, onRestore, onPurge, canEdit, empty, footer }: TrashListProps<T>) {
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<void> | void) => {
    setBusy(key);
    try {
      await action();
    } catch (err) {
      showError(errorMessage(err, t('workspace:editor.inTrashAction')));
    } finally {
      setBusy(null);
    }
  };

  const purge = async (item: T) => {
    const ok = await askConfirm({
      message: t('trashList.purgeConfirm', { title: itemTitle(item) }),
      confirmLabel: t('trashList.purge'),
      danger: true,
    });
    if (ok) await run(itemKey(item), () => onPurge(item));
  };

  if (items.length === 0) return <EmptyState framed>{empty}</EmptyState>;
  return (
    <div className="border border-border rounded-card bg-panel divide-y divide-border overflow-hidden">
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const key = itemKey(item);
          const editable = canEdit ? canEdit(item) : true;
          return (
            <li key={key} className="px-3 py-2 flex items-center gap-3 hover:bg-panel-hover" data-trash-item>
              <div className="flex-1 min-w-0">{renderItem(item)}</div>
              {editable && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run(key, () => onRestore(item))}
                    // Phones: the bin's size with the icon only, so the entry's title keeps its room
                    className="btn-action w-11 h-11 sm:w-auto sm:h-8 sm:px-3 text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    title={t('restore')}
                    aria-label={t('restore')}
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-accent" />
                    <span className="hidden sm:inline">{t('restore')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void purge(item)}
                    className="btn-icon btn-icon-danger w-11 h-11 sm:w-8 sm:h-8 shrink-0 disabled:opacity-50"
                    title={t('trashList.purge')}
                    aria-label={t('trashList.purge')}
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {footer}
    </div>
  );
}

// "Papierkorb leeren": asks at the click how many entries go for good, then empties
export function EmptyTrashButton({ count, onEmpty, disabled }: { count: number; onEmpty: () => Promise<void> | void; disabled?: boolean }) {
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState(false);
  const empty = async () => {
    if (!(await askConfirm({ message: t('trashList.emptyConfirm', { count }), confirmLabel: t('trashList.empty'), danger: true }))) return;
    setBusy(true);
    try {
      await onEmpty();
    } catch (err) {
      showError(errorMessage(err, t('workspace:editor.inTrashAction')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => void empty()}
      className="btn-action h-11 sm:h-8 px-3 text-xs font-semibold inline-flex items-center justify-center gap-1.5 text-status-err border-status-err/40 disabled:opacity-50"
    >
      <Trash className="w-3.5 h-3.5" />
      {t('trashList.empty')}
    </button>
  );
}
