import { RotateCcw, Trash2 } from 'lucide-react';
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
  return (
    <div className="panel-surface divide-y divide-border">
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-muted text-sm">Der Papierkorb ist leer.</div>
      ) : (
        items.map((item) => {
          const listOfItem = item.taskListId ? lists.find((l) => l.id === item.taskListId) : undefined;
          return (
            <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-panel-hover">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <Trash2 className="w-4 h-4 text-faint flex-shrink-0" />
                <div className="min-w-0">
                  <p className={`text-sm truncate ${item.isCompleted ? 'text-muted line-through' : 'text-main'}`}>{item.content}</p>
                  <p className="text-[11px] text-faint truncate">
                    {showList && (
                      <>
                        {listOfItem ? (listOfItem.icon ? `${listOfItem.icon} ${listOfItem.title}` : listOfItem.title) : 'Persönlich'}
                        {' · '}
                      </>
                    )}
                    gelöscht {formatDeletedAt(item.trashedAt)}
                    {item.trashedBy ? ` von ${item.trashedBy}` : ' (automatisch)'}
                  </p>
                </div>
              </div>
              {item.canEdit && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => onRestore(item)} className="btn-action min-h-[38px] sm:min-h-0">
                    <RotateCcw className="w-3 h-3 text-accent" /> Zurück
                  </button>
                  <button
                    onClick={() => onPurge(item)}
                    className="btn-icon btn-icon-danger min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0"
                    title="Endgültig löschen"
                    aria-label="Endgültig löschen"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
