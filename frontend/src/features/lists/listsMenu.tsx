import { Pencil, Plus, Sparkles, Trash, Users } from 'lucide-react';
import i18n from '../../i18n';
import { SharedList } from '../../lib/types';
import { MobileMenuGroup } from '../../context/MobileActionContext';
import { canWriteList, deduplicateItems } from './listItems';

interface ListsMenuInput {
  lists: SharedList[];
  activeList: SharedList | null;
  completedCount: number;
  focusNewItemInput: () => void;
  setShowNewListModal: (show: boolean) => void;
  openShareModal: () => void;
  handleClearCompleted: () => void;
  handleDeleteList: (listId: string) => void;
  handleRenameList: (lst: SharedList) => void;
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
  handleRenameList,
  setActiveListId,
}: ListsMenuInput): MobileMenuGroup[] {
  return [
        {
          id: 'lists-actions',
          title: i18n.t('lists:menu.actions'),
          items: [
            {
              id: 'list-new-item',
              label: i18n.t('lists:menu.addItem'),
              icon: <Plus className="w-4 h-4" />,
              variant: 'accent',
              onClick: () => {
                focusNewItemInput();
              },
            },
            {
              id: 'list-new-list',
              label: i18n.t('lists:menu.newList'),
              icon: <Plus className="w-4 h-4" />,
              onClick: () => setShowNewListModal(true),
            },
            ...(activeList
              ? [
                  {
                    id: 'list-share',
                    label: i18n.t('lists:shareMenuLabel', { title: activeList.title }),
                    icon: <Users className="w-4 h-4" />,
                    onClick: () => openShareModal(),
                  },
                  ...(canWriteList(activeList)
                    ? [
                        {
                          id: 'list-rename',
                          label: i18n.t('common:listMenu.rename'),
                          icon: <Pencil className="w-4 h-4" />,
                          onClick: () => handleRenameList(activeList),
                        },
                      ]
                    : []),
                ]
              : []),
            ...(completedCount > 0
              ? [
                  {
                    id: 'list-clear-completed',
                    label: i18n.t('lists:menu.clearDone', { count: completedCount }),
                    icon: <Sparkles className="w-4 h-4" />,
                    onClick: () => handleClearCompleted(),
                  },
                ]
              : []),
            ...(activeList && lists.length > 1
              ? [
                  {
                    id: 'list-delete',
                    label: i18n.t('lists:menu.deleteList', { title: activeList.title }),
                    icon: <Trash className="w-4 h-4" />,
                    variant: 'danger' as const,
                    onClick: () => handleDeleteList(activeList.id),
                  },
                ]
              : []),
          ],
        },
        {
          id: 'lists-switcher',
          title: i18n.t('lists:menu.switch'),
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
