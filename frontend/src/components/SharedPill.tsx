import React from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';

interface SharedPillProps {
  // Own item: "Geteilt (3)" in the accent colour; someone else's: "Geteilt von Anna", muted
  isOwner: boolean;
  // People it is shared with (0: just "Geteilt", e.g. only through a shared folder)
  count: number;
  ownerName: string;
  onClick: () => void;
  title?: string;
}

// The "shared" status in the header of a note, a task list or a list (Doku/ui-patterns.md); opens the
// sharing dialog.
export function SharedPill({ isOwner, count, ownerName, onClick, title }: SharedPillProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1 h-7 px-2 rounded-btn text-[11px] bg-panel hover:bg-panel-elevated transition-colors cursor-pointer ${
        isOwner ? 'font-semibold text-accent' : 'font-medium text-muted hover:text-main'
      }`}
    >
      <Users className="w-2.5 h-2.5" />
      <span>
        {isOwner
          ? count > 0
            ? t('tasks:tabs.sharedCount', { count })
            : t('workspace:tabbar.shared')
          : t('tasks:tabs.sharedBy', { name: ownerName })}
      </span>
    </button>
  );
}
