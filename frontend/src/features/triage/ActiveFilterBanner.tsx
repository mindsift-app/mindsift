import { Funnel, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GROUP_LABELS, GroupBy, TaskSort } from './taskViewTypes';


interface ActiveFilterBannerProps {
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  groupBy: GroupBy;
  defaultGroupBy: GroupBy;
  setGroupBy: (g: GroupBy) => void;
  sortBy: TaskSort;
  setSortBy: (sort: TaskSort) => void;
}

// Phone: what filters the task list right now (hashtag, grouping, sorting), each removable, plus "Reset";
// hidden while nothing deviates from the defaults
export function ActiveFilterBanner({ selectedTag, setSelectedTag, groupBy, defaultGroupBy, setGroupBy, sortBy, setSortBy }: ActiveFilterBannerProps) {
  const { t } = useTranslation('tasks');
  if (!(selectedTag || groupBy !== defaultGroupBy || sortBy !== 'custom')) return null;
  return (
    <div className="flex sm:hidden items-center justify-between gap-2 p-2 rounded-btn bg-accent/10 border border-accent/20 text-xs">
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <Funnel className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        {selectedTag && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-on-accent text-[11px] font-semibold">
            #{selectedTag}
            <button
              type="button"
              onClick={() => setSelectedTag(null)}
              className="hover:opacity-75 cursor-pointer ml-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
        {groupBy !== defaultGroupBy && (
          <span className="text-muted text-[11px]">
            {t('banner.group')} <strong className="text-main">{GROUP_LABELS[groupBy]}</strong>
          </span>
        )}
        {sortBy !== 'custom' && (
          <span className="text-muted text-[11px]">
            {t('banner.sorted')} <strong className="text-main">{t(`sortShort.${sortBy}`)}</strong>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setSelectedTag(null);
          setGroupBy(defaultGroupBy);
          setSortBy('custom');
        }}
        className="text-accent text-[11px] font-semibold flex-shrink-0 hover:underline cursor-pointer"
      >
        {t('banner.reset')}
      </button>
    </div>
  );
}
