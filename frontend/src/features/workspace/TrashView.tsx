import React from 'react';
import { ArrowLeft, Folder, Trash } from 'lucide-react';
import { TrashedDocument } from '../../lib/types';
import { CountBadge } from '../../components/CountBadge';
import { formatDeletedAt } from '../../lib/due';
import { useTranslation } from 'react-i18next';
import { EmptyTrashButton, TrashList } from '../../components/TrashList';

interface TrashViewProps {
  items: TrashedDocument[];
  onOpen: (docId: string) => void;
  onRestore: (item: TrashedDocument) => Promise<void>;
  onPurge: (item: TrashedDocument) => Promise<void>;
  onEmpty: () => Promise<void>;
  onBackMobile: () => void;
}

// Deleted notes and folders: open a note read-only, restore, or delete for good (asked at the click, like
// every trash: components/TrashList.tsx). A folder is one entry with its notes and comes back as a whole.
export const TrashView: React.FC<TrashViewProps> = ({ items, onOpen, onRestore, onPurge, onEmpty, onBackMobile }) => {
  const { t } = useTranslation('workspace');

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-canvas">
      <div className="w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBackMobile}
            className="lg:hidden btn-action h-11 w-11 flex items-center justify-center"
            aria-label={t('trash.back')}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Trash className="w-5 h-5 text-accent" />
          <h1 className="text-xl font-bold text-main">{t('trash.title')}</h1>
          <CountBadge count={items.length} />
          {items.length > 0 && (
            <div className="ml-auto">
              <EmptyTrashButton count={items.length} onEmpty={onEmpty} />
            </div>
          )}
        </div>
        <p className="text-xs text-muted">{t('trash.intro')}</p>

        <TrashList
          items={items}
          itemKey={(item) => item.id}
          itemTitle={(item) => item.title || t('editor.untitled')}
          onRestore={onRestore}
          onPurge={onPurge}
          empty={t('trash.empty')}
          renderItem={(item) =>
            item.kind === 'folder' ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <Folder className="w-5 h-5 text-accent shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-main truncate">{item.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                    <span>{t('trash.folderNotes', { count: item.noteCount || 0 })}</span>
                    {item.folderPath && <span className="truncate">{t('trash.inFolder', { path: item.folderPath })}</span>}
                    <span>{t('tasks:trash.deletedAt', { date: formatDeletedAt(item.deletedAt) })}</span>
                  </span>
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex items-center gap-2.5 w-full min-w-0 text-left cursor-pointer group"
                title={t('trash.viewReadOnly')}
              >
                {item.icon && <span className="text-lg shrink-0">{item.icon}</span>}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-main truncate group-hover:text-accent">
                    {item.title || t('editor.untitled')}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1 min-w-0">
                      <Folder className="w-3 h-3 shrink-0" />
                      <span className="truncate">{item.folderPath || t('rollup.root')}</span>
                    </span>
                    <span>{t('tasks:trash.deletedAt', { date: formatDeletedAt(item.deletedAt) })}</span>
                  </span>
                </span>
              </button>
            )
          }
        />
      </div>
    </div>
  );
};
