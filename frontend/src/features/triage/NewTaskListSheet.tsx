import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { api } from '../../lib/api';
import { TaskList } from '../../lib/types';
import { FormSheet } from '../../components/FormSheet';
import { EmojiIconButton } from '../../components/EmojiIconButton';
import { showError } from '../../components/ErrorNotice';

interface NewTaskListSheetProps {
  showNewListModal: boolean;
  setShowNewListModal: (show: boolean) => void;
  setTaskLists: React.Dispatch<React.SetStateAction<TaskList[]>>;
  setSelectedListId: (id: string) => void;
}

// Dialog for a new task list (icon and title); the new list opens right away. Stays mounted while closed,
// so a started title survives closing like before.
export function NewTaskListSheet({ showNewListModal, setShowNewListModal, setTaskLists, setSelectedListId }: NewTaskListSheetProps) {
  const { t } = useTranslation('tasks');
  const [newListTitle, setNewListTitle] = useState('');
  const [newListIcon, setNewListIcon] = useState('📋');

  const handleCreateTaskList = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newListTitle.trim();
    if (!title) return;
    try {
      const created = await api.createTaskList({
        title,
        icon: newListIcon,
      });
      const freshLists = await api.getTaskLists();
      setTaskLists(freshLists);
      setSelectedListId(created.id);
      setShowNewListModal(false);
      setNewListTitle('');
      setNewListIcon('📋');
    } catch (err: any) {
      showError(err.message || t('newList.failed'));
    }
  };

  if (!showNewListModal) return null;
  return (
    <FormSheet
      title={t('newList.title')}
      icon={<Layers className="w-4 h-4 text-accent" />}
      onClose={() => setShowNewListModal(false)}
      onSubmit={handleCreateTaskList}
    >
        <div>
          <label className="block text-xs text-muted mb-1">{t('newList.name')}</label>
          <div className="flex items-center gap-1.5">
            <EmojiIconButton value={newListIcon} onChange={setNewListIcon} />
            <input
              type="text"
              value={newListTitle}
              onChange={(e) => setNewListTitle(e.target.value)}
              placeholder={t('newList.placeholder')}
              autoFocus
              required
              className="flex-1 min-w-0 h-11 sm:h-8 input-field px-2.5 text-base sm:text-xs"
            />
          </div>
        </div>
    </FormSheet>
  );
}
