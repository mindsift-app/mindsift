import React, { useLayoutEffect, useRef, useState } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  // Longer explanation on hover
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

// Small switch between a few views of a list (Doku/ui-patterns.md): sorting of the hashtags, grouping and
// open/all of the to-dos, list/Kanban/calendar of the tasks and month/week of the calendar. The chosen
// option is raised; the raised field slides over to a newly chosen one. One look everywhere.
export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: SegmentedControlProps<T>) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Where the raised field lies; null until measured (the chosen button is raised itself meanwhile)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // No slide when it first appears, only when the choice changes
  const [animate, setAnimate] = useState(false);
  const activeIndex = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const btn = box.querySelectorAll<HTMLElement>('[role="radio"]')[activeIndex];
      if (!btn || !btn.offsetWidth) return setPill(null);
      setPill((prev) =>
        prev && prev.left === btn.offsetLeft && prev.width === btn.offsetWidth ? prev : { left: btn.offsetLeft, width: btn.offsetWidth }
      );
    };
    measure();
    // Labels change width with the language or a breakpoint
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  useLayoutEffect(() => {
    if (pill && !animate) requestAnimationFrame(() => setAnimate(true));
  }, [pill, animate]);

  return (
    <div
      ref={boxRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative flex items-center bg-main/[0.04] border border-border rounded-btn p-0.5 text-[11px]"
    >
      {pill && (
        <span
          aria-hidden
          className={`absolute top-0.5 bottom-0.5 rounded-btn bg-panel-elevated shadow-xs ${
            animate ? 'transition-[left,width] duration-200 ease-out motion-reduce:transition-none' : ''
          }`}
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            title={o.title}
            className={`relative px-2.5 py-1 rounded-btn font-semibold transition-colors cursor-pointer ${
              active ? `text-main ${pill ? '' : 'bg-panel-elevated shadow-xs'}` : 'text-muted hover:text-main'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
