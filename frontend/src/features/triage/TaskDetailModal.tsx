import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X,
  Check,
  Calendar,
  Trash,
  FileText,
  Plus,
  SquareCheckBig,
  Hash,
  TriangleAlert,
  Flame,
  Folder,
  Lock,
  UserPlus,
  Repeat,
  Bell,
  Eye,
  EyeOff,
  GripVertical,
} from 'lucide-react';
import { Thought, TaskList, TaskListMember, KanbanColumn, User, Recurrence } from '../../lib/types';
import { UserAvatar } from '../../components/UserAvatar';
import { OriginBadge, originDetails } from '../../components/OriginBadge';
import { columnDotClass } from './ManageColumnsModal';
import { UserAutocomplete } from '../UserAutocomplete';
import { api, triggerHaptic } from '../../lib/api';
import { MarkdownViewer, renderMentions } from '../../lib/markdown';
import { useMentionInput } from '../../lib/useMentionInput';
import { MentionMenu } from '../../components/MentionMenu';
import { MultiSelectMenu, SelectMenu } from '../../components/SelectMenu';
import { REMINDER_CHOICES, isDayReminder, reminderLabel, remindersText } from '../../lib/reminders';
import { DateField } from '../../components/DateField';
import { TimeField } from '../../components/TimeField';
import { VoiceInputButton } from '../../components/VoiceInputButton';
import { addDays, joinDue, splitDue } from '../../lib/due';
import { usePointerSort } from './usePointerSort';
import { formatDate } from '../../lib/format';
import { pushModal } from '../../lib/navHistory';
import { useScrollLock } from '../../lib/useScrollLock';

interface TaskDetailModalProps {
  task: Thought | null;
  isOpen: boolean;
  onClose: () => void;
  activeColumns: KanbanColumn[];
  taskLists: TaskList[];
  onUpdateTitle: (task: Thought, newTitle: string) => Promise<void>;
  onUpdateStatus: (task: Thought, newStatus: string) => Promise<void>;
  onUpdatePriority: (task: Thought, newPriority: string) => Promise<void>;
  onUpdateDueDate: (task: Thought, newDueDate: string) => Promise<void>;
  onUpdateRecurrence?: (task: Thought, recurrence: Recurrence) => Promise<void>;
  // Own reminders in minutes before the due date ([] = the lead time from the settings, leadMinutes)
  onUpdateReminders?: (task: Thought, reminders: number[]) => Promise<void>;
  leadMinutes?: number;
  onUpdateTaskList: (task: Thought, newListId: string) => Promise<void>;
  onUpdateNotes: (task: Thought, newNotes: string) => Promise<void>;
  onUpdateTags?: (task: Thought, newTags: string[]) => Promise<void>;
  assignableMembers?: TaskListMember[]; // empty unless the task's list is shared
  onUpdateAssignees?: (task: Thought, assignees: string[]) => Promise<void>;
  onToggleSubtask: (task: Thought, subtaskId: string) => Promise<void>;
  onAddSubtask: (task: Thought, title: string) => Promise<void>;
  onDeleteSubtask: (task: Thought, subtaskId: string) => Promise<void>;
  onRenameSubtask?: (task: Thought, subtaskId: string, title: string) => Promise<void>;
  // Subtasks dragged by their handle (or moved with the arrow keys) into a new order
  onReorderSubtasks?: (task: Thought, orderedIds: string[]) => Promise<void>;
  onConvertToDoc: (task: Thought) => void;
  onOpenDocument?: (docId: string, blockId?: string) => void;
  onDeleteTask: (taskId: string) => void;
  readOnly?: boolean; // Task belongs to a list shared with "viewer" permission
  // A new task (draft from a Kanban column): the title opens for editing, its placeholder selected
  editTitleOnOpen?: boolean;
}

// The wrapper decides whether the dialog is shown; the content holds all hooks, so their number never
// changes between renders (hooks after an early return break React when isOpen flips)
export const TaskDetailModal: React.FC<TaskDetailModalProps> = (props) =>
  props.isOpen && props.task ? <TaskDetailModalContent {...props} task={props.task} /> : null;

const TaskDetailModalContent: React.FC<TaskDetailModalProps & { task: Thought }> = ({
  task,
  onClose,
  activeColumns,
  taskLists,
  onUpdateTitle,
  onUpdateStatus,
  onUpdatePriority,
  onUpdateDueDate,
  onUpdateRecurrence,
  onUpdateReminders,
  leadMinutes = 30,
  onUpdateTaskList,
  onUpdateNotes,
  onUpdateTags,
  assignableMembers = [],
  onUpdateAssignees,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onRenameSubtask,
  onReorderSubtasks,
  onConvertToDoc,
  onOpenDocument,
  onDeleteTask,
  readOnly = false,
  editTitleOnOpen = false,
}) => {
  const { t } = useTranslation('tasks');
  const [titleDraft, setTitleDraft] = useState(task.content);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(task.notes || '');
  // Closing with an unsaved title or notes asks first (in the footer) instead of dropping them
  const [confirmUnsaved, setConfirmUnsaved] = useState(false);
  // The notes field grows with its text, so long notes scroll with the dialog instead of inside a small box
  const growNotes = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, []);
  // Dictated text changes the draft without an input event, so the field grows here as well
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (isEditingNotes) growNotes(notesRef.current);
  }, [notesDraft, isEditingNotes, growNotes]);

  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  // "@" in the description or a new subtask: the people who can see this task
  const notesMention = useMentionInput(readOnly ? null : { taskId: task.id });
  const subtaskMention = useMentionInput(readOnly ? null : { taskId: task.id });
  const subtaskInputRef = useRef<HTMLInputElement | null>(null);
  // A subtask's title, edited in place after a click on it
  const [editingSubtask, setEditingSubtask] = useState<{ id: string; title: string } | null>(null);
  const editSubtaskRef = useRef<HTMLInputElement | null>(null);
  const editSubtaskMention = useMentionInput(readOnly ? null : { taskId: task.id });
  const saveSubtaskTitle = () => {
    const edit = editingSubtask;
    setEditingSubtask(null);
    if (!edit || !onRenameSubtask) return;
    const title = edit.title.trim();
    const current = (task.subtasks || []).find((s) => s.id === edit.id);
    if (title && current && title !== current.title) void onRenameSubtask(task, edit.id, title);
  };
  const caretTo = (el: HTMLTextAreaElement | HTMLInputElement | null, caret: number) =>
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  const applyNotesMention = (next: string, caret: number) => {
    setNotesDraft(next);
    caretTo(notesRef.current, caret);
  };
  const applyEditSubtaskMention = (next: string, caret: number) => {
    setEditingSubtask((prev) => (prev ? { ...prev, title: next } : prev));
    caretTo(editSubtaskRef.current, caret);
  };
  const applySubtaskMention = (next: string, caret: number) => {
    setNewSubtaskTitle(next);
    caretTo(subtaskInputRef.current, caret);
  };
  const [newTagDraft, setNewTagDraft] = useState('');
  const [isWatching, setIsWatching] = useState<boolean>(Boolean(task.isWatching));
  const [watchBusy, setWatchBusy] = useState(false);

  // Another task in the dialog: its texts, editors closed. Changes of the same task leave an open editor
  // and what was typed in it alone; a draft is taken from the task when editing starts.
  useEffect(() => {
    setTitleDraft(task.content);
    setNotesDraft(task.notes || '');
    setIsEditingTitle(editTitleOnOpen);
    setIsEditingNotes(false);
    // task.content and task.notes are left out on purpose: an edit of the same task keeps the open drafts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, editTitleOnOpen]);
  useEffect(() => {
    setIsWatching(Boolean(task.isWatching));
  }, [task.isWatching]);

  const handleToggleWatch = async () => {
    if (watchBusy) return;
    setWatchBusy(true);
    try {
      const res = isWatching ? await api.unwatchTask(task.id) : await api.watchTask(task.id);
      const next = Boolean(res.watching);
      setIsWatching(next);
      task.isWatching = next;
      triggerHaptic(10);
    } catch {
      // ignore
    } finally {
      setWatchBusy(false);
    }
  };

  const notesDirty = isEditingNotes && notesDraft !== (task.notes || '');
  const titleDirty = isEditingTitle && titleDraft.trim() !== '' && titleDraft.trim() !== task.content;
  // "Fertig", the X, Escape and a click beside the dialog: with unsaved changes it shakes and asks first
  const [shaking, setShaking] = useState(false);
  const requestClose = useCallback(() => {
    if (notesDirty || titleDirty) {
      setConfirmUnsaved(true);
      setShaking(true);
    } else onClose();
  }, [notesDirty, titleDirty, onClose]);
  // Only a click that also started beside the dialog closes it (not a text selection dragged out of it)
  const pressedOutsideRef = useRef(false);

  // The page behind the dialog stays where it is; wheel and finger scroll the dialog
  useScrollLock();

  // Back (browser, mouse button, Android) closes the dialog first, or asks about unsaved changes
  const backRef = useRef<() => boolean>(() => true);
  backRef.current = () => {
    if (confirmUnsaved) {
      setConfirmUnsaved(false);
      return false;
    }
    if (notesDirty || titleDirty) {
      setConfirmUnsaved(true);
      setShaking(true);
      return false;
    }
    onCloseRef.current();
    return true;
  };
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => pushModal(() => backRef.current()), []);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A field that used Escape itself (a subtask being renamed, the mention list) keeps the dialog open
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (confirmUnsaved) {
          setConfirmUnsaved(false);
        } else if (notesDirty || titleDirty) {
          setConfirmUnsaved(true);
          setShaking(true);
        } else if (isEditingNotes) {
          setIsEditingNotes(false);
        } else if (isEditingTitle) {
          setIsEditingTitle(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isEditingNotes, isEditingTitle, notesDirty, titleDirty, confirmUnsaved]);

  const handleTitleSubmit = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(task.content);
      setIsEditingTitle(false);
      return;
    }
    if (trimmed !== task.content) {
      await onUpdateTitle(task, trimmed);
    }
    setIsEditingTitle(false);
  };

  const handleNotesSubmit = async () => {
    await onUpdateNotes(task, notesDraft);
    setIsEditingNotes(false);
  };

  // From the unsaved-changes question: save what is open, then close
  const saveAndClose = async () => {
    if (titleDirty) await onUpdateTitle(task, titleDraft.trim());
    if (notesDirty) await onUpdateNotes(task, notesDraft);
    setConfirmUnsaved(false);
    onClose();
  };

  const handleAddSubtaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    await onAddSubtask(task, trimmed);
    setNewSubtaskTitle('');
  };

  const handleAddTagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newTagDraft.trim().replace(/^#+/, '').toLowerCase();
    if (!cleaned) return;
    const currentTags = Array.isArray(task.tags) ? [...task.tags] : [];
    if (!currentTags.includes(cleaned)) {
      const updated = [...currentTags, cleaned];
      if (onUpdateTags) {
        await onUpdateTags(task, updated);
      } else {
        await onUpdateTitle(task, `${task.content} #${cleaned}`);
      }
    }
    setNewTagDraft('');
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    const currentTags = Array.isArray(task.tags) ? [...task.tags] : [];
    const updated = currentTags.filter((t) => t !== tagToRemove);
    if (onUpdateTags) {
      await onUpdateTags(task, updated);
    }
  };

  const dueParts = splitDue(task.dueDate);

  const handleQuickDueDate = (daysOffset: number | null) => {
    if (daysOffset === null) {
      onUpdateDueDate(task, '');
      return;
    }
    // Keep a chosen time when only the day changes
    onUpdateDueDate(task, joinDue(addDays(daysOffset), splitDue(task.dueDate).time));
  };

  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const canSortSubtasks = !readOnly && !!onReorderSubtasks && subtasks.length > 1;
  const subtaskSort = usePointerSort(
    subtasks.map((st) => st.id),
    (ids) => void onReorderSubtasks?.(task, ids)
  );
  const subtaskById = new Map(subtasks.map((st) => [st.id, st]));
  const sortedSubtasks = subtaskSort.order.map((id) => subtaskById.get(id)).filter((st): st is NonNullable<typeof st> => !!st);
  const completedSubtasks = subtasks.filter((s) => s.isCompleted).length;
  const subtasksPercent = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;
  // In shared lists the origin also names who created the task (assignableMembers is empty otherwise)
  const creator = assignableMembers.find((m) => m.userId === task.userId);
  const origin = originDetails(task.origin, task.createdAt, creator ? creator.displayName || creator.email : undefined);

  // Rendered into <body>: as a child of the task view its coming and going made the browser restyle every
  // row of a long list (the view's space-y siblings rule), which delayed opening it.
  return createPortal(
    <div
      className="fixed inset-0 !m-0 modal-overlay z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onMouseDown={(e) => {
        pressedOutsideRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOutsideRef.current) requestClose();
      }}
    >
      <div
        className={`w-full max-w-2xl lg:max-w-5xl panel-surface shadow-panel border border-border my-auto flex flex-col max-h-[92vh] max-h-[92dvh] overflow-hidden ${
          shaking ? 'notice-shake' : ''
        }`}
        onAnimationEnd={() => setShaking(false)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-panel">
          <div className="flex items-center gap-2 min-w-0">
            <button
              disabled={readOnly}
              onClick={() => {
                triggerHaptic(15);
                const nextState = !task.isCompleted;
                const doneCol = activeColumns.find((c) => c.isDone) || activeColumns[activeColumns.length - 1];
                const todoCol = activeColumns.find((c) => !c.isDone) || activeColumns[0];
                const nextKanban = nextState ? (doneCol ? doneCol.id : 'done') : (todoCol ? todoCol.id : 'todo');
                onUpdateStatus(task, nextKanban);
              }}
              className={`w-5 h-5 checkbox-square flex items-center justify-center flex-shrink-0 transition-colors border disabled:cursor-default ${
                task.isCompleted
                  ? 'bg-status-ok border-status-ok text-on-accent'
                  : 'border-strong hover:border-accent text-transparent'
              }`}
              title={task.isCompleted ? t('detail.markOpen') : t('detail.markDone')}
            >
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </button>
            {/* Phones: squeezed to a single letter next to the buttons, so left out */}
            <span className="hidden sm:inline text-xs font-semibold text-main truncate">
              {readOnly ? t('detail.view') : task.isCompleted ? t('detail.done') : editTitleOnOpen ? t('detail.new') : t('detail.edit')}
            </span>
            {readOnly && (
              <span className="px-1.5 py-0.5 border border-border bg-canvas text-muted rounded-btn text-[10px] font-medium flex items-center gap-1 flex-shrink-0">
                <Lock className="w-2.5 h-2.5 text-faint" />
                <span>{t('detail.readOnly')}</span>
              </span>
            )}
            {/* Phones: no room next to the buttons; the details stand at the bottom anyway */}
            <span className="hidden sm:inline-flex min-w-0">
              <OriginBadge origin={task.origin} createdAt={task.createdAt} />
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggleWatch}
              disabled={watchBusy}
              title={isWatching ? t('detail.unwatch') : t('detail.watch')}
              className={`btn-action min-h-[38px] sm:min-h-0 h-9 sm:h-7 px-2.5 sm:px-2 text-xs flex items-center gap-1.5 ${
                isWatching ? 'border-accent text-accent' : ''
              }`}
            >
              {isWatching ? (
                <>
                  <EyeOff className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-accent" />
                  <span>{t('detail.unwatch')}</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  <span>{t('detail.watch')}</span>
                </>
              )}
            </button>
            {(task.convertedType === 'document_block' || task.docId) ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  const docId = task.docId || (task.convertedRefId ? task.convertedRefId.split(':')[0] : '');
                  const blockId = task.blockId || (task.convertedRefId ? task.convertedRefId.split(':')[1] : '');
                  if (docId && onOpenDocument) onOpenDocument(docId, blockId);
                }}
                title={t('detail.gotoNote')}
                className="btn-primary min-h-[38px] sm:min-h-0 h-9 sm:h-7 px-2.5 sm:px-2 text-xs flex items-center gap-1.5 font-semibold"
              >
                <FileText className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                {/* Short on phones, so the header buttons stay on one line */}
                <span className="sm:hidden">{t('detail.note')}</span>
                <span className="hidden sm:inline">{t('detail.openInNote')}</span>
              </button>
            ) : !readOnly && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onConvertToDoc(task);
                }}
                title={t('detail.toDocTitle')}
                className="btn-action min-h-[38px] sm:min-h-0 h-9 sm:h-7 px-2.5 sm:px-2 text-xs flex items-center gap-1.5"
              >
                <FileText className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-accent" />
                <span className="hidden sm:inline">{t('detail.toDoc')}</span>
              </button>
            )}
            {!readOnly && (
            <button
              type="button"
              // No question, as on the card: the task goes to the trash and the notice offers to undo it
              onClick={() => {
                onClose();
                onDeleteTask(task.id);
              }}
              title={t('detail.delete')}
              className="btn-action min-h-[38px] sm:min-h-0 h-9 sm:h-7 px-2.5 sm:px-2 text-xs text-status-err border-status-err/30 hover:bg-status-err/10 flex items-center gap-1"
            >
              <Trash className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span className="sm:hidden font-medium">{t('detail.deleteShort')}</span>
            </button>
            )}
            <button
              type="button"
              onClick={requestClose}
              className="text-muted hover:text-main p-2 sm:p-1.5 min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 flex items-center justify-center transition-colors"
              title={t('common:close')}
            >
              <X className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body (all controls disabled for read-only shares) */}
        {/* The scroll container is a div: a scrolling <fieldset> is unreliable in mobile browsers */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {/* Desktop (lg): two columns, wide left (title, subtasks, notes), narrow right (all settings).
            Phones and tablets keep the single column in the same order as before. */}
        <fieldset
          disabled={readOnly}
          className="p-4 space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_auto_1fr] lg:gap-x-6 lg:gap-y-4 min-w-0 border-0 m-0"
        >
          {/* Task Title */}
          <div className="lg:col-start-1 lg:row-start-1">
            {isEditingTitle ? (
              <div className="space-y-2">
                <div className="relative">
                  <textarea
                    ref={titleRef}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleTitleSubmit();
                      } else if (e.key === 'Escape') {
                        setIsEditingTitle(false);
                        setTitleDraft(task.content);
                      }
                    }}
                    autoFocus
                    onFocus={(e) => {
                      if (editTitleOnOpen) e.currentTarget.select();
                    }}
                    rows={2}
                    className="w-full text-base font-semibold input-field p-2.5 pr-11 sm:pr-9 resize-none leading-snug"
                  />
                  <VoiceInputButton value={titleDraft} onChange={setTitleDraft} className="absolute top-1 right-1" />
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingTitle(false);
                      setTitleDraft(task.content);
                    }}
                    className="btn-action h-7 px-2.5 text-xs"
                  >
                    {t('common:cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleTitleSubmit}
                    className="btn-primary h-7 px-3 text-xs"
                  >
                    {t('common:save')}
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => {
                  if (readOnly) return;
                  setTitleDraft(task.content);
                  setIsEditingTitle(true);
                }}
                className={`group p-2 rounded-card transition-colors border border-transparent ${
                  readOnly ? '' : 'cursor-pointer hover:bg-panel hover:border-border'
                }`}
                title={readOnly ? undefined : t('detail.editTitle')}
              >
                <h2
                  className={`text-base font-semibold break-words leading-snug ${
                    task.isCompleted ? 'line-through text-faint' : 'text-main'
                  }`}
                >
                  {task.content}
                </h2>
                {!readOnly && (
                  <span className="text-[10px] text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                    {t('detail.rename')}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Settings: right column on the desktop */}
          <div className="space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:border-l lg:border-border lg:pl-5">
          {/* Kanban status: one dropdown, also for boards with many columns */}
          <div className="space-y-1.5 pt-1 border-t border-border lg:border-t-0 lg:pt-0">
            <label className="block text-xs font-semibold text-main">
              {t('detail.status')}
            </label>
            <SelectMenu
              ariaLabel={t('detail.status')}
              value={activeColumns.some((c) => c.id === task.kanbanStatus) ? task.kanbanStatus! : 'todo'}
              options={activeColumns.map((col) => ({
                value: col.id,
                label: col.name,
                lead: <span className={`w-2 h-2 rounded-full ${columnDotClass(col)}`} />,
              }))}
              onChange={(id) => {
                triggerHaptic(10);
                onUpdateStatus(task, id);
              }}
            />
          </div>

          {/* Priority Buttons (4 Buttons) */}
          <div className="space-y-1.5 pt-1 border-t border-border">
            <label className="block text-xs font-semibold text-main">
              {t('detail.priority')}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  onUpdatePriority(task, 'low');
                }}
                className={`h-8 px-2 text-xs rounded-btn font-medium transition-colors border flex items-center justify-center gap-1 cursor-pointer ${
                  task.priority === 'low'
                    ? // No colour of its own: a faint tint and frame in the text colour, light in dark themes
                      'bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] border-[color-mix(in_srgb,var(--text-main)_55%,transparent)] text-main font-semibold shadow-xs'
                    : 'bg-canvas border-border text-muted hover:text-main'
                }`}
              >
                <span>{t('common:priority.low')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  onUpdatePriority(task, 'normal');
                }}
                className={`h-8 px-2 text-xs rounded-btn font-medium transition-colors border flex items-center justify-center gap-1 cursor-pointer ${
                  !task.priority || task.priority === 'normal'
                    ? 'bg-accent/15 border-accent text-accent font-semibold shadow-xs'
                    : 'bg-canvas border-border text-muted hover:text-main'
                }`}
              >
                <span>{t('common:priority.normal')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  onUpdatePriority(task, 'high');
                }}
                className={`h-8 px-2 text-xs rounded-btn font-medium transition-colors border flex items-center justify-center gap-1 cursor-pointer ${
                  task.priority === 'high'
                    ? 'bg-status-warn/15 border-status-warn text-status-warn font-semibold shadow-xs'
                    : 'bg-canvas border-border text-muted hover:text-main'
                }`}
              >
                <TriangleAlert className="w-3 h-3 text-status-warn" />
                <span>{t('common:priority.high')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  onUpdatePriority(task, 'urgent');
                }}
                className={`h-8 px-2 text-xs rounded-btn font-medium transition-colors border flex items-center justify-center gap-1 cursor-pointer ${
                  task.priority === 'urgent'
                    ? 'bg-status-err/15 border-status-err text-status-err font-semibold shadow-xs'
                    : 'bg-canvas border-border text-muted hover:text-main'
                }`}
              >
                <Flame className="w-3 h-3 text-status-err" />
                <span>{t('common:priority.urgent')}</span>
              </button>
            </div>
          </div>

          {/* Due Date & List Selection Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 pt-1 border-t border-border">
            {/* Due Date */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-main flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-accent" />
                <span>{t('detail.due')}</span>
              </label>
              <div className="flex items-center gap-1.5">
                <DateField
                  ariaLabel={t('detail.dueDate')}
                  value={dueParts.date}
                  clearable={false}
                  onChange={(date) => onUpdateDueDate(task, joinDue(date, dueParts.time))}
                  className="flex-1 min-w-0"
                  inputClassName="h-11 sm:h-8 input-field px-2 lg:px-1.5 text-base sm:text-xs bg-panel"
                />
                <TimeField
                  ariaLabel={t('detail.time')}
                  title={t('detail.timeTitle')}
                  value={dueParts.time}
                  disabled={!dueParts.date}
                  onChange={(time) => onUpdateDueDate(task, joinDue(dueParts.date, time))}
                  className="w-[7.5rem] lg:w-[5.75rem] shrink-0"
                  inputClassName="h-11 sm:h-8 input-field px-2 lg:px-1.5 text-base sm:text-xs bg-panel"
                />
                {task.dueDate && (
                  <button
                    type="button"
                    onClick={() => onUpdateDueDate(task, '')}
                    className="btn-action h-11 w-11 sm:h-8 sm:w-8 flex items-center justify-center text-muted hover:text-status-err shrink-0"
                    title={t('detail.removeDue')}
                    aria-label={t('detail.removeDue')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => handleQuickDueDate(0)}
                  className="px-1.5 py-0.5 bg-canvas border border-border rounded-btn text-muted hover:text-main"
                >
                  {t('common:date.today')}
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickDueDate(1)}
                  className="px-1.5 py-0.5 bg-canvas border border-border rounded-btn text-muted hover:text-main"
                >
                  {t('common:date.tomorrow')}
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickDueDate(7)}
                  className="px-1.5 py-0.5 bg-canvas border border-border rounded-btn text-muted hover:text-main"
                >
                  {t('tasks:detail.plusWeek')}
                </button>
                {dueParts.time && (
                  <button
                    type="button"
                    onClick={() => onUpdateDueDate(task, dueParts.date)}
                    className="px-1.5 py-0.5 bg-canvas border border-border rounded-btn text-muted hover:text-main inline-flex items-center gap-1"
                    title={t('detail.removeTime')}
                  >
                    <X className="w-2.5 h-2.5" />
                    {t('tasks:detail.timeShort')}
                  </button>
                )}
              </div>
              {onUpdateReminders && task.dueDate && (() => {
                // Own reminders replace the lead time; "Standard" stands for none. Without a time only
                // whole days make sense (all-day tasks remind at 9:00), chosen ones always stay visible.
                const own = task.reminders || [];
                const allDay = !dueParts.time;
                const choices = REMINDER_CHOICES.filter((m) => !allDay || isDayReminder(m) || own.includes(m));
                const standard = t('detail.reminder.standard', { lead: reminderLabel(leadMinutes, allDay) });
                return (
                  <div className="pt-1">
                    <label className="flex items-center gap-1 text-[11px] text-muted mb-1" title={t('detail.reminder.title')}>
                      <Bell className="w-3 h-3 text-accent" />
                      <span>{t('detail.reminder.label')}</span>
                    </label>
                    <MultiSelectMenu
                      ariaLabel={t('detail.reminder.label')}
                      title={t('detail.reminder.title')}
                      disabled={readOnly}
                      values={own.length ? own.map(String) : ['standard']}
                      summary={own.length ? remindersText(own, allDay) : standard}
                      onChange={(values) => {
                        const pickedStandard = values.includes('standard') && own.length > 0;
                        const next = pickedStandard ? [] : values.filter((v) => v !== 'standard').map(Number);
                        void onUpdateReminders(task, next);
                      }}
                      options={[
                        { value: 'standard', label: standard, hint: t('detail.reminder.standardHint') },
                        ...choices.map((m) => ({ value: String(m), label: reminderLabel(m, allDay) })),
                      ]}
                    />
                  </div>
                );
              })()}
              {onUpdateRecurrence && (
                <div className="pt-1">
                  <label className="flex items-center gap-1 text-[11px] text-muted mb-1">
                    <Repeat className="w-3 h-3 text-accent" />
                    <span>{t('detail.recurrence.label')}</span>
                  </label>
                  <SelectMenu<Recurrence>
                    ariaLabel={t('detail.recurrence.label')}
                    value={task.recurrence || ''}
                    disabled={readOnly}
                    onChange={(r) => onUpdateRecurrence(task, r)}
                    options={[
                      { value: '', label: t('detail.recurrence.none') },
                      { value: 'daily', label: t('detail.recurrence.daily') },
                      { value: 'weekly', label: t('detail.recurrence.weekly') },
                      { value: 'monthly', label: t('detail.recurrence.monthly') },
                      { value: 'yearly', label: t('detail.recurrence.yearly') },
                    ]}
                  />
                  {task.recurrence && (
                    <p className="text-[10px] text-faint mt-1">
                      {task.dueDate ? t('detail.recurrence.hintDate') : t('detail.recurrence.hintDone')}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Task List assignment */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-main flex items-center gap-1">
                <Folder className="w-3.5 h-3.5 text-accent" />
                <span>{t('detail.taskList')}</span>
              </label>
              <SelectMenu
                ariaLabel={t('detail.taskList')}
                value={task.taskListId || ''}
                onChange={(id) => onUpdateTaskList(task, id)}
                options={[
                  { value: '', label: t('detail.noTaskList') },
                  ...taskLists.map((tl) => ({ value: tl.id, label: tl.title, lead: tl.icon ? <span>{tl.icon}</span> : undefined })),
                ]}
              />
            </div>
          </div>

          {/* Assignees (shared lists only): chips + the shared type-to-search */}
          {assignableMembers.length > 0 && (() => {
            const assigned = (task.assignees || [])
              .map((id) => assignableMembers.find((m) => m.userId === id))
              .filter((m): m is TaskListMember => !!m);
            const assignedIds = assigned.map((m) => m.userId);
            const candidates: User[] = assignableMembers.map((m) => ({
              id: m.userId,
              email: m.email,
              displayName: m.displayName,
              avatarUrl: m.avatarUrl,
              role: 'member',
              isActive: true,
              createdAt: '',
            }));
            return (
              <div className="space-y-1.5 pt-1 border-t border-border">
                <label className="block text-xs font-semibold text-main flex items-center gap-1">
                  <UserPlus className="w-3.5 h-3.5 text-accent" />
                  <span>{t('detail.assigned')}</span>
                </label>
                {assigned.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {assigned.map((m) => (
                      <span
                        key={m.userId}
                        className="inline-flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-pill bg-panel border border-border text-xs text-main"
                      >
                        <UserAvatar userId={m.userId} name={m.displayName || m.email} avatarUrl={m.avatarUrl || ''} size="xxs" showTitle={false} />
                        <span>{m.displayName || m.email}</span>
                        {!readOnly && onUpdateAssignees && (
                          <button
                            type="button"
                            onClick={() => onUpdateAssignees(task, assignedIds.filter((id) => id !== m.userId))}
                            className="text-muted hover:text-status-err"
                            title={t('detail.unassign')}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  readOnly && <p className="text-xs text-muted">{t('detail.nobody')}</p>
                )}
                {!readOnly && onUpdateAssignees && assigned.length < assignableMembers.length && (
                  <UserAutocomplete
                    users={candidates}
                    selectedUser={null}
                    onSelectUser={(u) => u && onUpdateAssignees(task, [...assignedIds, u.id])}
                    excludeUserIds={assignedIds}
                    // Only people with access to the list: picking among them is not a people search
                    allUsers
                    placeholder={t('detail.assignPlaceholder')}
                  />
                )}
              </div>
            );
          })()}

          {/* Hashtags Section */}
          <div className="space-y-1.5 pt-1 border-t border-border">
            <label className="block text-xs font-semibold text-main flex items-center gap-1">
              <Hash className="w-3.5 h-3.5 text-accent" />
              <span>{t('detail.hashtags')}</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {Array.isArray(task.tags) &&
                task.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-panel border border-border text-xs text-main"
                  >
                    <span>#{tag}</span>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-muted hover:text-status-err"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              {!readOnly && (
              <form onSubmit={handleAddTagSubmit} className="inline-flex items-center gap-1">
                <input
                  type="text"
                  value={newTagDraft}
                  onChange={(e) => setNewTagDraft(e.target.value)}
                  placeholder="+ #hashtag"
                  className="h-11 sm:h-8 w-32 sm:w-24 px-2 sm:px-1.5 text-base sm:text-xs input-field"
                />
              </form>
              )}
            </div>
          </div>

          {/* Origin: in the right column on the desktop (phones show it in the footer) */}
          {origin && (
            <div className="hidden lg:block space-y-1 pt-1 border-t border-border">
              <label className="block text-xs font-semibold text-main">{t('detail.origin')}</label>
              <p className="text-[11px] text-muted leading-snug">{origin}</p>
            </div>
          )}
          </div>

          {/* Subtasks Checklist */}
          <div className="space-y-2 pt-1 border-t border-border lg:col-start-1 lg:row-start-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-main flex items-center gap-1.5">
                <SquareCheckBig className="w-3.5 h-3.5 text-accent" />
                <span>{t('detail.subtasks', { done: completedSubtasks, total: subtasks.length })}</span>
              </label>
              {subtasks.length > 0 && (
                <span className="text-[11px] font-mono text-muted">{subtasksPercent}%</span>
              )}
            </div>

            {subtasks.length > 0 && (
              <div className="w-full h-1 bg-border rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    subtasksPercent === 100 ? 'bg-status-ok' : 'bg-accent'
                  }`}
                  style={{ width: `${subtasksPercent}%` }}
                />
              </div>
            )}

            {/* Subtask items list */}
            {subtasks.length > 0 && (
              <div ref={subtaskSort.containerRef} className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {sortedSubtasks.map((st) => (
                  <div
                    key={st.id}
                    data-sort-id={st.id}
                    className={`p-1.5 bg-canvas border rounded-card flex items-center justify-between text-xs group ${
                      subtaskSort.draggingId === st.id ? 'border-accent shadow-sm opacity-80' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {canSortSubtasks && (
                        <button
                          type="button"
                          {...subtaskSort.handleProps(st.id)}
                          className="-my-2.5 sm:my-0 h-11 w-6 sm:h-5 sm:w-4 flex items-center justify-center flex-shrink-0 text-faint hover:text-main cursor-grab active:cursor-grabbing touch-none"
                          title={t('detail.dragSort')}
                          aria-label={t('moveSubtask', { title: st.title })}
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onToggleSubtask(task, st.id)}
                        className={`w-3.5 h-3.5 checkbox-square flex items-center justify-center flex-shrink-0 transition-colors border ${
                          st.isCompleted
                            ? 'bg-status-ok border-status-ok text-on-accent'
                            : 'border-strong hover:border-accent text-transparent'
                        }`}
                      >
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </button>
                      {editingSubtask?.id === st.id ? (
                        <div className="relative flex-1 min-w-0">
                          <input
                            ref={editSubtaskRef}
                            autoFocus
                            value={editingSubtask.title}
                            onChange={(e) => {
                              setEditingSubtask({ id: st.id, title: e.target.value });
                              editSubtaskMention.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
                            }}
                            onKeyDown={(e) => {
                              if (editSubtaskMention.handleKeyDown(e, editingSubtask.title, applyEditSubtaskMention)) return;
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                saveSubtaskTitle();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingSubtask(null);
                              }
                            }}
                            onBlur={() => {
                              editSubtaskMention.close();
                              saveSubtaskTitle();
                            }}
                            className="w-full h-11 sm:h-6 px-1.5 text-base sm:text-xs input-field"
                          />
                          <MentionMenu mention={editSubtaskMention} text={editingSubtask.title} apply={applyEditSubtaskMention} />
                        </div>
                      ) : (
                        <span
                          onClick={() => {
                            if (!readOnly && onRenameSubtask) setEditingSubtask({ id: st.id, title: st.title });
                          }}
                          title={readOnly || !onRenameSubtask ? undefined : t('detail.renameSubtask')}
                          className={`truncate ${readOnly || !onRenameSubtask ? '' : 'cursor-text'} ${
                            st.isCompleted ? 'line-through text-faint' : 'text-main'
                          }`}
                        >
                          {renderMentions(st.title)}
                        </span>
                      )}
                    </div>
                    {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onDeleteSubtask(task, st.id)}
                      className="opacity-0 group-hover:opacity-100 text-faint hover:text-status-err p-0.5 transition-opacity"
                    >
                      <Trash className="w-3 h-3" />
                    </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Inline add subtask form */}
            {!readOnly && (
            <form onSubmit={handleAddSubtaskSubmit} className="relative flex items-center gap-1.5">
              <input
                ref={subtaskInputRef}
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => {
                  setNewSubtaskTitle(e.target.value);
                  subtaskMention.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onKeyDown={(e) => {
                  subtaskMention.handleKeyDown(e, newSubtaskTitle, applySubtaskMention);
                }}
                onBlur={subtaskMention.close}
                placeholder={t('detail.newSubtask')}
                className="flex-1 min-w-0 h-11 sm:h-8 px-2 text-base sm:text-xs input-field"
              />
              <MentionMenu mention={subtaskMention} text={newSubtaskTitle} apply={applySubtaskMention} />
              <button
                type="submit"
                disabled={!newSubtaskTitle.trim()}
                className="btn-action h-11 sm:h-8 px-2.5 text-xs disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
                <span>{t('common:add')}</span>
              </button>
            </form>
            )}
          </div>

          {/* Notes Section */}
          <div className="space-y-2 pt-1 border-t border-border lg:col-start-1 lg:row-start-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-main flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-accent" />
                <span>{t('detail.notes')}</span>
              </label>
              <div className="flex items-center gap-2">
                {!readOnly && !isEditingNotes && task.notes && (
                  <button
                    type="button"
                    onClick={() => {
                      setNotesDraft(task.notes || '');
                      setIsEditingNotes(true);
                    }}
                    className="text-[11px] text-accent hover:underline"
                  >
                    {t('common:edit')}
                  </button>
                )}
              </div>
            </div>

            {isEditingNotes ? (
              <div className="space-y-2">
                {/* Dictating appends to the notes, inside the field like in Quick Dump; saved with "Notiz speichern" */}
                <div className="relative">
                  <textarea
                    value={notesDraft}
                    onChange={(e) => {
                      setNotesDraft(e.target.value);
                      notesMention.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    }}
                    onKeyDown={(e) => {
                      notesMention.handleKeyDown(e, notesDraft, applyNotesMention);
                    }}
                    onClick={(e) => notesMention.update(e.currentTarget.value, e.currentTarget.selectionStart)}
                    onBlur={notesMention.close}
                    placeholder={t('detail.notesPlaceholder')}
                    rows={6}
                    autoFocus
                    ref={(el) => {
                      notesRef.current = el;
                      growNotes(el);
                    }}
                    onInput={(e) => growNotes(e.currentTarget)}
                    className="w-full input-field p-2.5 pr-11 sm:pr-9 text-xs font-mono leading-relaxed resize-none min-h-[100px] lg:min-h-[260px] overflow-hidden"
                  />
                  <VoiceInputButton
                    value={notesDraft}
                    onChange={(text) => {
                      setNotesDraft(text);
                      requestAnimationFrame(() => growNotes(notesRef.current));
                    }}
                    focusRef={notesRef}
                    className="absolute top-1 right-1"
                  />
                  <MentionMenu mention={notesMention} text={notesDraft} apply={applyNotesMention} />
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingNotes(false);
                      setNotesDraft(task.notes || '');
                    }}
                    className="btn-action h-7 px-2.5 text-xs"
                  >
                    {t('common:cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleNotesSubmit}
                    className="btn-primary h-7 px-3 text-xs"
                  >
                    {t('detail.saveNote')}
                  </button>
                </div>
              </div>
            ) : task.notes ? (
              <div
                onClick={() => {
                  if (readOnly) return;
                  setNotesDraft(task.notes || '');
                  setIsEditingNotes(true);
                }}
                className={`p-3 bg-canvas border border-border rounded-card text-xs text-muted leading-relaxed transition-colors ${
                  readOnly ? '' : 'cursor-pointer hover:border-strong'
                }`}
                title={readOnly ? undefined : t('detail.clickEdit')}
              >
                <MarkdownViewer content={task.notes} />
              </div>
            ) : readOnly ? (
              <p className="text-xs text-faint">{t('detail.noNotes')}</p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNotesDraft('');
                  setIsEditingNotes(true);
                }}
                className="w-full py-2.5 px-3 border border-dashed border-border rounded-card text-xs text-muted hover:text-main hover:bg-panel transition-colors text-left flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 text-accent" />
                <span>{t('detail.addNote')}</span>
              </button>
            )}
          </div>
        </fieldset>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-panel">
          <div className="text-[11px] text-faint min-w-0 pr-3">
            <span className="lg:hidden">
              {origin || t('detail.created', { date: formatDate(task.createdAt) })}
            </span>
            <span className="hidden lg:inline">{t('detail.created', { date: formatDate(task.createdAt) })}</span>
          </div>
          {confirmUnsaved ? (
            <div role="alertdialog" aria-label={t('detail.unsaved')} className="flex flex-wrap items-center justify-end gap-1.5">
              <span className="text-xs text-main mr-1">{t('detail.unsaved')}</span>
              <button type="button" onClick={() => setConfirmUnsaved(false)} className="btn-action h-7 px-2.5 text-xs">
                {t('detail.keepEditing')}
              </button>
              <button type="button" onClick={onClose} className="btn-action h-7 px-2.5 text-xs text-status-err">
                {t('detail.discard')}
              </button>
              <button type="button" onClick={() => void saveAndClose()} className="btn-primary h-7 px-3 text-xs" autoFocus>
                {t('common:save')}
              </button>
            </div>
          ) : (
            <button type="button" onClick={requestClose} className="btn-primary h-7 px-3 text-xs">
              {t('detail.done2')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
