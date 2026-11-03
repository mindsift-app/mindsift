import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Check,
  Columns,
} from 'lucide-react';
import { KanbanColumn } from '../../lib/types';
import { triggerHaptic } from '../../lib/api';

interface ManageColumnsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialColumns: KanbanColumn[];
  onSave: (columns: KanbanColumn[]) => Promise<void>;
  listTitle?: string;
}

// Names come from tasks:columns.<id> in the language shown when read (copies keep the name of that moment)
const defaultColumn = (col: Omit<KanbanColumn, 'name'>): KanbanColumn => ({
  ...col,
  get name() {
    return i18n.t(`tasks:columns.${col.id}`);
  },
});
export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  defaultColumn({ id: 'todo' }),
  defaultColumn({ id: 'in_progress', color: 'accent' }),
  defaultColumn({ id: 'waiting', color: 'amber' }),
  defaultColumn({ id: 'done', isDone: true, color: 'emerald' }),
];

// Wrapper and content split so the hooks always run in the same number (see TaskDetailModal)
// Colours a column can get; all come from the theme (blue and purple via --color-info / --color-purple)
const columnColor = (id: string, cls: string) => ({
  id,
  cls,
  get label() {
    return i18n.t(`tasks:colors.${id}`);
  },
});
export const COLUMN_COLORS: { id: string; readonly label: string; cls: string }[] = [
  columnColor('gray', 'bg-faint'),
  columnColor('slate', 'bg-main'),
  columnColor('green', 'bg-status-ok'),
  columnColor('yellow', 'bg-status-warn'),
  columnColor('blue', 'bg-tone-blue'),
  columnColor('red', 'bg-status-err'),
  columnColor('purple', 'bg-tone-purple'),
  columnColor('accent', 'bg-accent'),
];
// Names the server's default columns use
const COLOR_ALIASES: Record<string, string> = { emerald: 'green', amber: 'yellow' };

const columnColorId = (col: KanbanColumn): string => {
  if (col.color) return COLOR_ALIASES[col.color] || col.color;
  // Columns without a colour (older boards) keep the colour of their role
  if (col.isDone) return 'green';
  if (col.id === 'in_progress') return 'accent';
  if (col.id === 'waiting') return 'yellow';
  return 'gray';
};

// Dot colour of a status column (Kanban header, list view, task detail)
export const columnDotClass = (col: KanbanColumn | undefined): string =>
  (col && COLUMN_COLORS.find((c) => c.id === columnColorId(col))?.cls) || 'bg-faint';

export const ManageColumnsModal: React.FC<ManageColumnsModalProps> = (props) =>
  props.isOpen ? <ManageColumnsModalContent {...props} /> : null;

const ManageColumnsModalContent: React.FC<ManageColumnsModalProps> = ({
  isOpen,
  onClose,
  initialColumns,
  onSave,
  listTitle,
}) => {
  const { t } = useTranslation('tasks');
  const [columns, setColumns] = useState<KanbanColumn[]>(() => {
    return initialColumns && initialColumns.length > 0 ? initialColumns : DEFAULT_KANBAN_COLUMNS;
  });
  const [newColName, setNewColName] = useState('');
  const [newColIsDone, setNewColIsDone] = useState(false);
  const [saving, setSaving] = useState(false);
  // Colour menu: opens at the column's dot like a context menu (fixed, so the scrolling list cannot clip it)
  const [colorMenu, setColorMenu] = useState<{ id: string; left: number; top?: number; bottom?: number } | null>(null);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colorMenu) return;
    const close = (e: Event) => {
      const target = e.target as HTMLElement;
      if (colorMenuRef.current?.contains(target) || target.closest?.('[data-color-trigger]')) return;
      setColorMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setColorMenu(null);
    const dismiss = () => setColorMenu(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
    };
  }, [colorMenu]);

  const openColorMenu = (id: string, trigger: HTMLElement) => {
    if (colorMenu?.id === id) {
      setColorMenu(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const menuHeight = COLUMN_COLORS.length * 36 + 12;
    const left = Math.min(rect.left, window.innerWidth - 200);
    // Below the dot if there is room, else above it
    setColorMenu(
      rect.bottom + menuHeight + 8 < window.innerHeight
        ? { id, left, top: rect.bottom + 4 }
        : { id, left, bottom: window.innerHeight - rect.top + 4 }
    );
  };

  useEffect(() => {
    setColumns(initialColumns && initialColumns.length > 0 ? initialColumns : DEFAULT_KANBAN_COLUMNS);
  }, [initialColumns, isOpen]);

  const handleMove = (index: number, direction: 'up' | 'down') => {
    triggerHaptic(10);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= columns.length) return;
    const next = [...columns];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    setColumns(next);
  };

  const handleRename = (id: string, newName: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: newName } : c))
    );
  };

  const handleColor = (id: string, color: string) => {
    triggerHaptic(10);
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, color } : c)));
    setColorMenu(null);
  };

  const handleToggleDone = (id: string) => {
    triggerHaptic(10);
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isDone: !c.isDone } : c))
    );
  };

  const handleDelete = (id: string) => {
    if (columns.length <= 1) {
      alert(t('columnsModal.minOne'));
      return;
    }
    triggerHaptic(10);
    setColumns((prev) => prev.filter((c) => c.id !== id));
  };

  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newColName.trim();
    if (!name) return;
    triggerHaptic(10);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20) || 'col';
    const id = `${slug}_${Date.now().toString(36).slice(-4)}`;
    setColumns((prev) => [
      ...prev,
      {
        id,
        name,
        isDone: newColIsDone,
      },
    ]);
    setNewColName('');
    setNewColIsDone(false);
  };

  const handleResetToDefault = () => {
    if (window.confirm(t('columnsModal.confirmReset'))) {
      triggerHaptic(15);
      setColumns(DEFAULT_KANBAN_COLUMNS);
    }
  };

  const handleSave = async () => {
    if (columns.length === 0) {
      alert(t('columnsModal.mustHaveOne'));
      return;
    }
    setSaving(true);
    triggerHaptic(15);
    try {
      await onSave(columns);
      onClose();
    } catch (err: any) {
      alert(err.message || t('columnsModal.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 !m-0 modal-overlay z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        className="w-full max-w-md panel-surface shadow-panel border border-border my-auto flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-panel">
          <div className="flex items-center gap-2">
            <Columns className="w-4 h-4 text-accent" />
            <div>
              <h3 className="text-sm font-semibold text-main">{t('columnsModal.title')}</h3>
              {listTitle && (
                <p className="text-[10px] text-muted truncate">Liste: {listTitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-main p-1.5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <p className="text-xs text-muted">
            {t('columnsModal.intro')}
          </p>

          {/* Columns List */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-main">Aktive Spalten ({columns.length}):</label>
            <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1" onScroll={() => setColorMenu(null)}>
              {columns.map((col, idx) => (
                <div key={col.id} className="p-2 bg-canvas border border-border rounded-card space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMove(idx, 'up')}
                        className="text-muted hover:text-main disabled:opacity-20 p-0.5"
                        title={t('columnsModal.up')}
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === columns.length - 1}
                        onClick={() => handleMove(idx, 'down')}
                        className="text-muted hover:text-main disabled:opacity-20 p-0.5"
                        title={t('columnsModal.down')}
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>

                    <button
                      type="button"
                      data-color-trigger
                      onClick={(e) => openColorMenu(col.id, e.currentTarget)}
                      className="w-7 h-7 flex items-center justify-center rounded-btn border border-border bg-panel hover:border-strong flex-shrink-0"
                      title={t('columnsModal.color')}
                      aria-label={t('columnsModal.colorOf', { name: col.name })}
                      aria-haspopup="menu"
                      aria-expanded={colorMenu?.id === col.id}
                    >
                      <span className={`w-3 h-3 rounded-full ${columnDotClass(col)}`} />
                    </button>

                    <input
                      type="text"
                      value={col.name}
                      onChange={(e) => handleRename(col.id, e.target.value)}
                      className="flex-1 min-w-0 h-7 px-2 text-xs input-field"
                      placeholder={t('columnsModal.namePlaceholder')}
                    />

                    {/* IsDone Toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggleDone(col.id)}
                      className={`h-7 px-2 text-[10px] rounded-btn border transition-colors flex items-center gap-1 flex-shrink-0 ${
                        col.isDone
                          ? 'bg-status-ok/15 border-status-ok text-status-ok font-semibold'
                          : 'bg-panel border-border text-faint hover:text-muted'
                      }`}
                      title={col.isDone ? t('columnsModal.countsDone') : t('columnsModal.countsOpen')}
                      aria-label={col.isDone ? t('columnsModal.countsDone') : t('columnsModal.countsOpen')}
                      aria-pressed={!!col.isDone}
                    >
                      <Check className={`w-2.5 h-2.5 ${col.isDone ? 'stroke-[3]' : 'opacity-40'}`} />
                      {/* Phones: only the tick, so the row keeps room for the bin */}
                      <span className="hidden sm:inline">{t('columnsModal.done')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(col.id)}
                      disabled={columns.length <= 1}
                      className="text-muted hover:text-status-err disabled:opacity-20 p-1 transition-colors"
                      title={t('columnsModal.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add New Column Form */}
          <form onSubmit={handleAddColumn} className="space-y-2 pt-2 border-t border-border">
            <label className="block text-xs font-semibold text-main">{t('columnsModal.add')}</label>
            {/* Phones: the buttons go below the field, so nothing is cut off */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
              <input
                type="text"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder={t('columnsModal.addPlaceholder')}
                className="w-full sm:w-auto sm:flex-1 min-w-0 h-11 sm:h-8 px-2.5 text-base sm:text-xs input-field"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setNewColIsDone((prev) => !prev)}
                  className={`flex-1 sm:flex-none justify-center h-11 sm:h-8 px-2.5 text-xs rounded-btn border transition-colors flex items-center gap-1 ${
                    newColIsDone
                      ? 'bg-status-ok/15 border-status-ok text-status-ok font-semibold'
                      : 'bg-panel border-border text-muted hover:text-main'
                  }`}
                  title={t('columnsModal.doneQuestion')}
                >
                  <Check className="w-3 h-3" />
                  <span>{t('columnsModal.done')}</span>
                </button>
                <button
                  type="submit"
                  disabled={!newColName.trim()}
                  className="flex-1 sm:flex-none justify-center btn-primary h-11 sm:h-8 px-3 text-xs flex items-center gap-1 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('common:add')}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Reset button */}
          <div className="pt-2 flex justify-start">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="text-xs text-muted hover:text-main flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3 text-accent" />
              <span>{t('columnsModal.reset')}</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border bg-panel">
          <button
            type="button"
            onClick={onClose}
            className="btn-action h-7 px-3 text-xs"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary h-7 px-3 text-xs disabled:opacity-50"
          >
            {t('columnsModal.save')}
          </button>
        </div>
      </div>

      {colorMenu &&
        (() => {
          const col = columns.find((c) => c.id === colorMenu.id);
          if (!col) return null;
          return (
            <div
              ref={colorMenuRef}
              role="menu"
              aria-label={t('columnsModal.colorOf', { name: col.name })}
              style={{ left: colorMenu.left, top: colorMenu.top, bottom: colorMenu.bottom }}
              className="fixed z-[60] w-44 p-1 bg-panel border border-border rounded-card shadow-panel"
              onClick={(e) => e.stopPropagation()}
            >
              {COLUMN_COLORS.map((c) => {
                const active = columnColorId(col) === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => handleColor(col.id, c.id)}
                    className={`w-full h-11 sm:h-8 px-2 rounded-btn text-xs flex items-center gap-2 text-left transition-colors ${
                      active ? 'bg-accent/10 text-main' : 'text-muted hover:text-main hover:bg-panel-hover'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${c.cls}`} />
                    <span className="flex-1">{c.label}</span>
                    {active && <Check className="w-3 h-3 text-accent stroke-[3]" />}
                  </button>
                );
              })}
            </div>
          );
        })()}
    </div>
  );
};
