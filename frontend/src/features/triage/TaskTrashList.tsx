import { RotateCcw, Trash } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TaskList, TrashedTask } from '../../lib/types';
import { formatDeletedAt } from '../../lib/due';

interface TaskTrashListProps {
  items: TrashedTask[];
  lists: TaskList[];
  // "Alle Aufgaben": every entry names the list it came from
  showList: boolean;
  onRestore: (item: TrashedTask) => void;
  onPurge: (item: TrashedTask) => void;
}

// Task trash of TasksView: deleted, cleared and automatically cleaned-up tasks with restore and purge
export function TaskTrashList({ items, lists, showList, onRestore, onPurge }: TaskTrashListProps) {
  const { t } = useTranslation('tasks');
  return (
    <div className="panel-surface divide-y divide-border">
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-muted text-sm">{t('trash.empty')}</div>
      ) : (
        items.map((item) => {
          const listOfItem = item.taskListId ? lists.find((l) => l.id === item.taskListId) : undefined;
          return (
            <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-panel-hover">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <Trash className="w-4 h-4 text-faint flex-shrink-0" />
                <div className="min-w-0">
                  <p className={`text-sm truncate ${item.isCompleted ? 'text-muted line-through' : 'text-main'}`}>{item.content}</p>
                  <p className="text-[11px] text-faint truncate">
                    {showList && (
                      <>
                        {listOfItem ? (listOfItem.icon ? `${listOfItem.icon} ${listOfItem.title}` : listOfItem.title) : t('trash.personal')}
                        {' · '}
                      </>
                    )}
                    {item.trashedBy
                      ? t('trash.deletedAtBy', { date: formatDeletedAt(item.trashedAt), name: item.trashedBy })
                      : t('trash.deletedAtAuto', { date: formatDeletedAt(item.trashedAt) })}
                  </p>
                </div>
              </div>
              {item.canEdit && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => onRestore(item)} className="btn-action min-h-[38px] sm:min-h-0">
                    <RotateCcw className="w-3 h-3 text-accent" /> {t('triage:sheet.back')}
                  </button>
                  <button
                    onClick={() => onPurge(item)}
                    className="btn-icon btn-icon-danger min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0"
                    title={t('trash.delete')}
                    aria-label={t('trash.delete')}
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
