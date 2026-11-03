import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, ExternalLink, Folder, Sparkles } from 'lucide-react';
import { Document } from '../../lib/types';

// One to-do of a note in the collection
export type RollupTodo = { doc: Document; blockId: string; content: string; checked: boolean };

interface TodoRollupViewProps {
  allRollupTodos: RollupTodo[];
  rollupTodosByFolder: Map<string, RollupTodo[]>;
  totalOpenTodos: number;
  collapsedTodoFolders: Set<string>;
  setCollapsedTodoFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  collapsedTodoNotes: Set<string>;
  setCollapsedTodoNotes: React.Dispatch<React.SetStateAction<Set<string>>>;
  todoFolderDrilldown: string | null;
  setTodoFolderDrilldown: (folder: string | null) => void;
  todoGrouping: 'grouped' | 'list';
  setTodoGrouping: (g: 'grouped' | 'list') => void;
  handleJumpToDocBlock: (docId: string, blockId?: string) => void;
  handleToggleRollupTodo: (doc: Document, blockId: string, currentChecked: boolean) => void;
}

// The workspace's to-do collection: every to-do of all notes, grouped by folder and note or as one list,
// optionally limited to a folder; ticking one off changes the note
export function TodoRollupView({
  allRollupTodos,
  rollupTodosByFolder,
  totalOpenTodos,
  collapsedTodoFolders,
  setCollapsedTodoFolders,
  collapsedTodoNotes,
  setCollapsedTodoNotes,
  todoFolderDrilldown,
  setTodoFolderDrilldown,
  todoGrouping,
  setTodoGrouping,
  handleJumpToDocBlock,
  handleToggleRollupTodo,
}: TodoRollupViewProps) {
  const { t } = useTranslation('workspace');
  return (
    /* Each nesting level lays a light tint of the text colour on top: darker per level in
       light themes, lighter per level in dark ones */
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-editor">
      <div className="w-full space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-3 gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-main">
              To-Dos aus Notizen ({totalOpenTodos} offen)
            </h2>
            <p className="text-xs text-muted">
              {t('rollup.intro')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Grouping Selector (matching hashtag switcher style) */}
            <div className="flex items-center bg-main/[0.04] border border-border rounded-btn p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setTodoGrouping('grouped');
                  localStorage.setItem('mindsift_todo_grouping', 'grouped');
                }}
                className={`px-2.5 py-1 rounded-btn font-semibold transition-colors cursor-pointer ${
                  todoGrouping === 'grouped'
                    ? 'bg-panel-elevated text-main shadow-xs'
                    : 'text-muted hover:text-main'
                }`}
                title={t('rollup.byFolder')}
              >
                Gruppiert
              </button>
              <button
                type="button"
                onClick={() => {
                  setTodoGrouping('list');
                  localStorage.setItem('mindsift_todo_grouping', 'list');
                }}
                className={`px-2.5 py-1 rounded-btn font-semibold transition-colors cursor-pointer ${
                  todoGrouping === 'list'
                    ? 'bg-panel-elevated text-main shadow-xs'
                    : 'text-muted hover:text-main'
                }`}
                title={t('rollup.flat')}
              >
                Liste
              </button>
            </div>
          </div>
        </div>

        {/* Folder Drilldown Tag */}
        {todoFolderDrilldown && (
          <div className="flex items-center justify-between p-2 rounded-btn bg-accent/10 border border-accent text-xs">
            <span>
              {t('rollup.filteredBy')} <strong>{todoFolderDrilldown}</strong>
            </span>
            <button
              type="button"
              onClick={() => setTodoFolderDrilldown(null)}
              className="text-accent hover:underline font-semibold cursor-pointer"
            >
              {t('rollup.clearFilter')}
            </button>
          </div>
        )}

        {/* Grouped Folders & To-Dos */}
        {allRollupTodos.length === 0 ? (
          <div className="p-8 text-center text-muted text-xs space-y-1 border border-border rounded-card bg-main/[0.03]">
            <Sparkles className="w-6 h-6 text-accent mx-auto mb-1" />
            <p className="font-semibold text-main">{t('rollup.empty')}</p>
            <p className="text-faint">
              <Trans t={t} i18nKey="rollup.emptyHint" components={{ c: <code /> }} />
            </p>
          </div>
        ) : todoGrouping === 'list' ? (
          /* Flat list of all todos across notes */
          <div className="border border-border rounded-card bg-main/[0.03] p-2 space-y-1">
            {allRollupTodos.map((item) => (
              <div
                key={`${item.doc.id}-${item.blockId}`}
                className="flex items-center justify-between gap-2 p-2 rounded-btn hover:bg-main/[0.06] text-xs transition-colors group cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleRollupTodo(item.doc, item.blockId, item.checked);
                    }}
                    className={`w-3.5 h-3.5 checkbox-square flex items-center justify-center transition-colors border cursor-pointer ${
                      item.checked
                        ? 'bg-status-ok border-status-ok text-on-accent'
                        : 'border-strong hover:border-accent text-transparent'
                    }`}
                  >
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </button>
                  <span
                    onClick={() => handleJumpToDocBlock(item.doc.id, item.blockId)}
                    className={`truncate flex-1 ${
                      item.checked
                        ? 'line-through text-faint'
                        : 'text-main font-medium group-hover:text-accent'
                    }`}
                  >
                    {item.content}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    onClick={() => handleJumpToDocBlock(item.doc.id, item.blockId)}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-btn bg-main/[0.06] text-muted hover:text-main"
                    title={item.doc.title}
                  >
                    {item.doc.icon && <span>{item.doc.icon}</span>}
                    <span className="truncate max-w-[120px]">{item.doc.title}</span>
                    {item.doc.folderPath && (
                      <span className="text-faint text-[10px]">({item.doc.folderPath})</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleJumpToDocBlock(item.doc.id, item.blockId)}
                    className="text-faint hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    title={t('rollup.jump')}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Grouped by Folder -> grouped by Note */
          <div className="space-y-3">
            {Array.from(rollupTodosByFolder.entries()).map(([folderName, items]) => {
              const isCollapsed = collapsedTodoFolders.has(folderName);
              const openCount = items.filter((i) => !i.checked).length;

              // Subgroup by doc
              const docGroupsMap = new Map<string, { doc: Document; items: typeof items }>();
              for (const it of items) {
                const ex = docGroupsMap.get(it.doc.id);
                if (ex) ex.items.push(it);
                else docGroupsMap.set(it.doc.id, { doc: it.doc, items: [it] });
              }

              return (
                <div
                  key={folderName}
                  className="border border-border rounded-card bg-main/[0.03] overflow-hidden"
                >
                  {/* Folder Header */}
                  <div className="p-2 border-b border-border flex items-center justify-between">
                    <div
                      onClick={() => {
                        setCollapsedTodoFolders((prev) => {
                          const next = new Set(prev);
                          if (next.has(folderName)) next.delete(folderName);
                          else next.add(folderName);
                          return next;
                        });
                      }}
                      className="flex items-center gap-2 cursor-pointer select-none"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-faint" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-accent" />
                      )}
                      <Folder className="w-3.5 h-3.5 text-accent" />
                      <span className="font-bold text-xs text-main">{folderName}</span>
                      <span className="badge-neutral text-[10px] font-mono">
                        {openCount} offen
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setTodoFolderDrilldown(folderName)}
                      className="text-[10px] text-muted hover:text-main px-1.5 py-0.5 rounded-btn hover:bg-main/[0.06] cursor-pointer"
                      title={t('rollup.isolate')}
                    >
                      {t('rollup.onlyFolder')}
                    </button>
                  </div>

                  {/* Folder Notes Subgroups */}
                  {!isCollapsed && (
                    <div className="p-2 space-y-3">
                      {Array.from(docGroupsMap.values()).map(({ doc, items: docItems }) => {
                        const docOpenCount = docItems.filter((i) => !i.checked).length;
                        const isDocCollapsed = collapsedTodoNotes.has(doc.id);
                        return (
                          <div
                            key={doc.id}
                            className="border border-border/60 rounded-btn p-2 bg-main/[0.04] space-y-1.5"
                          >
                            <div className="flex items-center justify-between pb-1 border-b border-border/40">
                              <div
                                onClick={() => {
                                  setCollapsedTodoNotes((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(doc.id)) next.delete(doc.id);
                                    else next.add(doc.id);
                                    return next;
                                  });
                                }}
                                className="flex items-center gap-1.5 text-xs font-semibold text-main hover:text-accent cursor-pointer select-none"
                              >
                                {isDocCollapsed ? (
                                  <ChevronRight className="w-3 h-3 text-faint" />
                                ) : (
                                  <ChevronDown className="w-3 h-3 text-accent" />
                                )}
                                {doc.icon && <span>{doc.icon}</span>}
                                <span>{doc.title}</span>
                                <span className="badge-neutral text-[9px] font-mono">
                                  {docOpenCount} offen
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleJumpToDocBlock(doc.id)}
                                className="text-[10px] text-accent hover:underline px-1.5 py-0.5 rounded-btn hover:bg-panel cursor-pointer flex items-center gap-1"
                                title={t('editor.openNote')}
                              >
                                <span>{t('editor.openNote')}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                            </div>

                            {!isDocCollapsed && (
                              <div className="space-y-0.5">
                                {docItems.map((item) => (
                                  <div
                                    key={`${item.doc.id}-${item.blockId}`}
                                    className="flex items-center justify-between gap-2 p-1 rounded-btn hover:bg-main/[0.06] text-xs transition-colors group cursor-pointer"
                                  >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleToggleRollupTodo(
                                            item.doc,
                                            item.blockId,
                                            item.checked
                                          );
                                        }}
                                        className={`w-3.5 h-3.5 checkbox-square flex items-center justify-center transition-colors border cursor-pointer ${
                                          item.checked
                                            ? 'bg-status-ok border-status-ok text-on-accent'
                                            : 'border-strong hover:border-accent text-transparent'
                                        }`}
                                      >
                                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                                      </button>
                                      <span
                                        onClick={() =>
                                          handleJumpToDocBlock(item.doc.id, item.blockId)
                                        }
                                        className={`truncate flex-1 ${
                                          item.checked
                                            ? 'line-through text-faint'
                                            : 'text-main font-medium group-hover:text-accent'
                                        }`}
                                      >
                                        {item.content}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleJumpToDocBlock(item.doc.id, item.blockId)
                                      }
                                      className="text-faint hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                      title={t('rollup.jump')}
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
