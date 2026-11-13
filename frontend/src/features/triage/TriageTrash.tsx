import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, RotateCcw, Trash } from 'lucide-react';
import { api, triggerHaptic } from '../../lib/api';
import { formatDeletedAt } from '../../lib/due';
import type { Thought } from '../../lib/types';
import { ReadingModal } from '../../components/ReadingModal';

interface TriageTrashProps {
  onClose: () => void;
  // Something was restored or deleted: counters and the deck change
  onChanged: () => void;
}

// The triage's own trash: thoughts thrown away while sorting. Back into the Quick Dump, or deleted for
// good (one by one, all at once, or after the delay from Kontoeinstellungen → Aufbewahrung). Deleting
// for good takes a second tap on the same button, like the notes trash.
export const TriageTrash: React.FC<TriageTrashProps> = ({ onClose, onChanged }) => {
  const { t } = useTranslation('triage');
  const [items, setItems] = useState<Thought[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = async () => {
    const list = await api.getThoughts('discarded').catch(() => []);
    setItems(Array.isArray(list) ? list : []);
  };

  useEffect(() => {
    // Loads the trash when it opens
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const restore = async (item: Thought) => {
    triggerHaptic(15);
    await api.triageAction(item.id, 'restore');
    await load();
    onChanged();
  };

  const purge = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    triggerHaptic(20);
    setConfirmId(null);
    if (id === '__all__') await api.purgeDiscarded();
    else await api.deleteThought(id);
    await load();
    onChanged();
  };

  return (
    <ReadingModal title={t('trashTitle')} onClose={onClose}>
      {items === null ? (
        <div className="py-6 flex justify-center text-muted">
          <LoaderCircle className="w-5 h-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-muted">{t('trash.none')}</p>
      ) : (
        <div className="space-y-3">
          <div className="divide-y divide-border border border-border rounded-card overflow-hidden">
            {items.map((item) => (
              <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-main truncate">{item.content}</p>
                  {item.triagedAt && <p className="text-[11px] text-faint">{t('trash.discardedAt', { date: formatDeletedAt(item.triagedAt) })}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button type="button" onClick={() => restore(item)} className="btn-action min-h-[38px] sm:min-h-0">
                    <RotateCcw className="w-3 h-3 text-accent" /> {t('sheet.back')}
                  </button>
                  <button
                    type="button"
                    onClick={() => purge(item.id)}
                    className={`btn-icon btn-icon-danger min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 ${confirmId === item.id ? 'text-status-err' : ''}`}
                    title={confirmId === item.id ? t('trash.confirmDelete') : t('trash.delete')}
                    aria-label={t('trash.delete')}
                  >
                    {confirmId === item.id ? <span className="text-[11px] font-semibold px-1">{t('trash.really')}</span> : <Trash className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => purge('__all__')} className="btn-action min-h-[38px] sm:min-h-0 text-status-err">
              <Trash className="w-3.5 h-3.5" />
              {confirmId === '__all__' ? t('trash.confirmEmpty', { count: items.length }) : t('trash.empty')}
            </button>
          </div>
        </div>
      )}
    </ReadingModal>
  );
};
