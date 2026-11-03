// Types of the task view shared by TasksView and its parts
import i18n from '../../i18n';
export type GroupBy = 'none' | 'list' | 'tag' | 'status' | 'priority' | 'due';
export type ViewMode = 'list' | 'kanban';
export type TaskFilter = 'open' | 'done' | 'discarded';
export type TaskSort = 'custom' | 'created' | 'due' | 'priority' | 'alpha';

// Labels of the groupings (list view, phone filter banner)
const groupLabel = (id: GroupBy) => i18n.t(`tasks:group.${id}`);
export const GROUP_LABELS: Record<GroupBy, string> = {
  get none() {
    return groupLabel('none');
  },
  get list() {
    return groupLabel('list');
  },
  get tag() {
    return groupLabel('tag');
  },
  get status() {
    return groupLabel('status');
  },
  get priority() {
    return groupLabel('priority');
  },
  get due() {
    return groupLabel('due');
  },
};
