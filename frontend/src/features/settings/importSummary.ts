import i18n from '../../i18n';
import { ImportSummary } from '../../lib/types';

// What an import creates, as parts of a sentence ("3 Notizen", "1 Aufgabenliste" …); empty parts left out
export const summaryParts = (s: ImportSummary) =>
  [
    s.folders && i18n.t('settings:import.summary.folders', { count: s.folders }),
    s.notes && i18n.t('settings:import.summary.notes', { count: s.notes }),
    s.taskLists && i18n.t('settings:import.summary.taskLists', { count: s.taskLists }),
    s.tasks && i18n.t('settings:import.summary.tasks', { count: s.tasks }),
    s.lists && i18n.t('settings:import.summary.lists', { count: s.lists, items: s.listItems }),
    s.inbox && i18n.t('settings:import.summary.inbox', { count: s.inbox }),
    s.themes && i18n.t('settings:import.summary.themes', { count: s.themes }),
  ].filter(Boolean) as string[];
