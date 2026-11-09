import React from 'react';

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
// open/all of the to-dos, list/Kanban/calendar of the tasks and month/week of the calendar. The chosen option is raised; one look everywhere.
export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center bg-main/[0.04] border border-border rounded-btn p-0.5 text-[11px]">
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
            className={`px-2.5 py-1 rounded-btn font-semibold transition-colors cursor-pointer ${
              active ? 'bg-panel-elevated text-main shadow-xs' : 'text-muted hover:text-main'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
