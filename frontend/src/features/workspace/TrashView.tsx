import React, { useState } from 'react';
import { ArrowLeft, Folder, RotateCcw, Trash2 } from 'lucide-react';
import { TrashedDocument } from '../../lib/types';
import { CountBadge } from '../../components/CountBadge';
import { formatDeletedAt } from '../../lib/due';

interface TrashViewProps {
  items: TrashedDocument[];
  onOpen: (docId: string) => void;
  onRestore: (item: TrashedDocument) => Promise<void>;
  onPurge: (item: TrashedDocument) => Promise<void>;
  onEmpty: () => Promise<void>;
  onBackMobile: () => void;
}

// Deleted notes and folders: open a note read-only, restore, or delete for good. A folder is one entry
// with its notes and comes back as a whole. Deleting for good always takes a second tap on the same
// button ("Wirklich löschen?"), which works the same with mouse and touch.
export const TrashView: React.FC<TrashViewProps> = ({ items, onOpen, onRestore, onPurge, onEmpty, onBackMobile }) => {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      setConfirmId(null);
    } catch (err: any) {
      setError(err.message || 'Aktion fehlgeschlagen');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-canvas">
      <div className="w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBackMobile}
            className="lg:hidden btn-action h-11 w-11 flex items-center justify-center"
            aria-label="Zurück zu den Notizen"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Trash2 className="w-5 h-5 text-accent" />
          <h1 className="text-xl font-bold text-main">Papierkorb</h1>
          <CountBadge count={items.length} />
          {items.length > 0 && (
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() =>
                confirmId === '__all__' ? run('__all__', onEmpty) : setConfirmId('__all__')
              }
              className={`ml-auto h-11 sm:h-8 px-3 text-xs font-semibold rounded-btn border transition-colors disabled:opacity-50 ${
                confirmId === '__all__'
                  ? 'bg-status-err/20 text-status-err border-status-err'
                  : 'btn-action text-status-err border-status-err/40'
              }`}
            >
              {confirmId === '__all__' ? `Wirklich ${items.length} endgültig löschen?` : 'Papierkorb leeren'}
            </button>
          )}
        </div>
        <p className="text-xs text-muted">
          Gelöschte Notizen und Ordner bleiben hier, bis du sie wiederherstellst oder endgültig löschst. Ein Ordner kommt mit
          allen Unterordnern und Notizen zurück. Für alle, mit denen etwas geteilt war, ist es bis dahin ausgeblendet.
        </p>
        {error && <p className="text-xs text-status-err">{error}</p>}

        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-faint border border-dashed border-border rounded-card">
            Der Papierkorb ist leer.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((t) => (
              <li
                key={t.id}
                className="p-3 bg-panel border border-border rounded-card flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
              >
                {t.kind === 'folder' ? (
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <Folder className="w-5 h-5 text-accent shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-main truncate">{t.title}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                        <span>
                          Ordner · {t.noteCount === 1 ? '1 Notiz' : `${t.noteCount || 0} Notizen`}
                        </span>
                        {t.folderPath && <span className="truncate">in {t.folderPath}</span>}
                        <span>gelöscht {formatDeletedAt(t.deletedAt)}</span>
                      </span>
                    </span>
                  </div>
                ) : (
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer group"
                  title="Schreibgeschützt ansehen"
                >
                  {t.icon && <span className="text-lg shrink-0">{t.icon}</span>}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-main truncate group-hover:text-accent">
                      {t.title || 'Unbenannte Notiz'}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <Folder className="w-3 h-3 shrink-0" />
                        <span className="truncate">{t.folderPath || 'Hauptebene'}</span>
                      </span>
                      <span>gelöscht {formatDeletedAt(t.deletedAt)}</span>
                    </span>
                  </span>
                </button>
                )}
                <div className="grid grid-cols-2 sm:flex gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => run(t.id, () => onRestore(t))}
                    className="btn-action h-11 sm:h-8 px-3 text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-accent" />
                    Wiederherstellen
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => (confirmId === t.id ? run(t.id, () => onPurge(t)) : setConfirmId(t.id))}
                    className={`h-11 sm:h-8 px-3 text-xs rounded-btn border inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                      confirmId === t.id
                        ? 'bg-status-err/20 text-status-err border-status-err font-semibold'
                        : 'btn-action text-status-err border-status-err/40'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {confirmId === t.id ? 'Wirklich löschen?' : 'Endgültig löschen'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
