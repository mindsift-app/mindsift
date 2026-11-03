import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { api, triggerHaptic } from '../../lib/api';
import { TaskList, Thought } from '../../lib/types';
import { VoiceInputButton } from '../../components/VoiceInputButton';

interface QuickAddTaskBarProps {
  // Read-only list: no input (the draft stays for when an editable list is open again)
  hidden: boolean;
  currentSelectedList: TaskList | undefined;
  selectedListId: string;
  setTasks: React.Dispatch<React.SetStateAction<Thought[]>>;
  onRefreshStats: () => void;
  loadData: () => Promise<void>;
}

// Desktop: input for a new task in the open list, with voice input and due date (phones use the + button)
export function QuickAddTaskBar({ hidden, currentSelectedList, selectedListId, setTasks, onRefreshStats, loadData }: QuickAddTaskBarProps) {
  const { t } = useTranslation('tasks');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickVoiceError, setQuickVoiceError] = useState<string | null>(null);
  const [quickDueDate, setQuickDueDate] = useState('');
  const quickInputRef = useRef<HTMLInputElement | null>(null);

  const handleQuickAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    triggerHaptic(10);
    setQuickTitle('');

    try {
      const created = await api.captureThought(title, 'normal', 'manual', quickDueDate, {
        target: 'task',
        taskListId: selectedListId === 'all' ? '' : selectedListId,
      });
      setTasks((prev) => {
        if (prev.some((t) => t.id === created.id)) return prev;
        return [created, ...prev];
      });
      onRefreshStats();
    } catch {
      loadData();
    }
  };

  if (hidden) return null;
  return (
    <form
      onSubmit={handleQuickAddTask}
      className="hidden sm:flex items-center gap-1.5 panel-surface p-2 sm:p-1.5"
    >
      <Plus className="w-4 h-4 text-accent ml-1 flex-shrink-0" />
      <input
        ref={quickInputRef}
        type="text"
        value={quickTitle}
        onChange={(e) => setQuickTitle(e.target.value)}
        placeholder={
          quickVoiceError ||
          (currentSelectedList ? t('quickAdd.toList', { title: currentSelectedList.title }) : t('quickAdd.placeholder'))
        }
        className="flex-1 bg-transparent px-2 py-1.5 sm:py-1 text-sm text-main placeholder-faint focus:outline-none min-w-0"
      />
      <div className="flex items-center gap-1 flex-shrink-0">
        <VoiceInputButton
          value={quickTitle}
          onChange={setQuickTitle}
          focusRef={quickInputRef}
          onError={(message) => {
            setQuickVoiceError(message);
            window.setTimeout(() => setQuickVoiceError(null), 4000);
          }}
        />
        <input
          type="date"
          value={quickDueDate}
          onChange={(e) => setQuickDueDate(e.target.value)}
          className="hidden sm:block h-7 px-2 input-field text-xs"
          title={t('detail.dueDate')}
        />
        <button
          type="submit"
          disabled={!quickTitle.trim()}
          className="btn-primary h-9 sm:h-7 px-3.5 sm:px-3 text-xs disabled:opacity-40"
        >
          {t('common:add')}
        </button>
      </div>
    </form>
  );
}
