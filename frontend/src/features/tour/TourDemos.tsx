import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  Code,
  FileText,
  Heading1,
  ListOrdered,
  ListTodo,
  MessageSquare,
  Shapes,
  Table as TableIcon,
  X,
} from 'lucide-react';

// Small animated examples inside the tour's card, drawn from static markup in the app's look. They never
// touch real data. With reduced motion they stand still on one telling frame.

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Counts 0 … count-1 over and over, one step every `ms`; with reduced motion it stays at `still`
function usePhase(count: number, ms: number, still: number) {
  const [reduced] = useState(prefersReducedMotion);
  const [phase, setPhase] = useState(reduced ? still : 0);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setPhase((p) => (p + 1) % count), ms);
    return () => window.clearInterval(id);
  }, [count, ms, reduced]);
  return phase;
}

const frame = 'rounded-card border border-border bg-canvas p-2.5 overflow-hidden select-none';

// Quick Dump → card → task (right), thrown away (left) or note (down)
export function TriageDemo() {
  const { t } = useTranslation('tour');
  const thoughts = [
    { text: t('demo.thought1'), to: 'task' as const },
    { text: t('demo.thought2'), to: 'discard' as const },
    { text: t('demo.thought3'), to: 'note' as const },
  ];
  // Per thought: typed into the Quick Dump, lying as a card, sorted away
  const phase = usePhase(thoughts.length * 3, 1100, 2);
  const current = thoughts[Math.floor(phase / 3)];
  const stage = phase % 3;
  const away =
    current.to === 'task'
      ? 'translate-x-[115%] rotate-6 opacity-0'
      : current.to === 'discard'
      ? '-translate-x-[115%] -rotate-6 opacity-0'
      : 'translate-y-[70%] scale-90 opacity-0';
  const cardClass = stage === 0 ? '-translate-y-3 opacity-0' : stage === 1 ? 'translate-x-0 opacity-100' : away;
  const lit = (to: string) => stage === 2 && current.to === to;
  const chip = 'h-6 px-2 rounded-btn border text-[10px] font-semibold flex items-center gap-1 transition-colors duration-300';
  return (
    <div className={`${frame} space-y-2`} aria-hidden>
      <div className="h-7 px-2.5 rounded-input border border-border bg-panel text-[11px] flex items-center gap-1.5">
        <span className="text-accent font-bold">+</span>
        {stage === 0 ? (
          <span className="text-main">
            {current.text}
            <span className="inline-block w-px h-3 bg-accent align-middle ml-0.5 animate-pulse" />
          </span>
        ) : (
          <span className="text-faint">{t('triage:capture.placeholderInbox')}</span>
        )}
      </div>
      <div className="relative h-14 flex items-center justify-center">
        <div
          className={`absolute inset-x-10 inset-y-1 panel-surface shadow-sm flex items-center justify-center text-xs font-medium text-main transition-all duration-500 ease-out ${cardClass}`}
        >
          {current.text}
        </div>
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <span
          className={`${chip} ${lit('discard') ? 'bg-status-err-bg border-status-err/40 text-status-err' : 'border-border text-muted'}`}
        >
          <ArrowLeft className="w-3 h-3" />
          <X className="w-3 h-3" />
          {t('triage:action.discard')}
        </span>
        <span className={`${chip} ${lit('note') ? 'bg-accent-dim border-accent text-accent' : 'border-border text-muted'}`}>
          <FileText className="w-3 h-3" />
          {t('triage:action.note')}
        </span>
        <span className={`${chip} ${lit('task') ? 'bg-accent text-on-accent border-accent' : 'border-border text-muted'}`}>
          <CheckSquare className="w-3 h-3" />
          {t('triage:action.task')}
          <ArrowRight className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}

// "/" in a bullet → the block it turns into
export function SlashDemo() {
  const { t } = useTranslation('tour');
  const commands = [
    { cmd: '/h1', icon: Heading1 },
    { cmd: '/todo', icon: ListTodo },
    { cmd: '/number', icon: ListOrdered },
    { cmd: '/code', icon: Code },
    { cmd: '/callout', icon: MessageSquare },
    { cmd: '/table', icon: TableIcon },
    { cmd: '/canvas', icon: Shapes },
  ];
  // Per command: typed, then the block (still frame: the drawing)
  const phase = usePhase(commands.length * 2, 1200, commands.length * 2 - 1);
  const index = Math.floor(phase / 2);
  const typed = phase % 2 === 0;
  const blocks: React.ReactNode[] = [
    <div key="h1" className="text-base font-bold text-main">{t('demo.h1')}</div>,
    <div key="todo" className="flex items-center gap-2 text-xs text-main">
      <span className="w-3.5 h-3.5 rounded-checkbox border border-accent flex items-center justify-center">
        <Check className="w-2.5 h-2.5 text-accent" />
      </span>
      <span className="line-through text-muted">{t('demo.todo')}</span>
    </div>,
    <div key="num" className="text-xs text-main space-y-0.5">
      <div><span className="text-muted mr-1.5">1.</span>{t('demo.numbered1')}</div>
      <div><span className="text-muted mr-1.5">2.</span>{t('demo.numbered2')}</div>
    </div>,
    <div key="code" className="rounded-btn bg-code text-code-fg font-mono text-[11px] px-2 py-1.5">
      {/* Sample code, the same in every language */}
      <span className="text-accent">{'git'}</span>
      {' pull --rebase'}
    </div>,
    <div key="callout" className="rounded-btn border border-accent/40 bg-accent-dim text-xs text-main px-2 py-1.5 flex items-center gap-1.5">
      <MessageSquare className="w-3.5 h-3.5 text-accent shrink-0" />
      {t('demo.callout')}
    </div>,
    <table key="table" className="text-[11px] text-main border-collapse">
      <thead>
        <tr>
          <th className="border border-border px-2 py-0.5 font-semibold text-left">{t('demo.tableHead1')}</th>
          <th className="border border-border px-2 py-0.5 font-semibold text-left">{t('demo.tableHead2')}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="border border-border px-2 py-0.5">{t('demo.tableCell1')}</td>
          <td className="border border-border px-2 py-0.5">{t('demo.tableCell2')}</td>
        </tr>
      </tbody>
    </table>,
    <svg key="canvas" viewBox="0 0 160 44" className="w-40 h-11 text-main" fill="none">
      <rect x="2" y="8" width="52" height="28" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <text x="28" y="26" textAnchor="middle" fontSize="11" fill="currentColor">{t('demo.canvas1')}</text>
      <path d="M58 22 H98" stroke="currentColor" strokeWidth="1.5" className="text-accent" />
      <path d="M93 17 L99 22 L93 27" stroke="currentColor" strokeWidth="1.5" className="text-accent" />
      <ellipse cx="130" cy="22" rx="27" ry="15" stroke="currentColor" strokeWidth="1.5" />
      <text x="130" y="26" textAnchor="middle" fontSize="11" fill="currentColor">{t('demo.canvas2')}</text>
    </svg>,
  ];
  return (
    <div className={`${frame} space-y-2`} aria-hidden>
      <div className="flex flex-wrap gap-1">
        {commands.map((c, i) => {
          const Icon = c.icon;
          return (
            <span
              key={c.cmd}
              className={`h-5 px-1.5 rounded-btn border font-mono text-[10px] flex items-center gap-1 transition-colors duration-300 ${
                i === index ? 'bg-accent text-on-accent border-accent' : 'border-border text-muted'
              }`}
            >
              <Icon className="w-3 h-3" />
              {c.cmd}
            </span>
          );
        })}
      </div>
      <div className="h-14 rounded-btn bg-panel border border-border px-2.5 flex items-center">
        {typed ? (
          <div className="flex items-center gap-2 text-xs text-main font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-muted shrink-0" />
            {commands[index].cmd}
            <span className="inline-block w-px h-3.5 bg-accent animate-pulse" />
          </div>
        ) : (
          <div key={index} className="animate-in fade-in zoom-in-95 duration-300">
            {blocks[index]}
          </div>
        )}
      </div>
    </div>
  );
}

// A to-do in a note and its task: ticking one ticks the other
export function LinkedTaskDemo() {
  const { t } = useTranslation('tour');
  // 0 open, 1 ticked in the note, 2 the task follows, 3 stays a moment
  const phase = usePhase(4, 1000, 2);
  const noteDone = phase >= 1;
  const taskDone = phase >= 2;
  const box = (done: boolean, flash: boolean) => (
    <span
      className={`w-3.5 h-3.5 rounded-checkbox border flex items-center justify-center shrink-0 transition-colors duration-300 ${
        done ? 'bg-accent border-accent text-on-accent' : 'border-strong'
      } ${flash ? 'ring-2 ring-accent/40' : ''}`}
    >
      {done && <Check className="w-2.5 h-2.5" />}
    </span>
  );
  return (
    <div className={`${frame} grid grid-cols-2 gap-2`} aria-hidden>
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-faint flex items-center gap-1">
          <FileText className="w-3 h-3" />
          {t('demo.note')}
        </div>
        <div className="rounded-btn bg-panel border border-border px-2 py-1.5 text-[11px] text-main flex items-center gap-1.5 flex-wrap">
          {box(noteDone, phase === 1)}
          <span className={noteDone ? 'line-through text-muted' : ''}>{t('demo.task')}</span>
          <span className="badge-accent text-[9px] leading-none px-1.5 py-0.5">{t('workspace:block.badgeTask')}</span>
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-faint flex items-center gap-1">
          <CheckSquare className="w-3 h-3" />
          {t('demo.tasks')}
        </div>
        <div className="rounded-btn bg-panel border border-border px-2 py-1.5 text-[11px] text-main flex items-center gap-1.5 flex-wrap">
          {box(taskDone, phase === 2)}
          <span className={taskDone ? 'line-through text-muted' : ''}>{t('demo.task')}</span>
          <span className="text-[9px] text-accent flex items-center gap-0.5">
            <FileText className="w-2.5 h-2.5" />
            {t('tasks:row.inNote')}
          </span>
        </div>
      </div>
    </div>
  );
}
