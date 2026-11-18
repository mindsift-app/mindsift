import { useRef, useState } from 'react';
import { NO_AUTOFILL } from '../lib/noAutofill';

// A whole number typed into a field of its own (Doku/ui-patterns.md): no spinner arrows, the number on
// the right and the unit after it inside the frame. Taken when the field is left or on Enter, not on
// every keystroke; a value outside min..max is set to the nearest limit, an empty one goes back to the
// last. Arrow up/down change it by one, Escape goes back. A new value from outside replaces what is typed.
export function NumberField({
  value,
  min,
  max,
  onCommit,
  label,
  unit,
  disabled,
  className = 'w-28',
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  // the field's accessible name (where no <label> around it names it)
  label?: string;
  // shown after the number (e.g. "MB", "Sekunden", "pro Stunde")
  unit?: string;
  disabled?: boolean;
  // width and place of the frame
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(n);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  const step = (by: number) => {
    const n = parseInt(draft, 10);
    setDraft(String(clamp((Number.isFinite(n) ? n : value) + by)));
  };
  return (
    <span
      className={`input-field flex items-center h-11 sm:h-8 overflow-hidden ${disabled ? 'opacity-60' : 'cursor-text'} ${className}`}
      data-number-field
      // a click on the unit or the padding puts the cursor into the number
      onMouseDown={(e) => {
        if (e.target !== inputRef.current && !disabled) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <input
        {...NO_AUTOFILL}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        role="spinbutton"
        value={draft}
        disabled={disabled}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={unit ? `${value} ${unit}` : undefined}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // in a form: take the number first, the next Enter sends it
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(String(value));
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            step(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
        className="flex-1 min-w-0 h-full px-2 bg-transparent text-right tabular-nums text-base sm:text-xs text-main outline-none disabled:cursor-not-allowed"
      />
      {unit && (
        <span className="shrink-0 pr-2 text-[11px] text-muted whitespace-nowrap select-none" aria-hidden="true">
          {unit}
        </span>
      )}
    </span>
  );
}
