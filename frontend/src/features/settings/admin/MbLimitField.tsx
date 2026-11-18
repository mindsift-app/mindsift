import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// A size in MB the administration types (largest image, largest audio file, storage per person). Saved
// when the field is left or with Enter, not on every keystroke; a value outside min..max goes back to
// the saved one. A new value from the server replaces what is typed.
export function MbLimitField({
  value,
  min,
  max,
  label,
  disabled,
  unit,
  onSave,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  disabled?: boolean;
  // the unit after the field (default MB)
  unit?: string;
  onSave: (mb: number) => void;
}) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isInteger(n) && n >= min && n <= max) {
      if (n !== value) onSave(n);
    } else {
      setDraft(String(value));
    }
  };
  return (
    <label className="flex items-center gap-2 text-[11px] text-muted">
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="h-11 sm:h-8 px-2 input-field text-base sm:text-xs w-24"
      />
      {unit ?? t('server.mb')}
    </label>
  );
}
