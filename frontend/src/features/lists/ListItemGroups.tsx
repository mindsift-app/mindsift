import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CloudOff, Sparkles, Trash2 } from 'lucide-react';
import { ListItem } from '../../lib/types';
import { OFFLINE_ITEM_PREFIX } from '../../lib/offline';
import { OriginBadge } from '../../components/OriginBadge';
import { getItemCategory, getItemDisplayContent, ItemGroup } from './listItems';
import { useItemEditing } from './useItemEditing';
import { useListDrag } from './useListDrag';

// Open entries of the list, by category, draggable; an empty list shows a hint
export function OpenItemGroups({
  openItems,
  groupedOpenItems,
  drag,
  editing,
  renderItemAuthor,
}: {
  openItems: ListItem[];
  groupedOpenItems: ItemGroup[];
  drag: ReturnType<typeof useListDrag>;
  editing: ReturnType<typeof useItemEditing>;
  renderItemAuthor: (item: ListItem) => React.ReactNode;
}) {
  const { t } = useTranslation('lists');
  const { draggingItemId, setDraggingItemId, dragOverItemTarget, setDragOverItemTarget, dragOverCategoryTarget, setDragOverCategoryTarget, setDragOverListTab, handleItemDragStart, handleItemDragOver, handleItemDragLeave, handleDropOnItem, handleDropOnCategoryHeader } = drag;
  const { editingQtyItemId, setEditingQtyItemId, editingQtyValue, setEditingQtyValue, handleSaveQuantity, handleToggleItem, handleDeleteItem } = editing;
  return (
    <>
      {openItems.length === 0 ? (
        <div className="p-8 text-center text-muted text-sm space-y-1 panel-surface">
          <p className="font-medium text-main flex items-center justify-center gap-1.5">
            <Sparkles className="w-4 h-4 text-accent" />
            <span>{t('allDone')}</span>
          </p>
          <p className="text-xs text-faint">{t('noneOpen')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedOpenItems.map((group) => (
            <div key={group.category || 'uncategorized'} className="space-y-1.5">
              {/* Category Group Header: white text directly on canvas background */}
              {group.label && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-main tracking-wide">
                    {group.label}
                  </span>
                  <span className="badge-neutral font-mono text-[10px]">
                    {group.items.length}
                  </span>
                </div>
              )}

              {/* Lighter panel-surface card container with items */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggingItemId) setDragOverCategoryTarget(group.category);
                }}
                onDragLeave={() => {
                  if (dragOverCategoryTarget === group.category) setDragOverCategoryTarget(null);
                }}
                onDrop={(e) => handleDropOnCategoryHeader(e, group.name)}
                className={`panel-surface divide-y divide-border overflow-hidden transition-all ${
                  dragOverCategoryTarget === group.category && !dragOverItemTarget
                    ? 'ring-2 ring-accent/60 bg-accent/5'
                    : ''
                }`}
              >
                {group.items.map((item) => {
                  const cat = getItemCategory(item);
                  const displayContent = getItemDisplayContent(item);
                  const isDragging = draggingItemId === item.id;
                  const isTarget = dragOverItemTarget?.itemId === item.id;

                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleItemDragStart(e, item)}
                      onDragEnd={() => {
                        setDraggingItemId(null);
                        setDragOverItemTarget(null);
                        setDragOverCategoryTarget(null);
                        setDragOverListTab(null);
                      }}
                      onDragOver={(e) => handleItemDragOver(e, item.id)}
                      onDragLeave={(e) => handleItemDragLeave(e, item.id)}
                      onDrop={(e) => handleDropOnItem(e, item, group.name)}
                      onClick={() => handleToggleItem(item)}
                      className={`px-3.5 py-3.5 sm:px-3 sm:py-2.5 flex items-center justify-between gap-3 cursor-pointer cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-panel-hover group relative ${
                        isDragging ? 'opacity-30 border border-dashed border-accent/40' : ''
                      }`}
                    >
                      {/* Drop insertion line indicator */}
                      {isTarget && dragOverItemTarget.position === 'before' && (
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent z-20 pointer-events-none rounded-full shadow-[0_0_8px_rgba(var(--accent-rgb),0.6)]" />
                      )}
                      {isTarget && dragOverItemTarget.position === 'after' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent z-20 pointer-events-none rounded-full shadow-[0_0_8px_rgba(var(--accent-rgb),0.6)]" />
                      )}

                      <div className="flex items-center gap-3 sm:gap-2.5 min-w-0 flex-1">
                        {/* Eckiges Abhaken */}
                        <button
                          type="button"
                          draggable={false}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleItem(item);
                          }}
                          className={`w-5 h-5 sm:w-4 sm:h-4 checkbox-square flex items-center justify-center flex-shrink-0 transition-colors border ${
                            item.isCompleted
                              ? 'bg-status-ok border-status-ok text-on-accent'
                              : 'border-strong hover:border-accent text-transparent'
                          }`}
                          title={item.isCompleted ? t('markOpen') : t('markDone')}
                        >
                          <Check className="w-3.5 h-3.5 sm:w-3 sm:h-3 stroke-[3]" />
                        </button>

                        <span className="text-sm font-medium text-main truncate">
                          {displayContent}
                        </span>
                        {item.id.startsWith(OFFLINE_ITEM_PREFIX) && (
                          <span title={t('offlineAdded')}>
                            <CloudOff className="w-3.5 h-3.5 text-faint shrink-0" />
                          </span>
                        )}

                        {editingQtyItemId === item.id ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              autoFocus
                              value={editingQtyValue}
                              onChange={(e) => setEditingQtyValue(e.target.value.replace(/[^0-9.,xX]/g, ''))}
                              onKeyDown={async (e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  await handleSaveQuantity(item.id, editingQtyValue);
                                } else if (e.key === 'Escape') {
                                  setEditingQtyItemId(null);
                                }
                              }}
                              onBlur={async () => {
                                await handleSaveQuantity(item.id, editingQtyValue);
                              }}
                              className="w-16 h-8 sm:h-6 px-1.5 text-base sm:text-xs input-field font-semibold text-accent text-center"
                              placeholder={t('quantity')}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingQtyItemId(item.id);
                              setEditingQtyValue(item.quantity || '');
                            }}
                            className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                              item.quantity
                                ? 'badge-accent cursor-pointer hover:brightness-125'
                                : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted hover:text-accent border border-dashed border-border/70 hover:border-accent text-[11px]'
                            }`}
                            title={t('editQuantity')}
                          >
                            {item.quantity || t('item.addQuantity')}
                          </button>
                        )}

                        {cat && !group.label && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium text-accent bg-accent/10 border border-accent/25 rounded-md">
                            #{cat}
                          </span>
                        )}
                      </div>

                      <OriginBadge origin={item.origin} createdAt={item.createdAt} size="xs" />
                      {renderItemAuthor(item)}
                      <button
                        type="button"
                        draggable={false}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteItem(item.id);
                        }}
                        className="btn-icon btn-icon-danger p-2 sm:p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        title={t('deleteItem')}
                      >
                        <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Done entries at the end, with "Clear checked items"
export function CompletedItems({
  completedItems,
  editing,
  renderItemAuthor,
}: {
  completedItems: ListItem[];
  editing: ReturnType<typeof useItemEditing>;
  renderItemAuthor: (item: ListItem) => React.ReactNode;
}) {
  const { t } = useTranslation('lists');
  const { editingQtyItemId, setEditingQtyItemId, editingQtyValue, setEditingQtyValue, handleSaveQuantity, handleToggleItem, handleDeleteItem, handleClearCompleted } = editing;
  return (
    <>
      {completedItems.length > 0 && (
        <div className="space-y-1.5 pt-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              {t('doneCount', { count: completedItems.length })}
            </span>
            <button
              onClick={handleClearCompleted}
              className="btn-action min-h-[36px] sm:min-h-0 text-xs"
            >
              {t('clearDone')}
            </button>
          </div>

          <div className="panel-surface divide-y divide-border opacity-70 overflow-hidden">
            {completedItems.map((item) => {
              const displayContent = getItemDisplayContent(item);

              return (
                <div
                  key={item.id}
                  onClick={() => handleToggleItem(item)}
                  className="px-3.5 py-3 sm:px-3 sm:py-2 flex items-center justify-between gap-3 cursor-pointer hover:bg-panel-hover transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Eckiges Abhaken */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleItem(item);
                      }}
                      className="w-5 h-5 sm:w-4 sm:h-4 checkbox-square flex items-center justify-center flex-shrink-0 transition-colors border bg-status-ok border-status-ok text-on-accent"
                      title={t('markOpen')}
                    >
                      <Check className="w-3.5 h-3.5 sm:w-3 sm:h-3 stroke-[3]" />
                    </button>

                    <span className="text-sm text-faint line-through truncate">
                      {displayContent}
                    </span>

                    {editingQtyItemId === item.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          autoFocus
                          value={editingQtyValue}
                          onChange={(e) => setEditingQtyValue(e.target.value.replace(/[^0-9.,xX]/g, ''))}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              await handleSaveQuantity(item.id, editingQtyValue);
                            } else if (e.key === 'Escape') {
                              setEditingQtyItemId(null);
                            }
                          }}
                          onBlur={async () => {
                            await handleSaveQuantity(item.id, editingQtyValue);
                          }}
                          className="w-16 h-8 sm:h-6 px-1.5 text-base sm:text-xs input-field font-semibold text-accent text-center"
                          placeholder={t('quantity')}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingQtyItemId(item.id);
                          setEditingQtyValue(item.quantity || '');
                        }}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                          item.quantity
                            ? 'text-faint hover:text-main cursor-pointer'
                            : 'opacity-0 group-hover:opacity-60 text-faint hover:text-main text-[11px]'
                        }`}
                        title={t('editQuantity')}
                      >
                        {item.quantity ? `(${item.quantity})` : t('item.addQuantity')}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <OriginBadge origin={item.origin} createdAt={item.createdAt} size="xs" />
                    {renderItemAuthor(item)}
                    {item.completedByName && (
                      <span className="text-xs text-faint">✓ {item.completedByName}</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(item.id);
                      }}
                      className="btn-icon btn-icon-danger p-2 sm:p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      title={t('delete')}
                    >
                      <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
