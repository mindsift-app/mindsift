import { useTranslation } from 'react-i18next';
import { CalendarDays, Columns2, LayoutList } from 'lucide-react';
import { ViewMode } from './taskViewTypes';

// Order of a tap on the phone's view pill: Kanban → calendar → list → Kanban
const CYCLE: ViewMode[] = ['kanban', 'calendar', 'list'];

export function nextViewMode(mode: ViewMode): ViewMode {
  return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
}

const ICONS: Record<ViewMode, typeof LayoutList> = { list: LayoutList, kanban: Columns2, calendar: CalendarDays };

// Phone: the pill beside the task-list picker names the view; a tap switches to the next one (the desktop
// has the segmented switch in the tab row instead). The button is 44 px tall (reaching into the bar's padding,
// so the bar keeps its height), the pill keeps its look.
export function ViewCyclePill({ viewMode, setViewMode }: { viewMode: ViewMode; setViewMode: (mode: ViewMode) => void }) {
  const { t } = useTranslation('tasks');
  const next = nextViewMode(viewMode);
  const Icon = ICONS[viewMode];
  return (
    <button
      type="button"
      onClick={() => setViewMode(next)}
      aria-label={t('view.cycle', { current: t(`tabs.${viewMode}`), next: t(`tabs.${next}`) })}
      className="h-11 -my-2 flex items-center shrink-0"
    >
      <span className="badge-neutral text-[11px]">
        <Icon className="w-3 h-3" aria-hidden />
        {t(`tabs.${viewMode}`)}
      </span>
    </button>
  );
}
