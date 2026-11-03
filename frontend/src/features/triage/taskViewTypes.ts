// Types of the task view shared by TasksView and its parts
export type GroupBy = 'none' | 'list' | 'tag' | 'status' | 'priority' | 'due';
export type ViewMode = 'list' | 'kanban';
export type TaskFilter = 'open' | 'done' | 'discarded';
export type TaskSort = 'custom' | 'created' | 'due' | 'priority' | 'alpha';

// Labels of the groupings (list view, phone filter banner)
export const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'Keine',
  list: 'Nach Liste',
  tag: 'Nach Hashtag',
  status: 'Nach Status',
  priority: 'Nach Priorität',
  due: 'Nach Fälligkeit',
};
