import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, triggerHaptic } from '../../lib/api';
import { formatDeletedAt } from '../../lib/due';
import type { Thought } from '../../lib/types';
import { ReadingModal } from '../../components/ReadingModal';
import { LoadingState } from '../../components/Spinner';
import { EmptyTrashButton, TrashList } from '../../components/TrashList';

interface TriageTrashProps {
  onClose: () => void;
  // Something was restored or deleted: counters and the deck change
  onChanged: () => void;
}

// The triage's own trash: thoughts thrown away while sorting. Back into the Quick Dump, or deleted for
// good (one by one, all at once, or after the delay from Kontoeinstellungen → Aufbewahrung); deleting for
// good asks at the click, like every trash (components/TrashList.tsx).
export const TriageTrash: React.FC<TriageTrashProps> = ({ onClose, onChanged }) => {
  const { t } = useTranslation('triage');
  const [items, setItems] = useState<Thought[] | null>(null);

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

  const purge = async (item: Thought) => {
    triggerHaptic(20);
    await api.deleteThought(item.id);
    await load();
    onChanged();
  };

  const empty = async () => {
    triggerHaptic(20);
    await api.purgeDiscarded();
    await load();
    onChanged();
  };

  return (
    <ReadingModal title={t('trashTitle')} onClose={onClose}>
      {items === null ? (
        <LoadingState />
      ) : (
        <div className="space-y-3">
          <TrashList
            items={items}
            itemKey={(item) => item.id}
            itemTitle={(item) => item.content}
            onRestore={restore}
            onPurge={purge}
            empty={t('trash.none')}
            renderItem={(item) => (
              <>
                <p className="text-sm text-main truncate">{item.content}</p>
                {item.triagedAt && <p className="text-[11px] text-faint">{t('trash.discardedAt', { date: formatDeletedAt(item.triagedAt) })}</p>}
              </>
            )}
          />
          {items.length > 0 && (
            <div className="flex justify-end">
              <EmptyTrashButton count={items.length} onEmpty={empty} />
            </div>
          )}
        </div>
      )}
    </ReadingModal>
  );
};
