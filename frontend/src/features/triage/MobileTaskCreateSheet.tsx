import React, { useRef, useState } from 'react';
import { AlertTriangle, Calendar, CheckSquare, Flame, X } from 'lucide-react';
import { PriorityLevel, TaskList } from '../../lib/types';
import { triggerHaptic } from '../../lib/api';
import { VoiceInputButton } from '../../components/VoiceInputButton';

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
  const [title, setTitle] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<PriorityLevel>('normal');

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    if (await onCreate({ title: text, priority, dueDate, listId })) {
      setTitle('');
      setDueDate('');
      setPriority('normal');
    }
  };

  return (
    <div
      className="sm:hidden fixed inset-0 !m-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => onClose()}
    >
      <div
        className="w-full max-h-[85vh] overflow-y-auto bg-panel border-t border-border rounded-t-2xl shadow-panel p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-btn bg-accent/15 text-accent flex items-center justify-center">
              <CheckSquare className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-main">Neue Aufgabe anlegen</h3>
          </div>
          <button
            type="button"
            onClick={() => onClose()}
            className="p-1.5 text-faint hover:text-main rounded-btn transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-muted block mb-1">Aufgabentext</label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={voiceError || 'Was ist zu tun?…'}
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
            </div>
          </div>

          {/* List Selector (if lists exist) */}
          {lists.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-muted block mb-1">Aufgabenliste</label>
              <select
                value={listId}
                onChange={(e) => onListIdChange(e.target.value)}
                className="w-full input-field px-2.5 py-2 text-xs bg-panel"
              >
                <option value="">Standard (Alle Aufgaben)</option>
                {lists.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.icon ? `${tl.icon} ${tl.title}` : tl.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Priority - 4 Buttons */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-semibold text-muted block">Priorität</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['low', 'normal', 'high', 'urgent'] as PriorityLevel[]).map((p) => {
                const config: Record<PriorityLevel, { label: string; icon?: React.ReactNode; activeClass: string }> = {
                  low: { label: 'Niedrig', activeClass: 'bg-canvas border-strong text-main font-semibold shadow-xs' },
                  normal: { label: 'Normal', activeClass: 'bg-accent/15 border-accent text-accent font-semibold shadow-xs' },
                  high: { label: 'Wichtig', icon: <AlertTriangle className="w-3 h-3 text-status-warn" />, activeClass: 'bg-status-warn/15 border-status-warn text-status-warn font-semibold shadow-xs' },
                  urgent: { label: 'Dringend', icon: <Flame className="w-3 h-3 text-status-err" />, activeClass: 'bg-status-err/15 border-status-err text-status-err font-semibold shadow-xs' },
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
              <span>Fällig am</span>
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full input-field px-3 py-2 text-xs"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose()}
              className="btn-ghost h-10 px-4 text-xs cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="btn-primary h-10 px-5 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              Aufgabe erstellen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
