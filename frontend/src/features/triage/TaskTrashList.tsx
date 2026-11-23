import { useTranslation } from 'react-i18next';
import { TaskList, TrashedTask } from '../../lib/types';
import { formatDeletedAt } from '../../lib/due';
import { TrashList } from '../../components/TrashList';

interface TaskTrashListProps {
  items: TrashedTask[];
  lists: TaskList[];
  // "Alle Aufgaben": every entry names the list it came from
  showList: boolean;
  onRestore: (item: TrashedTask) => Promise<void> | void;
  onPurge: (item: TrashedTask) => Promise<void> | void;
}

// GET /tasks/trash answers with the newest this many entries (storage.TaskTrashLimit)
const TASK_TRASH_LIMIT = 500;

// Task trash of TasksView: deleted, cleared and automatically cleaned-up tasks with restore and purge
export function TaskTrashList({ items, lists, showList, onRestore, onPurge }: TaskTrashListProps) {
  const { t } = useTranslation('tasks');
  return (
    <TrashList
      items={items}
      itemKey={(item) => item.id}
      itemTitle={(item) => item.content}
      canEdit={(item) => item.canEdit}
      onRestore={onRestore}
      onPurge={onPurge}
      empty={t('trash.empty')}
      renderItem={(item) => {
        const listOfItem = item.taskListId ? lists.find((l) => l.id === item.taskListId) : undefined;
        return (
          <>
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
          </>
        );
      }}
      footer={
        items.length >= TASK_TRASH_LIMIT && (
          <div className="px-4 py-2 text-center text-faint text-xs">{t('trash.limited', { count: TASK_TRASH_LIMIT })}</div>
        )
      }
    />
  );
}
