import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePhoneWidth } from '../../lib/breakpoints';
import type { Thought } from '../../lib/types';

interface PriorityChipProps {
  task: Thought;
  onCycle: (task: Thought) => void;
  readOnly?: boolean;
  /** xs: Kanban card, sm: task row */
  size: 'xs' | 'sm';
}

/** Priority chip under a task title (urgent / high). Desktop: click cycles the priority. Phone: display only, the
 *  chip is too small to hit reliably; the priority is changed in the task detail there. */
export const PriorityChip: React.FC<PriorityChipProps> = ({ task, onCycle, readOnly, size }) => {
  const { t } = useTranslation('tasks');
  const phone = usePhoneWidth();
  if (task.priority !== 'urgent' && task.priority !== 'high') return null;
  const urgent = task.priority === 'urgent';
  const text = size === 'xs' ? 'text-[9px]' : 'text-[10px]';
  const look = urgent
    ? `badge-accent ${text}`
    : `${size === 'xs' ? 'px-1.5 py-0.2' : 'px-1.5 py-0.5'} border border-status-warn text-status-warn rounded-btn ${text} font-medium`;
  const label = urgent ? t('tasks:listing.urgent') : t('tasks:listing.high');
  if (phone) return <span className={look}>{label}</span>;
  return (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => onCycle(task)}
      className={`${look} cursor-pointer hover:opacity-85 disabled:cursor-default`}
      title={urgent ? t('row.urgentToNormal') : t('row.highToUrgent')}
    >
      {label}
    </button>
  );
};
