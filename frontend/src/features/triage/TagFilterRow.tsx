import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash } from 'lucide-react';
import { Thought } from '../../lib/types';

interface TagFilterRowProps {
  tags: string[];
  // Tasks of the open list: total and count per hashtag
  tasks: Thought[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
  // Measured again when the layout changes (list or Kanban)
  layoutKey: string;
}

// Desktop hashtag filter of TasksView: chips in one line, cut off with "…" when too many; "…" opens them all
// in lines. Two siblings in the toolbar's flex row (the chips and the "…" button), hence the fragment.
export function TagFilterRow({ tags, tasks, selected, onSelect, layoutKey }: TagFilterRowProps) {
  const { t } = useTranslation('tasks');
  const tagRowRef = useRef<HTMLDivElement>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [tagsOverflow, setTagsOverflow] = useState(false);

  // Cut off? Measured while the row is one line (on resize and when the tags change)
  useEffect(() => {
    const el = tagRowRef.current;
    if (!el || tagsExpanded) return;
    const measure = () => setTagsOverflow(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tags, tagsExpanded, layoutKey]);

  return (
    <>
      {/* Hashtag filter chips: one line, cut off with "…" when too many; "…" opens them all in lines */}
      <div
        ref={tagRowRef}
        className={`flex-1 min-w-0 flex items-center gap-1.5 pb-1 ${tagsExpanded ? 'flex-wrap' : 'overflow-hidden'}`}
      >
        <span className="text-[11px] font-semibold text-muted flex items-center gap-1 flex-shrink-0">
          <Hash className="w-3 h-3 text-accent" />
          <span>{t('detail.hashtags')}</span>
        </span>
        <button
          onClick={() => onSelect(null)}
          className={`h-6 px-2 text-[11px] rounded-pill border transition-colors flex-shrink-0 ${
            selected === null
              ? 'bg-panel border-accent text-accent font-semibold'
              : 'bg-canvas border-border text-muted hover:text-main'
          }`}
        >
          {t('tags.all', { count: tasks.length })}
        </button>
        {tags.map((tag) => {
          const count = tasks.filter((t) => t.tags?.includes(tag)).length;
          const isSelected = selected === tag;
          return (
            <button
              key={tag}
              onClick={() => onSelect(isSelected ? null : tag)}
              className={`h-6 px-2 text-[11px] rounded-pill border transition-colors flex items-center gap-1 flex-shrink-0 ${
                isSelected
                  ? 'bg-accent/15 border-accent text-accent font-semibold'
                  : 'bg-canvas border-border text-muted hover:text-main'
              }`}
            >
              <span>#{tag}</span>
              <span className="text-[9px] opacity-70 font-mono">({count})</span>
            </button>
          );
        })}
        {tagsExpanded && (
          <button
            onClick={() => setTagsExpanded(false)}
            className="h-6 px-2 text-[11px] rounded-pill text-accent hover:underline flex-shrink-0"
          >
            {t('tasks:tags.less')}
          </button>
        )}
      </div>
      {!tagsExpanded && tagsOverflow && (
        <button
          onClick={() => setTagsExpanded(true)}
          className="h-6 px-2 -ml-1 mb-1 text-xs rounded-pill border border-border bg-canvas text-muted hover:text-main flex-shrink-0"
          title={t('tags.showAll')}
          aria-label={t('tags.showAll')}
        >
          …
        </button>
      )}
    </>
  );
}
