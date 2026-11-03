import React, { useState } from 'react';
import { Layers } from 'lucide-react';
import { api } from '../../lib/api';
import { TaskList } from '../../lib/types';
import { FormSheet } from '../../components/FormSheet';
import { EmojiIconButton } from '../../components/EmojiIconButton';

interface NewTaskListSheetProps {
  showNewListModal: boolean;
  setShowNewListModal: (show: boolean) => void;
  setTaskLists: React.Dispatch<React.SetStateAction<TaskList[]>>;
  setSelectedListId: (id: string) => void;
}

// Dialog for a new task list (icon and title); the new list opens right away. Stays mounted while closed,
// so a started title survives closing like before.
export function NewTaskListSheet({ showNewListModal, setShowNewListModal, setTaskLists, setSelectedListId }: NewTaskListSheetProps) {
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
      alert(err.message || 'Fehler beim Erstellen der Aufgabenliste');
    }
  };

  if (!showNewListModal) return null;
  return (
    <FormSheet
      title="Neue Aufgabenliste erstellen"
      icon={<Layers className="w-4 h-4 text-accent" />}
      onClose={() => setShowNewListModal(false)}
      onSubmit={handleCreateTaskList}
    >
        <div>
          <label className="block text-xs text-muted mb-1">Titel der Liste</label>
          <div className="flex items-center gap-1.5">
            <EmojiIconButton value={newListIcon} onChange={setNewListIcon} />
            <input
              type="text"
              value={newListTitle}
              onChange={(e) => setNewListTitle(e.target.value)}
              placeholder="z.B. Homelab, Einkäufe, Steuern"
              autoFocus
              required
              className="flex-1 min-w-0 h-11 sm:h-8 input-field px-2.5 text-base sm:text-xs"
            />
          </div>
        </div>
    </FormSheet>
  );
}
