import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert, Calendar, SquareCheckBig, Flame } from 'lucide-react';
import { PriorityLevel, TaskList } from '../../lib/types';
import { triggerHaptic } from '../../lib/api';
import { useHoldReload } from '../../lib/reloadHold';
import { BottomSheet } from '../../components/BottomSheet';
import { VoiceInputButton } from '../../components/VoiceInputButton';
import { DateField } from '../../components/DateField';
import { SelectMenu } from '../../components/SelectMenu';
import { NaturalDateChip, PhraseHighlight, applyNaturalDate, useNaturalDate } from '../../components/NaturalDateHint';

export interface MobileTaskDraft {
  title: string;
  priority: PriorityLevel;
  dueDate: string;
  listId: string;
}

interface MobileTaskCreateSheetProps {
  open: boolean;
  onClose: () => void;
  lists: TaskList[];
  // Preselected by the view when it opens the sheet
  listId: string;
  onListIdChange: (id: string) => void;
  // true when the task was created: the draft is cleared
  onCreate: (draft: MobileTaskDraft) => Promise<boolean>;
}

// Phone: bottom sheet for a new task (text with voice input, list, priority, due date). Stays mounted while
// closed, so a draft survives closing and reopening like before.
export function MobileTaskCreateSheet({ open, onClose, lists, listId, onListIdChange, onCreate }: MobileTaskCreateSheetProps) {
  const { t } = useTranslation('tasks');
  const [title, setTitle] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dueDate, setDueDate] = useState('');
  // The draft (kept while the sheet is closed too): no reload for a new version meanwhile
  useHoldReload(title.trim() !== '');
  const [priority, setPriority] = useState<PriorityLevel>('normal');
  // A date in the text ("Zahnarzt morgen 14 Uhr"), unless one was picked in the date field
  const natural = useNaturalDate(title, open && !dueDate);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const applied = applyNaturalDate(title, natural.parsed, dueDate);
    if (await onCreate({ title: applied.title.trim(), priority, dueDate: applied.due, listId })) {
      setTitle('');
      setDueDate('');
      setPriority('normal');
      natural.reset();
    }
  };

  // The backdrop, the X and "Abbrechen": a dictation still running in the field asks first (lib/leaveGuard.ts)
  return (
    <BottomSheet phoneOnly guard onClose={onClose} title={t('create.title')} icon={<SquareCheckBig className="w-4 h-4" />}>
      {(close) => (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-muted block mb-1">{t('create.text')}</label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={voiceError || t('create.placeholder')}
                className="w-full input-field pl-3 pr-11 py-2 text-sm"
              />
              <VoiceInputButton
                value={title}
                onChange={setTitle}
                focusRef={inputRef}
                onError={(message) => {
                  setVoiceError(message);
                  window.setTimeout(() => setVoiceError(null), 4000);
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2"
              />
              {natural.parsed && <PhraseHighlight inputRef={inputRef} text={title} spans={natural.parsed.spans} />}
            </div>
            {natural.parsed && <NaturalDateChip due={natural.parsed.due} onDismiss={natural.dismiss} className="mt-1.5" />}
          </div>

          {/* List Selector (if lists exist) */}
          {lists.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-muted block mb-1">{t('create.taskList')}</label>
              <SelectMenu
                ariaLabel={t('create.taskList')}
                value={listId}
                onChange={onListIdChange}
                options={[
                  { value: '', label: t('create.defaultList') },
                  ...lists.map((tl) => ({ value: tl.id, label: tl.title, lead: tl.icon ? <span>{tl.icon}</span> : undefined })),
                ]}
              />
            </div>
          )}

          {/* Priority - 4 Buttons */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-semibold text-muted block">{t('common:priority.label')}</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['low', 'normal', 'high', 'urgent'] as PriorityLevel[]).map((p) => {
                const config: Record<PriorityLevel, { label: string; icon?: React.ReactNode; activeClass: string }> = {
                  low: { label: t('common:priority.low'), activeClass: 'bg-canvas border-strong text-main font-semibold' },
                  normal: { label: t('common:priority.normal'), activeClass: 'bg-accent/15 border-accent text-accent font-semibold' },
                  high: { label: t('common:priority.high'), icon: <TriangleAlert className="w-3 h-3 text-status-warn" />, activeClass: 'bg-status-warn/15 border-status-warn text-status-warn font-semibold' },
                  urgent: { label: t('common:priority.urgent'), icon: <Flame className="w-3 h-3 text-status-err" />, activeClass: 'bg-status-err/15 border-status-err text-status-err font-semibold' },
                };
                const active = priority === p;
                const item = config[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setPriority(p);
                    }}
                    className={`h-9 px-1 text-xs rounded-btn font-medium transition-colors border flex items-center justify-center gap-1 cursor-pointer ${
                      active
                        ? item.activeClass
                        : 'bg-canvas border-border text-muted hover:text-main'
                    }`}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Due Date */}
          <div className="space-y-1 pt-1">
            <label className="text-[11px] font-semibold text-muted flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-accent" />
              <span>{t('create.due')}</span>
            </label>
            <DateField
              ariaLabel={t('create.due')}
              value={dueDate}
              onChange={setDueDate}
              className="w-full"
              inputClassName="h-11 input-field px-3 text-base sm:text-xs"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="btn-ghost h-10 px-4 text-xs cursor-pointer"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="btn-primary h-10 px-5 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              {t('create.submit')}
            </button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}
