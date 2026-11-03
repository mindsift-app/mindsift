import { Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { SharedList } from '../../lib/types';
import { MobileMenuGroup } from '../../context/MobileActionContext';
import { deduplicateItems } from './listItems';

interface ListsMenuInput {
  lists: SharedList[];
  activeList: SharedList | null;
  completedCount: number;
  focusNewItemInput: () => void;
  setShowNewListModal: (show: boolean) => void;
  openShareModal: () => void;
  handleClearCompleted: () => void;
  handleDeleteList: (listId: string) => void;
  setActiveListId: (id: string) => void;
}

// The phone menu of SharedListsView (behind the MindSift logo): new entry, new list, share, clear done
// entries, delete the list, and switching between lists
export function buildListsMenu({
  lists,
  activeList,
  completedCount,
  focusNewItemInput,
  setShowNewListModal,
  openShareModal,
  handleClearCompleted,
  handleDeleteList,
  setActiveListId,
}: ListsMenuInput): MobileMenuGroup[] {
  return [
        {
          id: 'lists-actions',
          title: 'Aktionen',
          items: [
            {
              id: 'list-new-item',
              label: 'Neuen Eintrag hinzufügen',
              icon: <Plus className="w-4 h-4 text-accent" />,
              variant: 'accent',
              onClick: () => {
                focusNewItemInput();
              },
            },
            {
              id: 'list-new-list',
              label: 'Neue Einkaufsliste erstellen',
              icon: <Plus className="w-4 h-4" />,
              onClick: () => setShowNewListModal(true),
            },
            ...(activeList
              ? [
                  {
                    id: 'list-share',
                    label: `Liste "${activeList.title}" teilen`,
                    icon: <Users className="w-4 h-4" />,
                    onClick: () => openShareModal(),
                  },
                ]
              : []),
            ...(completedCount > 0
              ? [
                  {
                    id: 'list-clear-completed',
                    label: `Erledigte aufräumen (${completedCount})`,
                    icon: <Sparkles className="w-4 h-4" />,
                    onClick: () => handleClearCompleted(),
                  },
                ]
              : []),
            ...(activeList && lists.length > 1
              ? [
                  {
                    id: 'list-delete',
                    label: `Liste "${activeList.title}" löschen`,
                    icon: <Trash2 className="w-4 h-4" />,
                    variant: 'danger' as const,
                    onClick: () => handleDeleteList(activeList.id),
                  },
                ]
              : []),
          ],
        },
        {
          id: 'lists-switcher',
          title: 'Einkaufslisten wechseln',
          items: lists.map((lst) => {
            const openCount = deduplicateItems(lst.items || []).filter((i) => !i.isCompleted).length;
            return {
              id: `select-list-${lst.id}`,
              label: lst.title,
              icon: <span className="text-base">{lst.icon}</span>,
              badge: openCount > 0 ? openCount : undefined,
              active: activeList?.id === lst.id,
              onClick: () => setActiveListId(lst.id),
            };
          }),
        },
      ];
}
