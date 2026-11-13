import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash } from 'lucide-react';
import { Thought } from '../../lib/types';
import { PickerPopover } from '../../components/PickerPopover';
import { OVERFLOW_HIDDEN_TAB, useOverflowTabs } from '../../lib/useOverflowTabs';

interface TagFilterRowProps {
  tags: string[];
  // Tasks of the open list: total and count per hashtag
  tasks: Thought[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

// Desktop hashtag filter of TasksView (Doku/ui-patterns.md "Filter Chips"): frameless chips in one line that
// never wraps; those that do not fit go behind "+ n mehr", a popover with a search over all hashtags. The
// chosen hashtag always keeps its chip (useOverflowTabs).
export function TagFilterRow({ tags, tasks, selected, onSelect }: TagFilterRowProps) {
  const { t } = useTranslation('tasks');
  const { rowRef, moreRef, tabRef, hidden: overflowHidden, isHidden } = useOverflowTabs(tags, selected);
  // In state, not a ref: the popover is anchored to it during render
  const [moreButton, setMoreButton] = useState<HTMLButtonElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const task of tasks) for (const tag of task.tags ?? []) out.set(tag, (out.get(tag) ?? 0) + 1);
    return out;
  }, [tasks]);
  const hiddenCount = overflowHidden.length;

  const closePicker = () => {
    setPickerOpen(false);
    // Keyboard users go on from the button that opened it
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) moreButton?.focus();
    });
  };

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={t('filter.byTag')}
      className="relative flex-1 min-w-0 flex items-center gap-1.5"
    >
      <span data-tab-fixed className="shrink-0 flex items-center text-faint" title={t('filter.byTag')}>
        <Hash className="w-3.5 h-3.5" aria-hidden />
      </span>
      <button
        type="button"
        data-tab-fixed
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={`filter-chip shrink-0 ${selected === null ? 'filter-chip-active' : ''}`}
      >
        <span>{t('tags.allChip')}</span>{' '}
        <span className="filter-chip-count">{tasks.length}</span>
      </button>
      {tags.map((tag) => {
        const isSelected = selected === tag;
        const hidden = isHidden(tag);
        return (
          <button
            key={tag}
            ref={tabRef(tag)}
            type="button"
            onClick={() => onSelect(isSelected ? null : tag)}
            aria-pressed={isSelected}
            tabIndex={hidden ? -1 : undefined}
            aria-hidden={hidden || undefined}
            className={`filter-chip shrink-0 ${isSelected ? 'filter-chip-active' : ''} ${hidden ? OVERFLOW_HIDDEN_TAB : ''}`}
          >
            <span>#{tag}</span>{' '}
            <span className="filter-chip-count">{counts.get(tag) ?? 0}</span>
          </button>
        );
      })}
      {/* Always rendered, so its width is known before anything overflows */}
      <div ref={moreRef} className={`shrink-0 ${hiddenCount === 0 ? OVERFLOW_HIDDEN_TAB : ''}`} aria-hidden={hiddenCount === 0 || undefined}>
        <button
          ref={setMoreButton}
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          tabIndex={hiddenCount === 0 ? -1 : undefined}
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          title={t('tags.showAll')}
          className="tool-btn !h-7 !px-2.5"
        >
          {t('tags.more', { count: Math.max(1, hiddenCount) })}
        </button>
      </div>
      {pickerOpen && moreButton && (
        <PickerPopover
          anchor={moreButton}
          items={tags.map((tag) => ({
            id: tag,
            label: `#${tag}`,
            selected: tag === selected,
            trail: <span className="filter-chip-count shrink-0 pl-1">{counts.get(tag) ?? 0}</span>,
          }))}
          maxResults={Infinity}
          placeholder={t('tags.search')}
          empty={t('tags.noMatch')}
          onPick={(item) => {
            onSelect(item.id === selected ? null : item.id);
            closePicker();
          }}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
