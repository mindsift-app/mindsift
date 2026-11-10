import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mic,
  MicOff,
  ArrowDown,
  Sparkles,
  Calendar,
  Check,
  CheckSquare,
  ShoppingCart,
  FileText,
  Layers,
  ChevronDown,
  AlertTriangle,
  Flame,
  Loader2,
} from 'lucide-react';
import { PriorityLevel, SharedList, TaskList, Thought } from '../../lib/types';
import { api, triggerHaptic } from '../../lib/api';
import { readViewSession, writeViewSession } from '../../lib/viewSession';
import { useVoiceInput } from '../../lib/useVoiceInput';
import { VoiceWave } from '../../components/VoiceWave';
import { DateField } from '../../components/DateField';

export type CaptureTarget = 'inbox' | 'task' | 'list_item' | 'document';

interface InstantCaptureBarProps {
  onCaptured: (thought: Thought, target?: CaptureTarget) => void;
  lists?: SharedList[];
  autoFocusTrigger?: number;
  inlineOptions?: boolean;
  defaultShowOptions?: boolean;
  hideTargetPicker?: boolean;
  fixedTarget?: CaptureTarget;
}

export const InstantCaptureBar: React.FC<InstantCaptureBarProps> = ({
  onCaptured,
  lists = [],
  autoFocusTrigger = 0,
  inlineOptions = false,
  defaultShowOptions = false,
  hideTargetPicker = false,
  fixedTarget,
}) => {
  const { t } = useTranslation('triage');
  // Read-only shared lists cannot take new items; stable reference for the effect below
  const writableLists = useMemo(() => lists.filter((l) => l.isOwner || l.role !== 'viewer'), [lists]);
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<PriorityLevel>('normal');
  const [dueDate, setDueDate] = useState('');
  const [target, setTarget] = useState<CaptureTarget>(fixedTarget || 'inbox');
  // Last chosen list per target, for this tab (lib/viewSession)
  const remembered = useMemo(() => readViewSession<{ listId: string; taskListId: string }>('capture'), []);
  const [targetListId, setTargetListId] = useState<string>(remembered.listId || '');
  const [targetTaskListId, setTargetTaskListId] = useState<string>(remembered.taskListId || '');
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const writableTaskLists = useMemo(() => taskLists.filter((l) => l.permission !== 'viewer'), [taskLists]);
  const [showOptions, setShowOptions] = useState(defaultShowOptions || hideTargetPicker);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justSavedLabel, setJustSavedLabel] = useState<string | null>(null);
  const [isMultiline, setIsMultiline] = useState(false);
  // Text length at which the bar became multiline: there the buttons move below the text and the field
  // gets wider, so it only goes back to one line once the text is clearly shorter (no flip-flopping)
  const multilineAtRef = useRef(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLFormElement>(null);
  const baseVoiceTextRef = useRef('');
  const hasVoiceInputRef = useRef(false);

  // Voice input: own Whisper server or the browser's recognition (lib/voice.ts)
  const voice = useVoiceInput({
    onText: (text, final) => {
      const base = baseVoiceTextRef.current;
      if (text) setContent(base ? `${base} ${text}` : text);
      if (final) inputRef.current?.focus();
    },
    onError: (message) => {
      setVoiceError(message);
      window.setTimeout(() => setVoiceError(null), 4000);
    },
  });
  const isListening = voice.state === 'listening';
  const isTranscribing = voice.state === 'transcribing';
  const [isOverMaxHeight, setIsOverMaxHeight] = useState(false);

  const adjustHeight = (el?: HTMLTextAreaElement | null) => {
    const targetEl = el || inputRef.current;
    if (!targetEl) return;
    targetEl.style.height = 'auto';
    if (targetEl.value) {
      const scrollH = targetEl.scrollHeight;
      targetEl.style.height = `${Math.min(scrollH, 140)}px`;
      const len = targetEl.value.length;
      const wraps = targetEl.value.includes('\n') || scrollH > 28;
      setIsMultiline((was) => {
        if (!was && wraps) {
          multilineAtRef.current = len;
          return true;
        }
        if (was && !wraps) return len >= multilineAtRef.current - 8;
        return wraps;
      });
      setIsOverMaxHeight(scrollH > 140);
    } else {
      setIsMultiline(false);
      setIsOverMaxHeight(false);
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [content]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [autoFocusTrigger]);

  useEffect(() => {
    if (!targetListId && writableLists.length > 0) {
      setTargetListId(writableLists[0].id);
    }
  }, [writableLists, targetListId]);

  useEffect(() => {
    writeViewSession('capture', { listId: targetListId, taskListId: targetTaskListId });
  }, [targetListId, targetTaskListId]);

  // Task lists only matter once the options are open; loaded each time, so new lists show up
  useEffect(() => {
    if (!showOptions || hideTargetPicker) return;
    api
      .getTaskLists()
      .then((tl) => setTaskLists(Array.isArray(tl) ? tl : []))
      .catch(() => {});
  }, [showOptions, hideTargetPicker]);

  // A remembered task list that is gone (deleted, access removed) falls back to all tasks
  const selectedTaskList = writableTaskLists.find((l) => l.id === targetTaskListId);

  // Close dropdown on outside click
  useEffect(() => {
    if (inlineOptions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inlineOptions]);

  // Global keyboard shortcut: 'c' or '/' focuses the Instant Capture input immediately
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const isEditing =
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable;

      // Only the bare key: Ctrl/Cmd+C copies (e.g. selected bullets or read-only text) and must not land here
      if (!isEditing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setContent('');
        setIsMultiline(false);
        setShowOptions(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleVoiceDictation = () => {
    if (voice.state === 'idle') {
      baseVoiceTextRef.current = content.replace(/\s*\[…\]$/, '').trim();
      hasVoiceInputRef.current = true;
      setVoiceError(null);
      triggerHaptic(20);
    }
    voice.toggle();
  };

  const executeCapture = async (
    overrideTarget?: CaptureTarget,
    overrideListId?: string,
    overrideTaskListId?: string
  ) => {
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) return;

    const effectiveTarget = fixedTarget || overrideTarget || target;
    const effectiveListId =
      overrideListId || targetListId || (writableLists.length > 0 ? writableLists[0].id : '');
    const capturedPriority = priority;
    const capturedDueDate = dueDate;
    const capturedSource = hasVoiceInputRef.current || isListening ? 'voice' : 'manual';
    hasVoiceInputRef.current = false;
    // A recognition still running would refill the field after it was saved
    if (voice.state !== 'idle') voice.cancel();

    // Optimistically clear input immediately so the UI feels instant (<10ms) in all browsers
    setContent('');
    setIsMultiline(false);
    setPriority('normal');
    setDueDate('');
    // Target and list stay for the next dump; only priority and due date belong to one entry
    setShowOptions(defaultShowOptions || hideTargetPicker);
    setIsSubmitting(true);
    triggerHaptic(15);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    const savedMsg =
      effectiveTarget === 'task'
        ? t('capture.okTask')
        : effectiveTarget === 'list_item'
        ? t('capture.okList')
        : effectiveTarget === 'document'
        ? t('capture.okNote')
        : t('capture.okInbox');
    setJustSavedLabel(savedMsg);
    setTimeout(() => setJustSavedLabel(null), 1600);
    inputRef.current?.focus();

    try {
      const created = await api.captureThought(
        trimmed,
        capturedPriority,
        capturedSource,
        capturedDueDate,
        {
          target: effectiveTarget,
          targetListId: effectiveTarget === 'list_item' ? effectiveListId : '',
          taskListId:
            effectiveTarget === 'task' ? (overrideTaskListId ?? (selectedTaskList ? selectedTaskList.id : '')) : '',
        }
      );
      onCaptured(created, effectiveTarget);
    } catch {
      // Restore text if capture unexpectedly failed completely
      setContent(trimmed);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await executeCapture();
  };

  const selectedList = writableLists.find((l) => l.id === targetListId) || writableLists[0];

  const getTargetLabel = () => {
    if (target === 'task') return selectedTaskList ? (selectedTaskList.icon ? `${selectedTaskList.icon} ${selectedTaskList.title}` : selectedTaskList.title) : 'Direkt-Aufgabe';
    if (target === 'list_item') return selectedList ? [selectedList.icon, selectedList.title].filter(Boolean).join(' ') : t('toList');
    if (target === 'document') return 'Direkt-Notiz';
    return t('quickDump');
  };

  return (
    <div className="w-full">
      <form ref={containerRef} onSubmit={handleSubmit} className="relative">
        {/* Quick-Capture Input Bar (Radius controlled by --radius-pill / multiline) */}
        <div
          className={`flex ${
            isMultiline ? 'flex-wrap items-start py-1.5 min-h-[36px]' : 'items-center h-9'
          } pl-1.5 pr-1.5 bg-panel border capture-pill ${
            isMultiline ? 'capture-bar-multiline' : 'rounded-full'
          } transition-all duration-150 ${
            isListening
              ? 'border-accent bg-panel'
              : 'border-border focus-within:border-accent'
          }`}
        >
          <div
            className={`w-6 h-6 capture-pill rounded-full bg-accent text-on-accent flex items-center justify-center mr-2 flex-shrink-0 ${
              isMultiline ? 'self-start mt-1' : ''
            }`}
          >
            <Sparkles className="w-3 h-3" />
          </div>

          <textarea
            ref={inputRef}
            rows={1}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              adjustHeight(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                executeCapture();
              }
            }}
            placeholder={
              voiceError
                ? voiceError
                : isListening
                ? t('app:capture.listening')
                : isTranscribing
                ? t('app:capture.transcribing')
                : hideTargetPicker || fixedTarget === 'inbox'
                ? t('capture.placeholderInbox')
                : target === 'task'
                ? t('capture.placeholderTask')
                : target === 'list_item'
                ? t('capture.placeholderList', { title: selectedList?.title || t('capture.list') })
                : target === 'document'
                ? t('capture.placeholderNote')
                : t('capture.placeholder')
            }
            className={`flex-1 min-w-0 w-full bg-transparent text-main placeholder-faint text-xs sm:text-sm focus:outline-none resize-none leading-5 py-0.5 ${
              isOverMaxHeight ? 'overflow-y-auto' : 'overflow-hidden'
            }`}
            style={{ minHeight: '22px', maxHeight: '140px' }}
            autoComplete="off"
          />

          <div
            className={`flex items-center gap-1 flex-shrink-0 ${
              // Multiline: the buttons get their own row under the text, so the text keeps the full width
              isMultiline ? 'basis-full justify-end mt-1 animate-in fade-in slide-in-from-top-1 duration-150' : 'ml-2'
            }`}
          >
            {/* Target & Options Toggle Pill (Hidden when target picker is disabled) */}
            {!hideTargetPicker && (
              <button
                type="button"
                onClick={() => setShowOptions((prev) => !prev)}
                title={t('capture.targetTitle')}
                className={`h-6 px-2.5 capture-pill rounded-full text-[11px] flex items-center gap-1 transition-colors cursor-pointer ${
                  showOptions || target !== 'inbox' || priority !== 'normal' || dueDate
                    ? 'bg-accent-dim text-accent border border-accent-border font-medium'
                    : 'text-muted hover:text-main hover:bg-panel-elevated border border-transparent'
                }`}
              >
                {target === 'task' ? (
                  <CheckSquare className="w-3 h-3" />
                ) : target === 'list_item' ? (
                  <ShoppingCart className="w-3 h-3" />
                ) : target === 'document' ? (
                  <FileText className="w-3 h-3" />
                ) : (
                  <Layers className="w-3 h-3" />
                )}
                <span className={`${inlineOptions ? 'inline' : 'hidden md:inline'} max-w-[110px] truncate`}>
                  {getTargetLabel()}
                </span>
                {dueDate && <span className="hidden lg:inline text-[10px] opacity-80">• {dueDate.slice(5)}</span>}
                <ChevronDown className={`w-3 h-3 opacity-70 transition-transform ${showOptions ? 'rotate-180' : ''}`} />
              </button>
            )}

            {/* Voice Dictation Button (hidden when voice input is off or not supported) */}
            {voice.available && (
              <>
                {isListening && voice.mode === 'server' && (
                  <VoiceWave getLevel={voice.level} className="h-3.5 text-accent" />
                )}
                <button
                  type="button"
                  onClick={toggleVoiceDictation}
                  disabled={isTranscribing}
                  title={isListening ? t('app:capture.stopRecording') : isTranscribing ? t('app:capture.transcribing') : t('app:capture.voiceInput')}
                  className={`w-6 h-6 capture-pill rounded-full flex items-center justify-center transition-colors ${
                    isListening || isTranscribing
                      ? 'bg-accent-dim text-accent'
                      : 'text-muted hover:text-main hover:bg-panel-elevated'
                  }`}
                >
                  {isTranscribing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : isListening ? (
                    <MicOff className="w-3 h-3" />
                  ) : (
                    <Mic className="w-3 h-3" />
                  )}
                </button>
              </>
            )}

            {/* Instant Send Button */}
            <button
              type="submit"
              disabled={!content.trim() || isSubmitting}
              className={`h-6 px-2.5 capture-pill rounded-full font-medium text-[11px] flex items-center gap-1 transition-all ${
                content.trim()
                  ? 'bg-accent hover:bg-accent-hover text-on-accent cursor-pointer shadow-sm'
                  : 'bg-panel-elevated text-faint cursor-not-allowed'
              }`}
            >
              {justSavedLabel ? (
                <>
                  <Check className="w-3 h-3" />
                  <span className="inline">{justSavedLabel}</span>
                </>
              ) : (
                <>
                  <ArrowDown className="w-3 h-3" />
                  <span className="inline">
                    {hideTargetPicker || (fixedTarget || target) === 'inbox'
                      ? t('quickDump')
                      : target === 'task'
                      ? t('capture.asTask')
                      : target === 'list_item'
                      ? t('toList')
                      : target === 'document'
                      ? t('asNote')
                      : 'Dump'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Expandable Target & Metadata Panel (Theme-controlled Dropdown or Inline) */}
        {showOptions && (
          <div
            className={
              inlineOptions
                ? 'mt-3 p-3 panel-surface border border-border rounded-xl space-y-3 text-xs animate-in fade-in duration-150'
                : 'absolute top-full left-0 right-0 mt-1.5 z-50 p-3 panel-surface shadow-panel space-y-3 text-xs'
            }
          >
            {/* Row 1: Where should this entry go? (Omitted when hideTargetPicker is true) */}
            {!hideTargetPicker && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {t('capture.where')}
                    </span>
                    <span className="text-[11px] text-faint">
                      {t('capture.whereHint')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {/* Option 1: Quick Dump (Triage) */}
                    <button
                      type="button"
                      onClick={() => {
                        setTarget('inbox');
                      }}
                      className={`min-h-[36px] px-2.5 border rounded-btn flex items-center gap-1.5 text-left transition-colors cursor-pointer ${
                        target === 'inbox'
                          ? 'bg-accent-dim border-accent text-main font-medium'
                          : 'bg-canvas border-border text-muted hover:text-main hover:bg-panel-hover'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      <span className="truncate">{t('capture.inbox')}</span>
                    </button>

                    {/* Option 2: Direct Task */}
                    <button
                      type="button"
                      onClick={() => {
                        setTarget('task');
                      }}
                      className={`min-h-[36px] px-2.5 border rounded-btn flex items-center gap-1.5 text-left transition-colors cursor-pointer ${
                        target === 'task'
                          ? 'bg-accent-dim border-accent text-main font-medium'
                          : 'bg-canvas border-border text-muted hover:text-main hover:bg-panel-hover'
                      }`}
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      <span className="truncate">{t('triage:capture.directTask')}{writableTaskLists.length > 0 ? '…' : ''}</span>
                    </button>

                    {/* Option 3: Direct List Item */}
                    <button
                      type="button"
                      onClick={() => {
                        setTarget('list_item');
                        if (!targetListId && writableLists.length > 0) {
                          setTargetListId(writableLists[0].id);
                        }
                      }}
                      className={`min-h-[36px] px-2.5 border rounded-btn flex items-center gap-1.5 text-left transition-colors cursor-pointer ${
                        target === 'list_item'
                          ? 'bg-accent-dim border-accent text-main font-medium'
                          : 'bg-canvas border-border text-muted hover:text-main hover:bg-panel-hover'
                      }`}
                    >
                      <ShoppingCart className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      <span className="truncate">{t('capture.directList')}</span>
                    </button>

                    {/* Option 4: Direct Workspace Note */}
                    <button
                      type="button"
                      onClick={() => {
                        setTarget('document');
                      }}
                      className={`min-h-[36px] px-2.5 border rounded-btn flex items-center gap-1.5 text-left transition-colors cursor-pointer ${
                        target === 'document'
                          ? 'bg-accent-dim border-accent text-main font-medium'
                          : 'bg-canvas border-border text-muted hover:text-main hover:bg-panel-hover'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      <span className="truncate">{t('capture.directNote')}</span>
                    </button>
                  </div>
                </div>

                {/* Sub-row for a direct task: which task list */}
                {target === 'task' && writableTaskLists.length > 0 && (
                  <div className="pt-2 border-t border-border flex flex-wrap items-center gap-1.5">
                    <span className="text-muted mr-1 flex items-center gap-1">
                      <CheckSquare className="w-3 h-3 text-accent" />
                      {t('capture.taskList')}
                    </span>
                    {[{ id: '', icon: '📥', title: t('capture.allTasks') }, ...writableTaskLists].map((tl) => {
                      const isSelected = (selectedTaskList?.id || '') === tl.id;
                      return (
                        <button
                          key={tl.id || 'all'}
                          type="button"
                          onClick={() => {
                            setTargetTaskListId(tl.id);
                          }}
                          className={`min-h-[30px] px-2.5 border rounded-btn text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-accent/10 text-main border-accent font-medium'
                              : 'bg-canvas border-border text-muted hover:text-main hover:bg-panel-hover'
                          }`}
                        >
                          {tl.icon && <span>{tl.icon}</span>}
                          <span>{tl.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Sub-row for a list item: which list (shopping, checklist …) */}
                {target === 'list_item' && writableLists.length > 0 && (
                  <div className="pt-2 border-t border-border flex flex-wrap items-center gap-1.5">
                    <span className="text-muted mr-1 flex items-center gap-1">
                      <ShoppingCart className="w-3 h-3 text-accent" />
                      {t('capture.listLabel')}
                    </span>
                    {writableLists.map((lst) => {
                      const isSelected = targetListId === lst.id;
                      return (
                        <button
                          key={lst.id}
                          type="button"
                          onClick={() => {
                            setTarget('list_item');
                            setTargetListId(lst.id);
                          }}
                          className={`min-h-[30px] px-2.5 border rounded-btn text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-accent/10 text-main border-accent font-medium'
                              : 'bg-canvas border-border text-muted hover:text-main hover:bg-panel-hover'
                          }`}
                        >
                          <span>{lst.icon}</span>
                          <span>{lst.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Row 2: Priority & Due Date */}
            <div className={`${!hideTargetPicker ? 'pt-2 border-t border-border' : ''} flex flex-wrap items-center justify-between gap-2.5`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted text-[11px] font-semibold mr-1">{t('capture.priority')}</span>
                {(['low', 'normal', 'high', 'urgent'] as PriorityLevel[]).map((p) => {
                  const config: Record<PriorityLevel, { label: string; icon?: React.ReactNode; activeClass: string }> = {
                    low: { label: t('common:priority.low'), activeClass: 'bg-canvas border-strong text-main font-semibold shadow-xs' },
                    normal: { label: t('common:priority.normal'), activeClass: 'bg-accent/15 border-accent text-accent font-semibold shadow-xs' },
                    high: { label: t('common:priority.high'), icon: <AlertTriangle className="w-3 h-3 text-status-warn" />, activeClass: 'bg-status-warn/15 border-status-warn text-status-warn font-semibold shadow-xs' },
                    urgent: { label: t('common:priority.urgent'), icon: <Flame className="w-3 h-3 text-status-err" />, activeClass: 'bg-status-err/15 border-status-err text-status-err font-semibold shadow-xs' },
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
                      className={`min-h-[30px] px-2.5 py-1 border rounded-btn text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                        active
                          ? item.activeClass
                          : 'bg-canvas text-muted hover:text-main border-border'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-muted text-[11px] font-semibold flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-accent" />
                  {t('capture.due')}
                </span>
                <DateField
                  ariaLabel={t('capture.due')}
                  value={dueDate}
                  onChange={setDueDate}
                  className="w-[9rem]"
                  inputClassName="h-[30px] input-field px-2.5 text-xs"
                />
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
